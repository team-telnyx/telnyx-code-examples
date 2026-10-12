import { describe, it, expect, beforeEach } from "vitest";
import { TriageRouterV3, type Env } from "./src/index";

// Mock the Edge SQL storage the verified actor depends on.
// `exec(query, ...bindings)` returns a minimal SqlCursor (toArray()).
// Schema-migration queries (CREATE TABLE / legacy SELECT) are no-ops; the
// INSERT path stores rows; SELECT paths filter/order them like the SQL would.
class MockSqlStorage {
  rows: Array<Record<string, unknown>> = [];
  private nextTs = 1;

  exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } {
    const trimmed = query.trim();
    if (trimmed.startsWith("SELECT dest FROM routing")) {
      throw new Error("legacy routing table missing");
    }
    if (trimmed.startsWith("DROP TABLE")) {
      return { toArray: () => [] };
    }
    if (trimmed.startsWith("CREATE TABLE")) {
      return { toArray: () => [] };
    }
    if (trimmed.startsWith("INSERT INTO routing")) {
      const [line, caller, call_id, intent, transcript, stage] = bindings;
      const ts = (this.nextTs += 1);
      this.rows.push({ line, caller, call_id, intent, transcript, stage, ts });
      return { toArray: () => [] };
    }
    if (trimmed.startsWith("SELECT intent FROM routing WHERE caller = ?")) {
      const [caller] = bindings as [string];
      const filtered = this.rows
        .filter((r) => r.caller === caller && r.intent !== "pending")
        .sort((a, b) => Number(b.ts) - Number(a.ts));
      return { toArray: () => filtered.slice(0, 1).map((r) => ({ intent: r.intent })) };
    }
    if (trimmed.startsWith("SELECT intent, caller, call_id, transcript, stage, ts FROM routing")) {
      const sorted = [...this.rows].sort((a, b) => Number(b.ts) - Number(a.ts));
      return { toArray: () => sorted.slice(0, 10) };
    }
    return { toArray: () => [] };
  }
}

// Minimal in-memory ActorStorage — only the methods the Agent constructor
// touches during `beginActivation` / state / messages / events / tasks init.
function makeStorage(sql: MockSqlStorage): Record<string, unknown> {
  const store = new Map<string, unknown>();
  const noop = async () => {
    /* no-op */
  };
  return {
    sql,
    get: async (k: string) => store.get(k),
    put: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    delete: async (k: string) => store.delete(k),
    list: async () => new Map(store),
    deleteAll: async () => store.clear(),
    transaction: async <T>(fn: () => Promise<T>) => fn(),
    sqlExecSync: () => {
      throw new Error("sync SQL not used by TriageRouterV3");
    },
    transactionSync: <T>(fn: () => T): T => fn(),
    setAlarm: noop,
    getAlarm: async () => null,
    deleteAlarm: noop,
  };
}

// Build a TriageRouterV3 with mocked ctx/env — bypasses the runtime-only
// Agent constructor (state/messages/events/tasks are not used by the verified
// surface, only `this.ctx.storage.sql` is).
function makeRouter(): { router: TriageRouterV3; sql: MockSqlStorage } {
  const sql = new MockSqlStorage();
  const ctx = {
    id: "test-router",
    storage: makeStorage(sql),
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch {
        // Best-effort init — the verified actor surface only uses storage.sql,
        // not state/messages/events/tasks. Swallow init errors so they don't
        // surface as unhandled rejections after a test method returns.
        return undefined as unknown as T;
      }
    },
  };
  const env = {} as Env;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = new TriageRouterV3(ctx as any, env);
  return { router, sql };
}

describe("TriageRouterV3 (verified actor surface)", () => {
  let router: TriageRouterV3;
  let sql: MockSqlStorage;

  beforeEach(() => {
    ({ router, sql } = makeRouter());
  });

  it("is exported as a class", () => {
    expect(TriageRouterV3).toBeDefined();
    expect(typeof TriageRouterV3).toBe("function");
  });

  it("exposes logIntent, routes, and lastIntentFor on the prototype", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.logIntent).toBe("function");
    expect(typeof proto.routes).toBe("function");
    expect(typeof proto.lastIntentFor).toBe("function");
  });

  it("does NOT expose the deleted classifyIntent surface", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(proto.classifyIntent).toBeUndefined();
    expect(proto.onCall).toBeUndefined();
    expect(proto.onGatherResult).toBeUndefined();
    expect(proto.markTransferred).toBeUndefined();
    expect(proto.setPendingMisroute).toBeUndefined();
    expect(proto.pendingMisrouteFor).toBeUndefined();
    expect(proto.clearPendingMisroute).toBeUndefined();
  });

  it("logIntent writes a row into the routing log", async () => {
    await router.logIntent({
      caller: "+15550000001",
      intent: "billing",
      note: "question about insurance copay",
      call_id: "cc-abc",
    });
    expect(sql.rows).toHaveLength(1);
    const row = sql.rows[0];
    expect(row.caller).toBe("+15550000001");
    expect(row.intent).toBe("billing");
    expect(row.transcript).toBe("question about insurance copay");
    expect(row.stage).toBe("completed");
    expect(typeof row.ts).toBe("number");
  });

  it("logIntent records CALLSTART rows for inbound-call identity", async () => {
    await router.logIntent({
      caller: "+15550000002",
      intent: "CALLSTART",
      note: "cc-callstart-xyz",
      call_id: "cc-callstart-xyz",
    });
    const rows = await router.routes();
    expect(rows).toHaveLength(1);
    expect(rows[0].intent).toBe("CALLSTART");
    expect(rows[0].caller).toBe("+15550000002");
    expect(rows[0].call_id).toBe("cc-callstart-xyz");
  });

  it("routes() returns rows including CALLSTART and ESCALATED intents", async () => {
    await router.logIntent({ caller: "+15550000010", intent: "CALLSTART", note: "cc-1", call_id: "cc-1" });
    await router.logIntent({ caller: "+15550000010", intent: "billing", note: "billing q" });
    await router.logIntent({ caller: "+15550000011", intent: "ESCALATED 🚨", note: "chest pain :: CALLER: I can't breathe | AGENT: Connecting nurse" });

    const routes = await router.routes();
    const intents = routes.map((r) => r.intent);
    expect(intents).toContain("CALLSTART");
    expect(intents).toContain("billing");
    expect(intents).toContain("ESCALATED 🚨");
  });

  it("routes() is ordered most-recent first", async () => {
    await router.logIntent({ caller: "+15550000020", intent: "CALLSTART", note: "first", call_id: "cc-first" });
    await new Promise((r) => setTimeout(r, 2));
    await router.logIntent({ caller: "+15550000020", intent: "billing", note: "second" });
    const routes = await router.routes();
    expect(routes[0].intent).toBe("billing");
    expect(routes[1].intent).toBe("CALLSTART");
  });

  it("routes() caps results at 10 entries", async () => {
    for (let i = 0; i < 15; i += 1) {
      await router.logIntent({ caller: `+155500000${String(i).padStart(2, "0")}`, intent: "afterhours", note: `note ${i}` });
    }
    const routes = await router.routes();
    expect(routes.length).toBe(10);
  });

  it("lastIntentFor returns the most recent intent for a caller (filter on 'pending' is a no-op since the verified surface never writes 'pending')", async () => {
    await router.logIntent({ caller: "+15550000030", intent: "CALLSTART", note: "cc-x", call_id: "cc-x" });
    await router.logIntent({ caller: "+15550000030", intent: "billing", note: "first real" });
    await router.logIntent({ caller: "+15550000030", intent: "clinical", note: "second real" });
    const last = await router.lastIntentFor("+15550000030");
    expect(last).toBe("clinical");
  });

  it("lastIntentFor returns the most recent row even when only CALLSTART exists", async () => {
    await router.logIntent({ caller: "+15550000031", intent: "CALLSTART", note: "cc-y", call_id: "cc-y" });
    const last = await router.lastIntentFor("+15550000031");
    expect(last).toBe("CALLSTART");
  });

  it("lastIntentFor returns null for an unknown caller", async () => {
    const last = await router.lastIntentFor("+15550000999");
    expect(last).toBeNull();
  });

  it("is classify-free: no LLM/TELNYX binding is required for logIntent/routes", async () => {
    // logIntent and routes never touch env.TELNYX. Constructing the router
    // with an empty env (above) and exercising these methods without
    // configuring AI_MODEL/TELNYX_API_KEY is the proof.
    await router.logIntent({ caller: "+15550000040", intent: "billing", note: "x" });
    await router.routes();
    await router.lastIntentFor("+15550000040");
    // No exception thrown = the classify-free design holds.
    expect(true).toBe(true);
  });
});

describe("Default Export", () => {
  it("exposes a fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
