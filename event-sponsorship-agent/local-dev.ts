/**
 * Local dev runner — runs the real fetch handler + real SponsorAgent actors
 * in-process with mock bindings, so you can open the microsite UI and chat
 * without deploying.
 *
 *   npm run dev          (or: npx vite-node local-dev.ts)
 *   open http://localhost:8787
 *
 * Mock bindings (mirrors telnyx.toml):
 *   - RATE_LIMIT_KV   → in-memory KV
 *   - LEADS_DB        → real SQLite (node:sqlite, in-memory)
 *   - SPONSOR_AGENT   → real SponsorAgent instances, one per idFromName(),
 *                       with in-memory durable state (Map-backed ActorStorage)
 *   - TELNYX          → stubbed: inference returns canned replies, SMS/WhatsApp
 *                       sends are logged. DEMO_MODE=true also gates sends.
 *
 * Notes: scheduled follow-ups (this.schedule) persist in actor state but the
 * alarm timer only drains on the deployed platform — locally they stay queued.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import handler, { SponsorAgent, type SponsorEnv } from "./src/index";
import type {
  ActorStorage,
  KvNamespace,
  SqlDatabase,
  SqlPreparedStatement,
  SqlQueryResult,
} from "@telnyx/edge-runtime";

// node:sqlite via createRequire — vite-node doesn't recognize it as a builtin
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { get: (...p: never[]) => any; all: (...p: never[]) => any[]; run: (...p: never[]) => any };
  };
};

const PORT = Number(process.env.PORT || 8787);
const HERE = dirname(fileURLToPath(import.meta.url));

// ── .env loader (no dotenv dependency) ─────────────────────────────────
function loadEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(HERE, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env — fall back to defaults below
  }
  return out;
}
const fileEnv = loadEnvFile();
const envOf = (k: string, dflt: string) => process.env[k] || fileEnv[k] || dflt;

// ── KV shim (in-memory) ────────────────────────────────────────────────
function makeKv(): KvNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, options?: { type?: string }) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return options?.type === "json" ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KvNamespace;
}

// ── SQLDB shim over node:sqlite ────────────────────────────────────────
function makeSqlDb(): SqlDatabase {
  const db = new DatabaseSync(":memory:");
  const wrapMeta = () => ({ duration: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changes: 0 });

  const prepare = (sql: string): SqlPreparedStatement => {
    let params: unknown[] = [];
    const obj: SqlPreparedStatement = {
      bind: (...values: unknown[]) => {
        params = values;
        return obj;
      },
      first: async (column?: string) => {
        const row = db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        return column ? (row[column] ?? null) : row;
      },
      run: async () => {
        db.prepare(sql).run(...(params as never[]));
        return { results: [], success: true, meta: wrapMeta() } as SqlQueryResult;
      },
      all: async () => {
        const rows = db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
        return { results: rows, success: true, meta: wrapMeta() } as SqlQueryResult;
      },
      raw: async () => {
        const rows = db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
        return rows.map((r) => Object.values(r));
      },
    } as unknown as SqlPreparedStatement;
    return obj;
  };

  return {
    prepare: (query: string) => prepare(query),
    batch: async (statements) => {
      const out: SqlQueryResult[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    exec: async (query: string) => {
      db.exec(query);
      return { count: query.split(";").filter((s) => s.trim()).length, duration: 0 };
    },
  } as SqlDatabase;
}

// ── ActorStorage shim (Map-backed; no SQL → kv backing) ────────────────
function makeMemoryStorage(): ActorStorage {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    get: async (key) => structuredClone(map.get(key)),
    put: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    delete: async (key) => map.delete(key),
    list: async (options) => {
      let keys = [...map.keys()].sort();
      if (options?.prefix) keys = keys.filter((k) => k.startsWith(options.prefix!));
      if (options?.startAfter) keys = keys.filter((k) => k > options.startAfter!);
      if (options?.reverse) keys.reverse();
      const limit = options?.limit ?? 100;
      return new Map(keys.slice(0, limit).map((k) => [k, structuredClone(map.get(k))]));
    },
    deleteAll: async () => {
      map.clear();
    },
    transaction: async (fn) => fn({
      get: (key) => map.get(key),
      put: (key, value) => {
        map.set(key, value);
      },
      delete: (key) => map.delete(key),
      list: () => new Map(map),
    }),
    transactionSync: (fn) => fn(),
    setAlarm: async (when) => {
      alarm = when;
    },
    getAlarm: async () => alarm,
    deleteAlarm: async () => {
      alarm = null;
    },
  } as unknown as ActorStorage;
}

// ── TELNYX stub ────────────────────────────────────────────────────────
function makeTelnyxStub() {
  return {
    messages: {
      send: async (params: { to: string; from: string; text: string }) => {
        console.log(`[SMS] ${params.from} → ${params.to}: ${params.text}`);
        return { id: "local-stub" };
      },
    },
    ai: {
      openai: {
        chat: {
          createCompletion: async (params: {
            model: string;
            messages: Array<{ role: string; content: string }>;
          }) => {
            const system = params.messages[0]?.content ?? "";
            const userText = params.messages.find((m) => m.role === "user")?.content ?? "";

            // Language-detection prompt → tiny heuristic so the multilingual
            // path is locally testable
            if (system.startsWith("Detect the language")) {
              const heuristics: Array<[RegExp, string]> = [
                [/(hola|gracias|cómo|qué tal|buenos días)/i, "es"],
                [/(bonjour|merci|comment ça va)/i, "fr"],
                [/(hallo|danke|guten tag)/i, "de"],
                [/(olá|obrigado|bom dia)/i, "pt"],
                [/(ciao|grazie|buongiorno)/i, "it"],
                [/(こんにちは|ありがとう)/, "ja"],
                [/(你好|谢谢)/, "zh"],
              ];
              const hit = heuristics.find(([re]) => re.test(userText));
              return { choices: [{ message: { content: hit ? hit[1] : "en" } }] };
            }

            // Translation prompt → visibly mark the language path (a real
            // deployment translates via inference)
            if (system.startsWith("Translate the message below")) {
              const lang = system.match(/code "([a-z-]+)"/)?.[1] ?? "en";
              return { choices: [{ message: { content: `[${lang}] ${userText}` } }] };
            }

            return { choices: [{ message: { content: `(local stub) ${params.model}: I can help with the giveaway, product questions, or booking a demo.` } }] };
          },
        },
      },
    },
    calls: {
      create: async (params: Record<string, any>) => {
        console.log(`[CALL] ${JSON.stringify(params).slice(0, 120)}`);
        return { call_control_id: "local-stub" };
      },
    },
    v2: {
      messages: {
        create: async (params: Record<string, any>) => {
          console.log(`[WHATSAPP] ${JSON.stringify(params).slice(0, 120)}`);
          return { id: "local-stub" };
        },
      },
    },
  };
}

// ── Assemble env ───────────────────────────────────────────────────────
function makeEnv(): SponsorEnv {
  const actors = new Map<string, SponsorAgent>();
  const makeStub = (name: string) => {
    let agent = actors.get(name);
    if (!agent) {
      agent = new SponsorAgent(
        {
          id: name,
          storage: makeMemoryStorage(),
          blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
        } as any,
        env,
      );
      actors.set(name, agent);
    }
    return new Proxy(agent, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (["fetch", "webSocket", "alarm", "constructor"].includes(String(prop))) return undefined;
        return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
      },
    }) as any;
  };

  const env: SponsorEnv = {
    SPONSOR_AGENT: { idFromName: makeStub, newUniqueId: makeStub } as any,
    SECRETS: { get: async (k: string) => process.env[k] ?? fileEnv[k] ?? null } as any,
    LEADS_DB: makeSqlDb(),
    RATE_LIMIT_KV: makeKv(),
    TELNYX: makeTelnyxStub() as any,
  };
  return env;
}

// [env_vars] equivalent: config reaches the code via process.env on the
// platform, so the local runner sets it the same way.
for (const [k, v] of Object.entries({
  AI_MODEL: "moonshotai/Kimi-K2.6",
  DEMO_MODE: "true",
  SALES_TEAM_NUMBER: "+15550000001",
  FROM_NUMBER: "+15550000000",
  EVENT_NAME: "TechHorizon Summit 2026",
  GIVEAWAY_PRIZE: "Telnyx Developer Kit",
  EMAIL_FROM: "onboarding@mail.telnyx.com",
  EMAIL_TO: "you@example.com",
  FOLLOWUP_DELAY_SECONDS: "300",
})) {
  process.env[k] = process.env[k] || fileEnv[k] || v;
}

const env = makeEnv();

// ── HTTP server ────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: ["GET", "HEAD"].includes(req.method || "") ? undefined : body,
    });

    const response = await handler.fetch(request, env);

    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error("Unhandled request error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  event-sponsorship-agent (local dev, DEMO_MODE=${env.DEMO_MODE})`);
  console.log(`  →  http://localhost:${PORT}          (microsite chat UI)`);
  console.log(`  →  http://localhost:${PORT}/health    (health check)`);
  console.log(`  →  curl -X POST http://localhost:${PORT}/api/chat -H 'Content-Type: application/json' -d '{"text":"giveaway"}'`);
  console.log(`  →  curl http://localhost:${PORT}/api/report\n`);
});
