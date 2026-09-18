/**
 * Local dev server for sub-agent-orchestrator-actor.
 *
 * Runs the REAL agent code in-process (the same classes that ship to Telnyx
 * Edge) behind a tiny file-backed actor host:
 *
 *  - actor storage → .dev-store/<type>-<name>.json (survives restarts)
 *  - KV (JOB_KV)  → .dev-store/kv.json
 *  - queue/schedule/watchdog → real timers via a working ctx.setAlarm +
 *    the SDK's own alarm() drain
 *
 * Killing this process is the "3am power event": in-flight work dies, durable
 * state and KV survive — re-post the same job and the orchestrator adopts what
 * finished and re-spawns only what never reported.
 *
 * Run: npm run dev  →  http://localhost:8787
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import handler from "./src/index";
import {
  OrchestratorAgent,
  TranscriberAgent,
} from "./src/index";
import type { OrchestratorEnv } from "./src/index";

const PORT = Number(process.env.PORT) || 8787;
const STORE_DIR = path.join(process.cwd(), ".dev-store");

// ---------- .env loader (no dependency) ----------

function loadDotEnv(): void {
  // The example folder ships only .env.example (verify.py forbids a .env in
  // the folder) — also check the repo root, where the local dev .env lives.
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", "..", ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadDotEnv();

// ---------- file-backed KV (shared across actors) ----------

class FileKv {
  private map = new Map<string, string>();
  constructor() {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const file = this.file();
    if (fs.existsSync(file)) {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, "utf8")))) {
        this.map.set(k, v as string);
      }
    }
  }
  private file(): string {
    return path.join(STORE_DIR, "kv.json");
  }
  private save(): void {
    fs.writeFileSync(this.file(), JSON.stringify(Object.fromEntries(this.map)));
  }
  async get(key: string, options?: { type?: string }): Promise<unknown> {
    const raw = this.map.get(key) ?? null;
    if (raw === null) return null;
    return options?.type === "json" ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    this.save();
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
    this.save();
  }
  async list(options?: {
    limit?: number;
    prefix?: string;
    cursor?: string;
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
    const all = [...this.map.keys()].sort();
    const startIdx = options?.cursor ? all.indexOf(options.cursor) + 1 : 0;
    const filtered = all
      .slice(startIdx)
      .filter((k) => (options?.prefix ? k.startsWith(options.prefix) : true));
    const limit = options?.limit ?? 100;
    const page = filtered.slice(0, limit);
    const list_complete = limit >= filtered.length;
    return {
      keys: page.map((name) => ({ name })),
      list_complete,
      ...(list_complete ? {} : { cursor: page[page.length - 1] }),
    };
  }
}

const kv = new FileKv();

// ---------- file-backed actor storage + alarm ----------

type ActorKind = "OrchestratorAgent" | "TranscriberAgent";

interface ActorSlot {
  storage: Map<string, unknown>;
  alarmTimer: NodeJS.Timeout | null;
  alarmAt: number | null;
}

const slots = new Map<string, ActorSlot>();

function slotOf(kind: ActorKind, name: string): ActorSlot {
  const key = `${kind}#${name}`;
  let slot = slots.get(key);
  if (!slot) {
    slot = { storage: new Map(), alarmTimer: null, alarmAt: null };
    const file = path.join(STORE_DIR, `${encodeURIComponent(key)}.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) slot.storage.set(k, v);
      } catch {
        // Corrupt snapshot — start clean.
      }
    }
    slots.set(key, slot);
  }
  return slot;
}

function saveSlot(kind: ActorKind, name: string): void {
  const slot = slots.get(`${kind}#${name}`);
  if (!slot) return;
  const file = path.join(STORE_DIR, `${encodeURIComponent(`${kind}#${name}`)}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(slot.storage)));
  } catch {
    // Non-serializable value — skip the snapshot this turn.
  }
}

function actorStorage(kind: ActorKind, name: string) {
  const slot = () => slotOf(kind, name);
  const persist = () => saveSlot(kind, name);
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return slot().storage.get(key) as T | undefined;
    },
    async put<T = unknown>(key: string, value: T): Promise<void> {
      slot().storage.set(key, value);
      persist();
    },
    async delete(key: string): Promise<boolean> {
      const existed = slot().storage.delete(key);
      persist();
      return existed;
    },
    async list<T = unknown>(options?: {
      limit?: number;
      startAfter?: string;
      prefix?: string;
    }): Promise<Map<string, T>> {
      const all = [...slot().storage.keys()].sort();
      const filtered = all.filter((k) => {
        if (options?.prefix && !k.startsWith(options.prefix)) return false;
        if (options?.startAfter && !(k > options.startAfter)) return false;
        return true;
      });
      const m = new Map<string, T>();
      const limit = options?.limit ?? filtered.length;
      for (const k of filtered.slice(0, limit)) m.set(k, slot().storage.get(k) as T);
      return m;
    },
    async deleteAll(): Promise<void> {
      slot().storage.clear();
      persist();
    },
    async transaction<T>(fn: (txn: unknown) => Promise<T>): Promise<T> {
      return fn(this);
    },
    transactionSync<T>(fn: () => T): T {
      return fn();
    },
    sql: undefined,
    async setAlarm(when: number): Promise<void> {
      const s = slot();
      if (s.alarmTimer) clearTimeout(s.alarmTimer);
      s.alarmAt = when;
      const delay = Math.max(when - Date.now(), 0);
      s.alarmTimer = setTimeout(() => {
        s.alarmTimer = null;
        s.alarmAt = null;
        const agent = resolveActor(kind, name);
        if (agent) {
          agent.alarm({ retryCount: 0, isRetry: false }).catch((err) => {
            console.error(`[dev] alarm drain failed for ${kind}#${name}:`, err);
          });
        }
      }, delay);
    },
    async getAlarm(): Promise<number | null> {
      return slot().alarmAt;
    },
    async deleteAlarm(): Promise<void> {
      const s = slot();
      if (s.alarmTimer) clearTimeout(s.alarmTimer);
      s.alarmTimer = null;
      s.alarmAt = null;
    },
  };
}

// ---------- in-process actor instances ----------

const instances = new Map<string, OrchestratorAgent | TranscriberAgent>();
const liveChildren = new Map<string, { name: string; type: string; status: string; createdAt: Date }>();

function resolveActor(kind: ActorKind, name: string): OrchestratorAgent | TranscriberAgent | undefined {
  return instances.get(`${kind}#${name}`);
}

/**
 * Local actors: the SDK's platform-backed spawn/despawn/children need the edge
 * runtime, so the local host provides in-process equivalents. queue/schedule
 * and the alarm drain stay on the real SDK machinery (storage + timers).
 */
class LocalOrchestratorAgent extends OrchestratorAgent {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  protected override async spawn(_ns: any, name?: string): Promise<any> {
    const childName = name ?? `auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    liveChildren.set(childName, {
      name: childName,
      type: "TranscriberAgent",
      status: "RUNNING",
      createdAt: new Date(),
    });
    getOrCreateAgent("TranscriberAgent", childName);
    return TRANSCRIBER.idFromName(childName);
  }

  protected override async despawn(child: string | { id: string }): Promise<void> {
    const name = typeof child === "string" ? child : child.id;
    liveChildren.delete(name);
    instances.delete(`TranscriberAgent#${name}`);
    const slot = slots.get(`TranscriberAgent#${name}`);
    if (slot) {
      if (slot.alarmTimer) clearTimeout(slot.alarmTimer);
      slot.storage.clear();
      const file = path.join(STORE_DIR, `${encodeURIComponent(`TranscriberAgent#${name}`)}.json`);
      if (fs.existsSync(file)) fs.rmSync(file);
      slots.delete(`TranscriberAgent#${name}`);
    }
  }

  protected override async children(): Promise<
    { name: string; type: string; status: string; createdAt: Date }[]
  > {
    return [...liveChildren.values()];
  }
}

class LocalTranscriberAgent extends TranscriberAgent {}

function makeCtx(kind: ActorKind, name: string) {
  return {
    id: name,
    storage: actorStorage(kind, name),
    blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
  };
}

function secretsBinding() {
  return {
    get: async (k: string) => process.env[k] ?? null,
  };
}

function getOrCreateAgent(kind: ActorKind, name: string): OrchestratorAgent | TranscriberAgent {
  const existing = resolveActor(kind, name);
  if (existing) return existing;
  let agent: OrchestratorAgent | TranscriberAgent;
  if (kind === "OrchestratorAgent") {
    const env: OrchestratorEnv = {
      SECRETS: secretsBinding() as never,
      ORCHESTRATOR: ORCHESTRATOR as never,
      TRANSCRIBER: TRANSCRIBER as never,
      JOB_KV: kv as never,
      MOCK_AUDIO_URLS: process.env.MOCK_AUDIO_URLS ?? "",
      TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL,
      STUCK_TIMEOUT_SECONDS: process.env.STUCK_TIMEOUT_SECONDS,
      MAX_CHILD_ATTEMPTS: process.env.MAX_CHILD_ATTEMPTS,
      DEMO_HANG_FILES: process.env.DEMO_HANG_FILES,
      DEMO_HANG_MS: process.env.DEMO_HANG_MS,
    };
    agent = new LocalOrchestratorAgent(makeCtx(kind, name) as never, env as never);
  } else {
    const env = {
      SECRETS: secretsBinding(),
      PARENT: ORCHESTRATOR,
      JOB_KV: kv,
      TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL,
      DEMO_HANG_FILES: process.env.DEMO_HANG_FILES,
      DEMO_HANG_MS: process.env.DEMO_HANG_MS,
    };
    agent = new LocalTranscriberAgent(makeCtx(kind, name) as never, env as never);
  }
  instances.set(`${kind}#${name}`, agent);
  return agent;
}

/** Minimal ActorNamespace look-alike backed by in-process instances. */
function makeNamespace(kind: ActorKind) {
  return {
    idFromName: (name: string) => {
      const base: Record<string, unknown> = {
        id: name,
        fetch: async (req: Request) => (resolveActor(kind, name) as OrchestratorAgent).fetch(req),
      };
      return new Proxy(base, {
        get: (target, prop) => {
          if (typeof prop !== "string" || prop === "then") return undefined;
          if (prop in target) return target[prop];
          return (...args: unknown[]) => {
            const agent = getOrCreateAgent(kind, name);
            const fn = (agent as unknown as Record<string, unknown>)[prop];
            if (typeof fn !== "function") {
              return Promise.reject(new Error(`No method ${prop} on ${kind}`));
            }
            return Promise.resolve((fn as (...a: unknown[]) => unknown).apply(agent, args));
          };
        },
      });
    },
  };
}

const ORCHESTRATOR = makeNamespace("OrchestratorAgent");
const TRANSCRIBER = makeNamespace("TranscriberAgent");

// ---------- env for the default handler ----------

const handlerEnv = {
  SECRETS: secretsBinding(),
  ORCHESTRATOR: ORCHESTRATOR,
  TRANSCRIBER: TRANSCRIBER,
  JOB_KV: kv,
  MOCK_AUDIO_URLS: process.env.MOCK_AUDIO_URLS ?? "",
  TRANSCRIPTION_MODEL: process.env.TRANSCRIPTION_MODEL,
  STUCK_TIMEOUT_SECONDS: process.env.STUCK_TIMEOUT_SECONDS,
  MAX_CHILD_ATTEMPTS: process.env.MAX_CHILD_ATTEMPTS,
  DEMO_HANG_FILES: process.env.DEMO_HANG_FILES,
  DEMO_HANG_MS: process.env.DEMO_HANG_MS,
} as never;

// ---------- node http → web Request bridge ----------

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
      body: body.length ? body : undefined,
    });
    try {
      const webRes = await (handler as { fetch: (r: Request, e: never) => Promise<Response> }).fetch(
        webReq,
        handlerEnv
      );
      const headers: Record<string, string> = {};
      webRes.headers.forEach((v, k) => {
        headers[k] = v;
      });
      res.writeHead(webRes.status, headers);
      const text = await webRes.text();
      res.end(text);
    } catch (err) {
      console.error("[dev] handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error (see dev server logs)" }));
    }
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`
  Port ${PORT} is already in use — another dev server is probably still running.

  Kill it and retry:
    kill -9 $(lsof -ti :${PORT})

  Or run on a different port:
    PORT=8788 npm run dev
`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`
  Clinic Transcription Console — local dev
  ────────────────────────────────────────
  UI:      http://localhost:${PORT}
  KV:      ${path.join(STORE_DIR, "kv.json")}
  Actors:  ${STORE_DIR}/<type>#<name>.json

  Kill this process to simulate the 3am power event — durable state and KV
  survive; re-post the same job from the console to watch recovery.
  Demo mode is ON unless .env sets DEMO_MODE=false.
`);
});
