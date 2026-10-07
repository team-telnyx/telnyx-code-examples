/**
 * Local dev server for appointment-recovery-waitlist.
 *
 * Runs the REAL agent code (the same classes that ship to Telnyx Edge) behind
 * a tiny file-backed actor host, so the full demo flow works locally with
 * zero account-side effects:
 *
 *  - actor storage   -> .dev-store/actors.json  (survives restarts)
 *  - outreach ledger -> .dev-store/ledger.json (survives restarts)
 *  - HTTP surface    -> mod.fetch (the same fetch handler that ships)
 *
 * DEMO_MODE is on by default: outbound calls/SMS are logged, and patient
 * replies are driven via POST /demo/reply and POST /demo/call-event.
 *
 * Kill this process mid-outreach and rerun — the slot actor wakes with the
 * same waitlist cursor and confirmation lock. That is the restart proof.
 *
 * Run: npm run dev  →  http://localhost:8787
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import mod, {
  AppointmentSlot,
  SlotIndex,
  type AttemptRecord,
  type ConfirmationRecord,
  type Env,
} from "./src/index";

const PORT = Number(process.env.PORT) || 8787;
const STORE_DIR = path.join(process.cwd(), ".dev-store");
const ACTORS_FILE = path.join(STORE_DIR, "actors.json");
const LEDGER_FILE = path.join(STORE_DIR, "ledger.json");

fs.mkdirSync(STORE_DIR, { recursive: true });

// ---------- file-backed durable stores ----------

const actorStores = new Map<string, Map<string, unknown>>();
const ledgerStore = new Map<
  string,
  { attempts: AttemptRecord[]; confirmations: ConfirmationRecord[] }
>();

function loadJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[dev] could not parse ${file}:`, err instanceof Error ? err.message : err);
    return {};
  }
}

for (const [key, entries] of Object.entries(loadJson(ACTORS_FILE))) {
  actorStores.set(key, new Map(Object.entries(entries as Record<string, unknown>)));
}
for (const [key, value] of Object.entries(loadJson(LEDGER_FILE))) {
  ledgerStore.set(key, value as { attempts: AttemptRecord[]; confirmations: ConfirmationRecord[] });
}

function persistActors(): void {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, store] of actorStores) out[key] = Object.fromEntries(store);
  fs.writeFileSync(ACTORS_FILE, JSON.stringify(out));
}

function persistLedgers(): void {
  const out: Record<string, unknown> = {};
  for (const [key, value] of ledgerStore) out[key] = value;
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(out));
}

type AnyRecord = Record<string, unknown>;

function makeActorStorage(store: Map<string, unknown>): AnyRecord {
  return {
    async get(key: string) {
      return store.get(key);
    },
    async put(key: string, value: unknown) {
      store.set(key, JSON.parse(JSON.stringify(value ?? null)));
      persistActors();
    },
    async delete(key: string) {
      store.delete(key);
      persistActors();
    },
    async list<T>(options?: { limit?: number; startAfter?: string; prefix?: string }): Promise<Map<string, T>> {
      const all = [...store.keys()].sort();
      const filtered = all.filter((k) => {
        if (options?.prefix && !k.startsWith(options.prefix)) return false;
        if (options?.startAfter && !(k > options.startAfter)) return false;
        return true;
      });
      const limit = Math.min(options?.limit ?? filtered.length, filtered.length);
      const out = new Map<string, T>();
      for (const k of filtered.slice(0, limit)) out.set(k, store.get(k) as T);
      return out;
    },
    async deleteAll() {
      store.clear();
      persistActors();
    },
    async transaction<T>(fn: (txn: AnyRecord) => Promise<T>): Promise<T> {
      return fn(this);
    },
    transactionSync<T>(fn: () => T): T {
      return fn();
    },
    async setAlarm() {},
    async getAlarm() {
      return null;
    },
    async deleteAlarm() {},
  };
}

function blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// ---------- actor registry + mock env ----------

const actors = new Map<string, AppointmentSlot | SlotIndex>();

function ledgerFor(actorId: string): { attempts: AttemptRecord[]; confirmations: ConfirmationRecord[] } {
  let entry = ledgerStore.get(actorId);
  if (!entry) {
    entry = { attempts: [], confirmations: [] };
    ledgerStore.set(actorId, entry);
    persistLedgers();
  }
  return entry;
}

class DevSlot extends AppointmentSlot {
  protected override ensureTables(): void {
    /* in-memory ledger; nothing to create */
  }

  protected override recordAttempt(a: AttemptRecord): void {
    ledgerFor(String(this.ctx.id)).attempts.push(a);
    persistLedgers();
  }

  protected override recordConfirmation(c: ConfirmationRecord): boolean {
    const ledger = ledgerFor(String(this.ctx.id));
    if (ledger.confirmations.some((x) => x.slotId === c.slotId)) return false;
    ledger.confirmations.push(c);
    persistLedgers();
    return true;
  }

  protected override existingConfirmation(slotId: string): ConfirmationRecord | null {
    return ledgerFor(String(this.ctx.id)).confirmations.find((x) => x.slotId === slotId) ?? null;
  }

  protected override attemptsFor(slotId: string): AttemptRecord[] {
    return ledgerFor(String(this.ctx.id)).attempts.filter((a) => a.slotId === slotId);
  }

  protected override async schedule(
    delaySeconds: number,
    method: string,
    payload?: unknown,
    opts?: { id?: string },
  ): Promise<string> {
    const id = opts?.id ?? `task-${Date.now()}`;
    console.log(`[dev] schedule ${method} in ${delaySeconds}s (id=${id})`);
    if (delaySeconds > 0) {
      setTimeout(() => {
        void this.runScheduled(method, payload).catch((err) =>
          console.error(`[dev] scheduled ${method} failed:`, err instanceof Error ? err.message : err),
        );
      }, delaySeconds * 1000);
    } else {
      await this.runScheduled(method, payload);
    }
    return id;
  }

  private async runScheduled(method: string, payload: unknown): Promise<void> {
    const fn = (this as unknown as Record<string, ((p?: unknown) => Promise<unknown>) | undefined>)[method];
    if (typeof fn !== "function") {
      console.error(`[dev] no scheduled method named ${method}`);
      return;
    }
    await fn.call(this, payload);
  }
}

function slotActorFor(name: string): AppointmentSlot {
  const key = `slot:${name}`;
  const existing = actors.get(key);
  if (existing instanceof AppointmentSlot) return existing;
  const slot = new DevSlot(
    { id: key, storage: makeActorStorage(storeFor(key)), blockConcurrencyWhile } as never,
    ENV,
  );
  actors.set(key, slot);
  return slot;
}

function indexActorFor(): SlotIndex {
  const key = "slot-index:index";
  const existing = actors.get(key);
  if (existing instanceof SlotIndex) return existing;
  const index = new SlotIndex(
    { id: key, storage: makeActorStorage(storeFor(key)), blockConcurrencyWhile } as never,
    ENV,
  );
  actors.set(key, index);
  return index;
}

function storeFor(key: string): Map<string, unknown> {
  let store = actorStores.get(key);
  if (!store) {
    store = new Map<string, unknown>();
    actorStores.set(key, store);
  }
  return store;
}

function bindAll(instance: object, methods: string[]): Record<string, (...args: unknown[]) => unknown> {
  const stub: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of methods) {
    stub[m] = (instance[m as keyof object] as (...args: unknown[]) => unknown).bind(instance);
  }
  return stub;
}

function makeNamespace(kind: "slot" | "index"): AnyRecord {
  return {
    idFromName: (name: string): unknown => {
      if (kind === "index") {
        return bindAll(indexActorFor(), ["register", "clear", "lookup"]);
      }
      return bindAll(slotActorFor(name), [
        "openSlot",
        "onInboundMessage",
        "onCallEvent",
        "inspect",
        "ledgerSnapshot",
      ]);
    },
  };
}

const MOCK_ENV: AnyRecord = {
  SECRETS: { get: async (key: string) => process.env[key] ?? "" },
  TELNYX: {
    messages: {
      send: async (req: { to: string; text: string }) => {
        console.log(`[demo SMS] to=${req.to} text=${req.text}`);
        return {};
      },
    },
  },
};
MOCK_ENV.SLOTS = makeNamespace("slot");
MOCK_ENV.SLOT_INDEX = makeNamespace("index");
MOCK_ENV.DEMO_MODE = process.env.DEMO_MODE ?? "true";
const ENV = MOCK_ENV as unknown as Env;

// ---------- HTTP server ----------

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const request = new Request(`http://localhost:${PORT}${req.url ?? "/"}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : rawBody,
  });

  try {
    const response = await mod.fetch(request, ENV);
    const text = await response.text();
    res.writeHead(response.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (err) {
    console.error("[dev] request failed:", err instanceof Error ? err.message : err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, () => {
  console.log(`[dev] appointment-recovery-waitlist listening on http://localhost:${PORT}`);
  console.log("[dev] durable state in .dev-store/ — kill and rerun to see the restart proof");
});
