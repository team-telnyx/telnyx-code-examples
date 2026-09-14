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
  type TenantConfigCtx,
} from "../tenantConfigLogic.js";
import {
  startCall,
  getCall,
  listCalls,
  hangup,
  activeCount,
  type TenantVoiceCtx,
} from "../tenantVoiceLogic.js";
import type { Env } from "../types.js";

/**
 * Local runner for the multi-tenant voice platform.
 *
 * Bypasses the Agent class entirely — calls the pure logic functions in
 * tenantConfigLogic.ts / tenantVoiceLogic.ts directly against LocalActorContext
 * instances. The fetch handler in src/index.ts is identical to the deployed
 * version; only the env proxy differs.
 *
 * On Edge, the runtime instantiates TenantConfigActor / TenantVoiceActor
 * via telnyx.toml — those wrap the same pure functions. Local code path:
 * handler → env proxy → pure function → LocalActorContext.
 */
export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const demoMode = (process.env.DEMO_MODE ?? "true") !== "false";
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  const apiKey = process.env.TELNYX_API_KEY;

  const dataDir = resolve(process.env.TENANT_VOICE_DB ?? ".data");
  mkdirSync(dataDir, { recursive: true });

  /**
   * Helper that wraps a better-sqlite3 DB in the ctx shape the pure
   * functions expect (exec returning an iterable cursor + toArray()).
   */
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
        return {
          *[Symbol.iterator]() {},
          toArray() { return []; },
        };
      },
    };
  }

  const configDbPath = actorDbPath(dataDir, "config");
  const configDb = new Database(configDbPath);
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
      idFromName: (name: string) => {
        const ctx = getVoiceCtx(name);
        return {
          startCall: (args: Parameters<typeof startCall>[1]) => startCall(ctx, args),
          getCall: (id: string) => getCall(ctx, id),
          listCalls: () => listCalls(ctx),
          hangup: (id: string) => hangup(ctx, id),
          activeCount: () => activeCount(ctx),
        };
      },
    },
  };

  function reset(): void {
    configDb.exec("DELETE FROM tenants;");
    configState = { seeded: false, rate_limits: { windows: {} } };
    for (const db of voiceDbs.values()) db.exec("DELETE FROM calls;");
  }

  const handler = makeHandler(publicKey);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/health"), env);
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get("/health", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/health"), env);
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get("/api/tenants", async (_req, res) => {
    const r = await handler.fetch(new Request("http://x/api/tenants"), env);
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}`),
      env,
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/config$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/config`),
      env,
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
      env,
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/calls$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/calls`),
      env,
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.get(/\/api\/tenants\/([^/]+)\/calls\/([^/]+)$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(`http://x/api/tenants/${req.params[0]}/calls/${req.params[1]}`),
      env,
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.post(/\/api\/tenants\/([^/]+)\/calls\/([^/]+)\/hangup$/, async (req, res) => {
    const r = await handler.fetch(
      new Request(
        `http://x/api/tenants/${req.params[0]}/calls/${req.params[1]}/hangup`,
        { method: "POST" },
      ),
      env,
    );
    res.status(r.status).type("application/json").send(await r.text());
  });

  app.post(
    "/webhooks/voice",
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const r = await handler.fetch(
        new Request("http://x/webhooks/voice", {
          method: "POST",
          headers: {
            "content-type": (req.headers["content-type"] as string) ?? "application/json",
            "telnyx-signature-ed25519": (req.headers["telnyx-signature-ed25519"] as string) ?? "",
            "telnyx-timestamp": (req.headers["telnyx-timestamp"] as string) ?? "",
          },
          body: new Uint8Array(buf),
        }),
        env,
      );
      res.status(r.status).type("application/json").send(await r.text());
    },
  );

  app.post("/api/demo/reset", (_req, res) => {
    if (!demoMode) return res.status(403).json({ error: "demo mode disabled" });
    reset();
    res.json({ ok: true });
  });

  const server = app.listen(port, host, () => {
    const mode = demoMode ? "DEMO" : "LIVE";
    console.log(`Multi-Tenant Voice: http://${host}:${port} (${mode} mode)`);
    if (!demoMode && publicKey) {
      console.log("Webhook signing key configured");
    }
    void apiKey;
  });
  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
