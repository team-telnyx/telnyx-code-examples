import express from "express";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { makeHandler } from "../index.js";
import { LocalActorContext, actorDbPath } from "./context.js";
import {
  initSchema as initConfigSchema,
  listTenants,
  getTenant,
  checkRateLimit,
  resetRateLimit,
  rateLimitUsedThisMinute,
  type TenantConfigCtx,
} from "../tenantConfigLogic.js";
import {
  startCall,
  getCall,
  getCallByControlId,
  listCalls,
  updateCallStatus,
  hangup,
  activeCount,
  rateLimitUsedThisMinute as voiceRateUsed,
  type TenantVoiceCtx,
} from "../tenantVoiceLogic.js";
import { TelnyxLiveClient, isLiveMode } from "../telnyxLive.js";
import type { Call, Env, TenantDashboard } from "../types.js";

/**
 * Local runner for the multi-tenant voice platform.
 *
 * Serves the polished dashboard + API. In LIVE_MODE (TELNYX_API_KEY set,
 * DEMO_MODE=false), the place-call handler invokes telnyx.calls.create()
 * and the webhook receiver updates call state from real Telnyx events. In
 * DEMO_MODE, calls are simulated locally — a background walker flips
 * each call through queued → ringing → answered → completed on a timer.
 */

const DEMO_WALK_TIMERS = new Map<string, NodeJS.Timeout>();

function demoWalk(call: Call, voiceCtxByTenant: (id: string) => TenantVoiceCtx): void {
  const tick = (delay: number, status: Call["status"]) => {
    const t = setTimeout(async () => {
      try {
        await updateCallStatus(voiceCtxByTenant(call.tenant_id), { id: call.id, status });
      } catch {
        // ignore — caller may have hung up first
      }
      if (status === "completed" || status === "failed") {
        DEMO_WALK_TIMERS.delete(call.id);
      }
    }, delay);
    DEMO_WALK_TIMERS.set(`${call.id}:${status}`, t);
  };
  tick(800, "ringing");
  tick(2200, "answered");
  tick(10_000, "completed");
}

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const demoMode = (process.env.DEMO_MODE ?? "true") !== "false";
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  const apiKey = process.env.TELNYX_API_KEY;

  const dataDir = resolve(process.env.TENANT_VOICE_DB ?? ".data");
  mkdirSync(dataDir, { recursive: true });

  function makeSql(db: Database.Database): TenantConfigCtx["storage"]["sql"] {
    return {
      exec<T>(query: string, ...bindings: unknown[]): Iterable<T> & { toArray(): T[] } {
        const isSelect = /^\s*(SELECT|PRAGMA)/i.test(query);
        const stmt = db.prepare(query);
        if (isSelect) {
          const cursor = stmt.all(...bindings) as T[];
          return {
            *[Symbol.iterator]() { for (const row of cursor) yield row; },
            toArray() { return cursor; },
          };
        }
        stmt.run(...bindings);
        return { *[Symbol.iterator]() {}, toArray() { return []; } };
      },
    };
  }

  const configDb = new Database(actorDbPath(dataDir, "config"));
  configDb.pragma("journal_mode = WAL");
  let configState: {
    seeded: boolean;
    rate_limits: { windows: Record<string, { window_start: number; count: number }> };
  } = { seeded: false, rate_limits: { windows: {} } };
  const configCtx: TenantConfigCtx = {
    storage: { sql: makeSql(configDb) },
    async getState<T>() { return configState as unknown as T; },
    async setState<T>(next: T) { configState = next as typeof configState; },
  };
  await initConfigSchema(configCtx);

  const voiceDbs = new Map<string, Database.Database>();
  function getVoiceDb(tenantId: string): Database.Database {
    let db = voiceDbs.get(tenantId);
    if (!db) {
      db = new Database(actorDbPath(dataDir, `voice_${tenantId}`));
      db.pragma("journal_mode = WAL");
      voiceDbs.set(tenantId, db);
    }
    return db;
  }
  function getVoiceCtx(tenantId: string): TenantVoiceCtx {
    return { storage: { sql: makeSql(getVoiceDb(tenantId)) } };
  }

  const liveClient = !demoMode && apiKey ? new TelnyxLiveClient(apiKey) : null;

  // SSE bus — broadcasts dashboard_update events to connected clients
  type SseClient = { id: string; res: express.Response };
  const sseClients = new Set<SseClient>();
  function broadcastDashboardUpdate(reason: string, tenantId: string): void {
    const payload = `event: dashboard_update\ndata: ${JSON.stringify({ reason, tenant_id: tenantId, at: Date.now() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  const env: Env = {
    TENANT_CONFIG: {
      idFromName: (_name: string) => ({
        init: () => initConfigSchema(configCtx),
        list: () => listTenants(configCtx),
        get: (id: string) => getTenant(configCtx, id),
        checkRateLimit: (tenant: Parameters<typeof checkRateLimit>[1]) =>
          checkRateLimit(configCtx, tenant),
      }),
    },
    TENANT_VOICE: {
      idFromName: (name: string) => ({
        startCall: (args: Parameters<typeof startCall>[1]) =>
          startCall(getVoiceCtx(name), args),
        getCall: (id: string) => getCall(getVoiceCtx(name), id),
        getCallByControlId: (id: string) => getCallByControlId(getVoiceCtx(name), id),
        listCalls: (limit?: number) => listCalls(getVoiceCtx(name), limit),
        updateCallStatus: (args: Parameters<typeof updateCallStatus>[1]) =>
          updateCallStatus(getVoiceCtx(name), args),
        hangup: (id: string) => hangup(getVoiceCtx(name), id),
        activeCount: () => activeCount(getVoiceCtx(name)),
        rateLimitUsedThisMinute: (tenantId: string) => voiceRateUsed(getVoiceCtx(name), tenantId),
      }),
    },
    LIVE_MODE: !demoMode,
    TELNYX_API_KEY: apiKey,
    DEMO_MODE: demoMode,
  };

  const handler = makeHandler({
    publicKey,
    listTenants: () => listTenants(configCtx),
    getTenant: (id: string) => getTenant(configCtx, id),
    checkRateLimit: (tenant: Parameters<typeof checkRateLimit>[1]) =>
      checkRateLimit(configCtx, tenant),
    resetRateLimit: (tenantId: string) => resetRateLimit(configCtx, tenantId),
    rateLimitUsedThisMinute: (tenantId: string) => rateLimitUsedThisMinute(configCtx, tenantId),
    ctx: {
      voice: {
        idFromName: (tenantId: string) => ({
          startCall: async (args: Parameters<typeof startCall>[1]) => {
            const call = await startCall(getVoiceCtx(tenantId), args);
            broadcastDashboardUpdate("call_placed", tenantId);
            return call;
          },
          getCall: (id: string) => getCall(getVoiceCtx(tenantId), id),
          getCallByControlId: (id: string) => getCallByControlId(getVoiceCtx(tenantId), id),
          listCalls: (limit?: number) => listCalls(getVoiceCtx(tenantId), limit),
          updateCallStatus: async (args: Parameters<typeof updateCallStatus>[1]) => {
            const updated = await updateCallStatus(getVoiceCtx(tenantId), args);
            if (updated) broadcastDashboardUpdate("call_updated", updated.tenant_id);
            return updated;
          },
          hangup: (id: string) => hangup(getVoiceCtx(tenantId), id),
          activeCount: () => activeCount(getVoiceCtx(tenantId)),
          rateLimitUsedThisMinute: (id: string) => voiceRateUsed(getVoiceCtx(tenantId), id),
        }),
      },
      placeLiveCall: liveClient
        ? async ({ tenant, from_number, to_number }) => {
            const res = await liveClient.placeCall({ tenant, from_number, to_number });
            return { call_control_id: res.call_control_id };
          }
        : undefined,
      simulateProgress: demoMode ? (call) => demoWalk(call, getVoiceCtx) : undefined,
    },
    demoMode,
    apiBase: process.env.TELNYX_PUBLIC_BASE_URL || `http://${host}:${port}`,
  });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/", { headers: { host: `${host}:${port}` } }));
    res.status(r.status).type("text/html").send(await r.text());
  });

  app.get("/health", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/health"));
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get("/api/dashboard", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/api/dashboard"));
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get("/api/tenants", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/api/tenants"));
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}`),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/config$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/config`),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.post(/\/api\/tenants\/([^/]+)\/calls$/, async (req, res) => {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    };
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/calls`, init),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/calls$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/calls`),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/calls\/([^/]+)$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/calls/${req.params[1]}`),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.post(/\/api\/tenants\/([^/]+)\/calls\/([^/]+)\/hangup$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(
        `http://x/api/tenants/${req.params[0]}/calls/${req.params[1]}/hangup`,
        { method: "POST" },
      ),
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get("/api/events", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    const client: SseClient = { id: Math.random().toString(36).slice(2, 10), res };
    sseClients.add(client);
    res.write(`event: hello\ndata: ${JSON.stringify({ id: client.id, demoMode })}\n\n`);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(client);
      }
    }, 15_000);
    heartbeat.unref?.();
    _req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
    });
  });

  app.post(
    "/webhooks/voice",
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const init: RequestInit = {
        method: "POST",
        headers: {
          "content-type": (req.headers["content-type"] as string) ?? "application/json",
          "telnyx-signature-ed25519": (req.headers["telnyx-signature-ed25519"] as string) ?? "",
          "telnyx-timestamp": (req.headers["telnyx-timestamp"] as string) ?? "",
        },
        body: new Uint8Array(buf),
      };
      const r = await handler.fetch(
        new Request("http://x/webhooks/voice", init),
      );
      res.status(r.status).type("application/json").send(await r.text());
      try {
        const body = JSON.parse(await r.clone().text());
        if (body.ok && body.call_control_id) {
          const all = await listCalls(getVoiceCtx("__all__"), 200);
          const matched = all.find((c) => c.call_control_id === body.call_control_id);
          if (matched) broadcastDashboardUpdate("call_updated", matched.tenant_id);
        }
      } catch {
        // ignore
      }
    },
  );

  const server = app.listen(port, host, () => {
    const mode = demoMode ? "DEMO" : "LIVE";
    console.log(`Multi-Tenant Voice: http://${host}:${port} (${mode} mode)`);
    if (!demoMode && publicKey) console.log("Webhook signing key configured");
    if (!demoMode && liveClient) console.log("Live Telnyx client wired");
    console.log(`Dashboard: http://${host}:${port}/`);
    void apiKey;
  });
  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });

  void isLiveMode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
