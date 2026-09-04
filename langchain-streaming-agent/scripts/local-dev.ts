/**
 * Local development harness.
 *
 * Runs the REAL worker (`src/index.ts`) and the REAL `StreamingAgent` (Agent
 * SDK) inside Node — no deployment needed. The Telnyx binding is reconstructed
 * with your API key from `.env`, so the agent performs REAL streaming
 * inference. Storage is in-memory; state resets on restart.
 *
 *   cp .env.example .env   # add TELNYX_API_KEY
 *   npm run local:dev      # http://localhost:8787
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import Telnyx from "telnyx";
import type {
  ActorContext,
  ActorStorage,
  ListOptions,
  SqlStorage,
  StorageTransaction,
} from "@telnyx/edge-runtime";
import worker from "../src/index.js";
import { StreamingAgent } from "../src/streaming-agent.js";
import type { Env } from "../src/types.js";

const PORT = Number(process.env.PORT || "8787");

// ---- .env ------------------------------------------------------------------

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

// ---- In-memory ActorStorage --------------------------------------------------

class InMemoryStorage implements ActorStorage {
  private readonly map = new Map<string, unknown>();
  private alarmAt: number | null = null;
  private alarmTimer: NodeJS.Timeout | null = null;
  /** Wired by the harness to invoke the actor's `alarm()` handler. */
  onAlarm: (() => void) | null = null;

  get sql(): SqlStorage {
    throw new Error("InMemoryStorage: SQL storage is not configured");
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list<T>(options?: ListOptions): Promise<Map<string, T>> {
    let entries = [...this.map.entries()] as [string, T][];
    if (options?.prefix) entries = entries.filter(([k]) => k.startsWith(options.prefix!));
    if (options?.reverse) entries.reverse();
    if (options?.limit !== undefined) entries = entries.slice(0, options.limit);
    return new Map(entries);
  }

  async deleteAll(): Promise<void> {
    this.map.clear();
  }

  async transaction<T>(fn: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return fn(this.transactionView());
  }

  transactionSync<T>(fn: () => T): T {
    return fn();
  }

  async setAlarm(when: number): Promise<void> {
    this.alarmAt = when;
    this.scheduleAlarm();
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    this.alarmTimer = null;
  }

  private scheduleAlarm(): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    if (this.alarmAt === null) return;
    const delay = Math.max(0, this.alarmAt - Date.now());
    this.alarmTimer = setTimeout(() => {
      this.alarmTimer = null;
      const callback = this.onAlarm;
      if (callback) callback();
    }, delay);
  }

  private transactionView(): StorageTransaction {
    return {
      get: (key) => this.get(key),
      put: (key, value) => this.put(key, value),
      delete: (key) => this.delete(key),
      list: (options) => this.list(options),
    };
  }
}

// ---- Mini actor host ---------------------------------------------------------

interface LocalActor {
  actor: StreamingAgent;
  sockets: Set<import("ws").WebSocket>;
}

const actors = new Map<string, LocalActor>();

function getContext(id: string, sockets: Set<import("ws").WebSocket>): {
  context: ActorContext;
  storage: InMemoryStorage;
} {
  const storage = new InMemoryStorage();
  const context = {
    id,
    storage,
    blockConcurrencyWhile: (fn: () => unknown): unknown => fn(),
    broadcast: (data: string | ArrayBuffer | ArrayBufferView): number => {
      const payload = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer);
      for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(payload);
      return sockets.size;
    },
    count: (): number => sockets.size,
  } as unknown as ActorContext;
  return { context, storage };
}

function getOrCreateActor(sessionId: string): LocalActor {
  let entry = actors.get(sessionId);
  if (!entry) {
    const sockets = new Set<import("ws").WebSocket>();
    const { context, storage } = getContext(sessionId, sockets);
    const actor = new StreamingAgent(context, env);
    storage.onAlarm = () => {
      void actor.alarm({ retryCount: 0, isRetry: false });
    };
    entry = { actor, sockets };
    actors.set(sessionId, entry);
  }
  return entry;
}

function makeStub(entry: LocalActor): unknown {
  const target = entry.actor as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === "fetch") {
        // Upgrades never reach worker.fetch locally; the harness handles the
        // server's 'upgrade' event and calls actor.webSocket directly.
        return () => {
          throw new Error("local-dev: WebSocket upgrades are handled by the 'upgrade' event");
        };
      }
      const value = Reflect.get(obj, prop) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(obj)
        : value;
    },
  });
}

const env: Env = {
  AGENTS: {
    idFromName: (id: string) => makeStub(getOrCreateActor(id)),
  },
  TELNYX: new Telnyx({ apiKey: process.env.TELNYX_API_KEY ?? "" }),
  AI_MODEL: process.env.AI_MODEL,
} as unknown as Env;

// ---- HTTP: node req/res → fetch Request/Response → worker.fetch --------------

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function fromResponse(res: Response, out: ServerResponse): Promise<void> {
  const body = Buffer.from(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  out.writeHead(res.status, headers);
  out.end(body);
}

// ---- Servers -----------------------------------------------------------------

loadDotEnv();

if (!process.env.TELNYX_API_KEY) {
  console.error("TELNYX_API_KEY is not set — add it to .env (the agent will fail).");
}

const httpServer = createServer(async (req, res) => {
  try {
    const response = await worker.fetch(await toRequest(req), env);
    await fromResponse(response, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error": "Internal server error"}');
  }
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if ((req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const sessionId = (url.searchParams.get("session") ?? "demo").replace(/[^a-zA-Z0-9_-]/g, "") || "demo";
  const entry = getOrCreateActor(sessionId);
  wss.handleUpgrade(req, socket, head, (ws) => {
    entry.sockets.add(ws);
    ws.on("close", () => entry.sockets.delete(ws));
    const handshake = new Request(url.href, { headers: req.headers as HeadersInit });
    void entry.actor.webSocket(ws, handshake);
  });
});

httpServer.listen(PORT, () => {
  console.log(`langchain-streaming-agent (local dev) → http://localhost:${PORT}`);
  console.log(`  demo UI:  http://localhost:${PORT}/?session=demo`);
  console.log("  Tokens stream live from Telnyx Inference via the LangChain agent loop.");
});
