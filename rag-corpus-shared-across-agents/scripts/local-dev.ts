/**
 * Local development harness.
 *
 * Runs the REAL worker (`src/index.ts`) and the REAL agent classes (Agent
 * SDK) inside Node — no deployment needed. The `TELNYX` binding is
 * reconstructed with your API key from `.env`, so asks and ingest perform
 * REAL inference calls. The `KNOWLEDGE` bucket binding is stood in by the
 * local `./knowledge/` directory. Storage is in-memory SQLite; state resets
 * on restart.
 *
 *   cp .env.example .env   # add TELNYX_API_KEY
 *   npm run local:dev      # http://localhost:8787
 */
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Telnyx from "telnyx";
import type {
  ActorContext,
  ActorNamespace,
  ActorStorage,
  CloudStorageBucket,
  CloudStorageObject,
  CloudStoragePutBody,
  ListOptions,
  SqlBindValue,
  SqlValue,
  StorageTransaction,
} from "@telnyx/edge-runtime";
import worker from "../src/index.js";
import { CorpusAgent } from "../src/corpus-agent.js";
import { PersonaAgent } from "../src/persona-agent.js";
import type { Env } from "../src/types.js";

const PORT = Number(process.env.PORT || "8787");
const KNOWLEDGE_DIR = join(new URL("..", import.meta.url).pathname, "knowledge");

function loadDotEnv(): void {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // No .env file — env vars must come from the shell.
  }
}

// Node's built-in SQLite backs the actor SQL surface with real semantics.
const require_ = createRequire(import.meta.url);
const { DatabaseSync } = require_("node:sqlite") as typeof import("node:sqlite");

class SqliteCursor<T extends Record<string, SqlValue>> {
  constructor(private readonly rows: T[]) {}
  toArray(): T[] {
    return this.rows;
  }
  [Symbol.iterator](): Iterator<T> {
    return this.rows[Symbol.iterator]();
  }
}

class SqliteStorageSurface {
  private readonly db = new DatabaseSync(":memory:");

  exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlBindValue[]
  ): SqliteCursor<T> {
    const stmt = this.db.prepare(query);
    const args = bindings.map((b) => (typeof b === "boolean" ? (b ? 1 : 0) : b));
    const rows = (
      args.length > 0 ? stmt.all(...(args as Parameters<typeof stmt.all>)) : stmt.all()
    ) as unknown as T[];
    return new SqliteCursor<T>(rows);
  }

  runTransactionSync<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** KV surface over a Map; SQL backed by real in-memory SQLite. */
class LocalStorage implements ActorStorage {
  readonly sql = new SqliteStorageSurface();
  private readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.has(key) ? (this.data.get(key) as T) : undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list<T>(options?: ListOptions): Promise<Map<string, T>> {
    const entries = [...this.data.entries()].filter(([k]) =>
      options?.prefix ? k.startsWith(options.prefix) : true,
    ) as [string, T][];
    return new Map(entries);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
  async transaction<T>(fn: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return fn(this.txnView());
  }
  transactionSync<T>(fn: () => T): T {
    return fn();
  }
  async setAlarm(): Promise<void> {}
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async deleteAlarm(): Promise<void> {}

  private txnView(): StorageTransaction {
    return {
      get: (key) => this.get(key),
      put: (key, value) => this.put(key, value),
      delete: (key) => this.delete(key),
      list: (options) => this.list(options),
    };
  }
}

function makeContext(id: string, storage: ActorStorage): ActorContext {
  // Platform seam: the real ActorContext arrives from the Edge runtime.
  return {
    id,
    storage,
    blockConcurrencyWhile: <T,>(fn: () => Promise<T>): Promise<T> => fn(),
    broadcast: () => 0,
    count: () => 0,
  } as unknown as ActorContext;
}

/** Actor namespace stand-in: one lazily-constructed actor per name. */
function makeNamespace(
  ctor: new (ctx: ActorContext, env: Env) => unknown,
  env: Env,
): ActorNamespace<never> {
  const actors = new Map<string, unknown>();
  return {
    idFromName(name: string): unknown {
      let actor = actors.get(name);
      if (!actor) {
        actor = new ctor(makeContext(name, new LocalStorage()), env);
        actors.set(name, actor);
      }
      return new Proxy(actor as Record<string, unknown>, {
        get(obj, prop) {
          const value = Reflect.get(obj, prop);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(obj) : value;
        },
      });
    },
  } as ActorNamespace<never>;
}

/** The ./knowledge/ directory stands in for the Cloud Storage bucket. */
function makeLocalBucket(): CloudStorageBucket {
  const keyToPath = (key: string) => join(KNOWLEDGE_DIR, key);
  const objectMeta = (key: string): CloudStorageObject => ({
    key,
    writeHttpMetadata: () => {},
  });
  return {
    async get(key: string) {
      const path = keyToPath(key);
      if (!existsSync(path)) return null;
      const text = readFileSync(path, "utf8");
      return {
        ...objectMeta(key),
        size: text.length,
        body: null as unknown as ReadableStream,
        bodyUsed: false,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
        blob: async () => new Blob([text]),
      };
    },
    async head(key: string) {
      return existsSync(keyToPath(key)) ? objectMeta(key) : null;
    },
    async put(key: string, body: CloudStoragePutBody) {
      const text = typeof body === "string" ? body : "";
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(KNOWLEDGE_DIR, { recursive: true });
      writeFileSync(keyToPath(key), text);
      return objectMeta(key);
    },
    async delete() {},
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      const objects = existsSync(KNOWLEDGE_DIR)
        ? readdirSync(KNOWLEDGE_DIR)
            .filter((f) => f.startsWith(prefix))
            .map(objectMeta)
        : [];
      return { objects, delimitedPrefixes: [], truncated: false };
    },
    createMultipartUpload: () => {
      throw new Error("local-dev: multipart upload is not supported by the ./knowledge stand-in");
    },
    resumeMultipartUpload: () => {
      throw new Error("local-dev: multipart upload is not supported by the ./knowledge stand-in");
    },
  } as unknown as CloudStorageBucket;
}

function toRequest(req: IncomingMessage): Promise<Request> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const host = req.headers.host ?? `localhost:${PORT}`;
      const body = Buffer.concat(chunks);
      resolve(
        new Request(`http://${host}${req.url ?? "/"}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body,
        }),
      );
    });
    req.on("error", reject);
  });
}

loadDotEnv();

const env = {} as Env;
env.CORPUS = makeNamespace(CorpusAgent, env);
env.PERSONAS = makeNamespace(PersonaAgent, env);
env.TELNYX = new Telnyx({ apiKey: process.env.TELNYX_API_KEY ?? "" });
env.KNOWLEDGE = makeLocalBucket();

createServer(async (req, res) => {
  try {
    const response = await worker.fetch(await toRequest(req), env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "local-dev: handler failed", detail: String(error) }));
  }
}).listen(PORT, () => {
  console.log(`rag-corpus-shared-across-agents (local) → http://localhost:${PORT}`);
  console.log(`bucket stand-in: ${KNOWLEDGE_DIR} (drop .txt files there, then POST /api/corpus/<id>/ingest-bucket)`);
});
