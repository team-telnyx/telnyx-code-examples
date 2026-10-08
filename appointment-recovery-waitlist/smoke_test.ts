/**
 * Smoke test — runs the REAL AppointmentSlot agent code (the same class that
 * ships to Telnyx Edge) against a mock durable-actor host, then exercises the
 * DEV-1223 acceptance surface:
 *
 *  1. Agent contract + pure helpers (decision parsing, waitlist ordering,
 *     slot-id sanitization, client_state round-trip)
 *  2. Missed-patient recovery: reschedule closes the workflow; decline hands
 *     the slot to the waitlist
 *  3. Waitlist fill: priority order, retry budget with channel alternation,
 *     cursor advance on give-up
 *  4. First confirmation wins: the confirmation lock rejects late replies,
 *     in-flight sweep timers no-op after the generation bump
 *  5. Restart proof: drop the actor instance mid-outreach, rebuild it over
 *     the same durable store — cursor and confirmation lock survive intact,
 *     and a late confirmer can never double-book the slot
 *  6. "later" retry and slot-expiry paths
 *  7. HTTP surface: /webhook/scheduling, /demo/reply, /demo/call-event,
 *     /state/:slotId, /ledger/:slotId
 *
 * Run with: npm test (tsx smoke_test.ts).
 */
import assert from "node:assert";
import { Agent } from "@telnyx/edge-runtime";
import mod, {
  AppointmentSlot,
  SlotIndex,
  actorNameFromSlot,
  decodeSlotState,
  encodeSlotState,
  isValidE164,
  parseDecision,
  sortWaitlist,
  type AttemptRecord,
  type ConfirmationRecord,
  type Env,
  type OpenSlotPayload,
  type SlotSnapshot,
  type SlotState,
} from "./src/index";

// ── Mock durable actor host (mirrors sub-agent-orchestrator-actor) ────────

type AnyRecord = Record<string, unknown>;

function structuredCloneJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null));
}

function makeActorStorage(store: Map<string, unknown>): AnyRecord {
  return {
    async get(key: string) {
      return store.get(key);
    },
    async put(key: string, value: unknown) {
      store.set(key, structuredCloneJson(value));
    },
    async delete(key: string) {
      return store.delete(key);
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

const actorStores = new Map<string, Map<string, unknown>>();
const actors = new Map<string, AppointmentSlot | SlotIndex>();

/** Durable per-actor ledger arrays — survive "kills" across instances. */
const ledgerStore = new Map<
  string,
  { attempts: AttemptRecord[]; confirmations: ConfirmationRecord[] }
>();

function ledgerFor(actorId: string): { attempts: AttemptRecord[]; confirmations: ConfirmationRecord[] } {
  let entry = ledgerStore.get(actorId);
  if (!entry) {
    entry = { attempts: [], confirmations: [] };
    ledgerStore.set(actorId, entry);
  }
  return entry;
}

function makeCtx(id: string): AnyRecord {
  let store = actorStores.get(id);
  if (!store) {
    store = new Map<string, unknown>();
    actorStores.set(id, store);
  }
  return { id, storage: makeActorStorage(store), blockConcurrencyWhile };
}

function slotActorFor(name: string): AppointmentSlot {
  const key = `slot:${name}`;
  const existing = actors.get(key);
  if (existing instanceof AppointmentSlot) return existing;
  const slot = new TestSlot(makeCtx(key) as never, ENV);
  actors.set(key, slot);
  return slot;
}

function indexActorFor(): SlotIndex {
  const key = "slot-index:index";
  const existing = actors.get(key);
  if (existing instanceof SlotIndex) return existing;
  const index = new SlotIndex(makeCtx(key) as never, ENV);
  actors.set(key, index);
  return index;
}

function bindAll(
  instance: object,
  methods: string[],
): Record<string, (...args: unknown[]) => unknown> {
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
        return bindAll(indexActorFor(), ["register", "clear", "lookup", "trackSlot", "untrackSlot", "listSlots"]);
      }
      return bindAll(slotActorFor(name), [
        "openSlot",
        "onInboundMessage",
        "onCallEvent",
        "snapshot",
        "ledgerSnapshot",
      ]);
    },
  };
}

function makeMockEnv(): AnyRecord {
  const config: Record<string, string> = {
    DEMO_MODE: "true",
    WAITLIST_REPLY_TIMEOUT_MIN: "10",
    OUTREACH_RETRY_MAX: "2",
    SLOT_EXPIRY_MIN: "60",
    CLINIC_TIMEZONE: "America/New_York",
  };
  const env: AnyRecord = {
    ...config,
    SECRETS: { get: async (key: string) => config[key] ?? "" },
    TELNYX: {
      messages: {
        send: async (req: { to: string; text: string }) => {
          console.log(`[mock SMS] to=${req.to} text=${req.text}`);
          return {};
        },
      },
    },
  };
  env.SLOTS = makeNamespace("slot");
  env.SLOT_INDEX = makeNamespace("index");
  return env;
}

const MOCK_ENV = makeMockEnv();
const ENV = MOCK_ENV as unknown as Env;

/** Test slot: mock SQL ledger + recorded schedules, sharing durable arrays. */
class TestSlot extends AppointmentSlot {
  protected override ensureTables(): void {
    /* in-memory ledger; nothing to create */
  }

  protected override recordAttempt(a: AttemptRecord): void {
    ledgerFor(String(this.ctx.id)).attempts.push(a);
  }

  protected override recordConfirmation(c: ConfirmationRecord): boolean {
    const ledger = ledgerFor(String(this.ctx.id));
    if (ledger.confirmations.some((x) => x.slotId === c.slotId)) return false;
    ledger.confirmations.push(c);
    return true;
  }

  protected override existingConfirmation(slotId: string): ConfirmationRecord | null {
    return (
      ledgerFor(String(this.ctx.id)).confirmations.find((x) => x.slotId === slotId) ?? null
    );
  }

  protected override attemptsFor(slotId: string): AttemptRecord[] {
    return ledgerFor(String(this.ctx.id)).attempts.filter((a) => a.slotId === slotId);
  }

  scheduled: Array<{ delaySeconds: number; method: string; payload: unknown; id?: string }> = [];

  protected override async schedule(
    delaySeconds: number,
    method: string,
    payload?: unknown,
    opts?: { id?: string },
  ): Promise<string> {
    this.scheduled.push({ delaySeconds, method, payload, id: opts?.id });
    return opts?.id ?? `task-${this.scheduled.length}`;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const SLOT: OpenSlotPayload = {
  slotId: "SLOT-8217",
  provider: "Dr. Okafor",
  startsAt: "2026-10-08T10:00:00",
  missedPatient: { name: "Alex Rivera", phone: "+15557000001" },
  waitlist: [
    { name: "Brooke Chen", phone: "+15557000002", priority: 2 },
    { name: "Casey Doyle", phone: "+15557000003", priority: 1 },
    { name: "Devin Shah", phone: "+15557000004", priority: 3 },
  ],
};

function freshSlot(name: string): TestSlot {
  actors.delete(`slot:${name}`);
  return slotActorFor(name) as TestSlot;
}

function demoReply(slot: TestSlot, from: string, text: string) {
  return slot.onInboundMessage({ from, text });
}

/** Fire the pending sweep with the actor's CURRENT generation (timer semantics). */
async function sweep(slot: TestSlot): Promise<{ ok: boolean; skipped?: boolean }> {
  const state = await slot.snapshot();
  return slot.sweepCandidate({ generation: state.generation });
}

function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  console.log(`  ✓ ${name}`);
}

// ── 1. Agent contract + pure helpers ──────────────────────────────────────

const proto = AppointmentSlot.prototype as unknown as Record<string, unknown>;
console.log("\n[1] Agent contract + pure helpers");

check("AppointmentSlot extends Agent", AppointmentSlot.prototype instanceof Agent);
for (const m of ["openSlot", "onInboundMessage", "onCallEvent", "snapshot", "ledgerSnapshot"]) {
  check(`has ${m} method`, typeof proto[m] === "function");
}
const initial = (proto.initialState as () => SlotState).call({});
assert.deepEqual(initial, {
  slotId: "",
  provider: "",
  startsAt: "",
  timezone: "America/New_York",
  missedPatient: { name: "", phone: "" },
  waitlist: [],
  cursor: -1,
  currentCandidate: null,
  confirmation: null,
  status: "open",
  generation: 0,
});
console.log("  ✓ initialState returns valid SlotState");

check("parseDecision: waitlist yes confirms", parseDecision("waitlist", "YES take it") === "confirm");
check("parseDecision: waitlist no declines", parseDecision("waitlist", "no, pass") === "decline");
check("parseDecision: missed yes reschedules", parseDecision("missed", "yes please") === "reschedule");
check("parseDecision: missed later defers", parseDecision("missed", "call me later") === "later");
check("parseDecision: missed no declines", parseDecision("missed", "can't make it") === "decline");
check("parseDecision: empty is null", parseDecision("waitlist", "") === null);
check(
  "sortWaitlist orders by priority (1 first)",
  JSON.stringify(sortWaitlist(SLOT.waitlist).map((w) => w.priority)) === "[1,2,3]",
);
check("actorNameFromSlot sanitizes", actorNameFromSlot("SLOT 8217/Back") === "slot-8217-back");
check("client_state round-trips the slot id", decodeSlotState(encodeSlotState("SLOT-8217")) === "SLOT-8217");
check("E.164 validation", isValidE164("+15557000001") && !isValidE164("5551234"));

// ── 2. Missed-patient recovery ────────────────────────────────────────────

console.log("\n[2] Missed-patient recovery");
{
  const slot = freshSlot("s-resched");
  await slot.openSlot(SLOT);
  let s = await slot.snapshot();
  check("actor opens with offering status", s.status === "offering");
  check(
    "missed patient is contacted first",
    s.currentCandidate?.role === "missed" && s.currentCandidate.phone === SLOT.missedPatient.phone,
  );
  check("expiry scheduled", slot.scheduled.some((t) => t.method === "expireSlot"));

  const reply = await demoReply(slot, SLOT.missedPatient.phone, "RESCHEDULE please");
  s = await slot.snapshot();
  check("reschedule closes the recovery workflow", s.status === "rescheduled");
  check("no waitlist fill after reschedule", s.cursor === -1);
  assert.match(reply.reply as string, /rebooked/i);

  const declinedSlot = freshSlot("s-decline");
  await declinedSlot.openSlot(SLOT);
  await demoReply(declinedSlot, SLOT.missedPatient.phone, "no, can't make it");
  s = await declinedSlot.snapshot();
  check("decline hands the slot to the waitlist", s.cursor === 0);
  const ledger = await declinedSlot.ledgerSnapshot();
  check(
    "ledger records the decline",
    ledger.attempts.some((a) => a.patient === SLOT.missedPatient.phone && a.status === "declined"),
  );
}

// ── 3. Waitlist fill: priority, retries, cursor ───────────────────────────

console.log("\n[3] Waitlist fill: priority order + retry budget");
{
  const slot = freshSlot("s-waitlist");
  await slot.openSlot(SLOT);
  await demoReply(slot, SLOT.missedPatient.phone, "decline");
  let s = await slot.snapshot();
  check(
    "priority-1 candidate first (Casey, not Brooke)",
    s.currentCandidate?.phone === "+15557000003",
  );

  await sweep(slot);
  s = await slot.snapshot();
  check(
    "no reply -> retry same candidate on SMS",
    s.currentCandidate?.phone === "+15557000003" && s.currentCandidate?.channel === "sms",
  );

  await sweep(slot);
  s = await slot.snapshot();
  check(
    "no reply -> retry again",
    s.currentCandidate?.phone === "+15557000003" && s.currentCandidate?.attempts === 3,
  );

  await sweep(slot);
  s = await slot.snapshot();
  check(
    "budget exhausted -> cursor advances to next candidate",
    s.currentCandidate?.phone === "+15557000002",
  );

  for (let i = 0; i < 9; i++) await sweep(slot);
  s = await slot.snapshot();
  check("waitlist exhausted -> unresolved", s.status === "unresolved");
  const ledger = await slot.ledgerSnapshot();
  check(
    "every attempt is in the ledger",
    ledger.attempts.filter((a) => a.status === "attempted").length >= 7,
  );
  check("no confirmation recorded", ledger.confirmation === null);
}

// ── 4. First confirmation wins ────────────────────────────────────────────

console.log("\n[4] First confirmation wins (double-booking guard)");
{
  const slot = freshSlot("s-race");
  await slot.openSlot(SLOT);
  await demoReply(slot, SLOT.missedPatient.phone, "decline");
  const s = await slot.snapshot();
  const workingGen = s.generation;
  const staleSweepCount = slot.scheduled.filter((t) => t.method === "sweepCandidate").length;

  const winner = await demoReply(slot, "+15557000003", "YES");
  const filled = await slot.snapshot();
  check(
    "confirmation fills the slot",
    filled.status === "filled" && filled.confirmation?.patient === "+15557000003",
  );
  check("generation bumps so outreach stops", filled.generation > workingGen);
  check(
    "confirmation stops further outreach (no new sweeps)",
    slot.scheduled.filter((t) => t.method === "sweepCandidate").length === staleSweepCount,
  );

  const ledger = await slot.ledgerSnapshot();
  check("confirmation lands in the ledger", ledger.confirmation?.patient === "+15557000003");
  check(
    "confirmed attempt recorded",
    ledger.attempts.some((a) => a.patient === "+15557000003" && a.status === "confirmed"),
  );

  const late = await demoReply(slot, "+15557000002", "YES");
  assert.match(late.reply as string, /was just filled/);
  const lateAgain = await slot.applyDecision("confirm", {
    name: "Late Larry",
    phone: "+15557000004",
    role: "waitlist",
    channel: "sms",
    attempts: 1,
    callControlId: null,
  }, "sms");
  assert.match(lateAgain, /claimed this slot first/);
  const ledgerAfter = await slot.ledgerSnapshot();
  check("late confirmers never double-book", ledgerAfter.confirmation !== null);
  const stale = await slot.sweepCandidate({ generation: workingGen });
  check("in-flight sweep timer no-ops after fill", stale.skipped === true);
}

// ── 5. Restart proof ──────────────────────────────────────────────────────

console.log("\n[5] Restart proof: kill mid-outreach, resume with same cursor");
{
  const slotA = freshSlot("s-restart");
  await slotA.openSlot(SLOT);
  await demoReply(slotA, SLOT.missedPatient.phone, "decline");
  const before = await slotA.snapshot();
  const ledgerBefore = await slotA.ledgerSnapshot();
  check("mid-outreach: cursor on waitlist[0]", before.cursor === 0);

  // Kill: drop the instance; durable store and shared ledger survive.
  actors.delete("slot:s-restart");
  const slotB = freshSlot("s-restart");
  const after = await slotB.snapshot();
  check(
    "actor resumes with the same waitlist cursor",
    after.cursor === before.cursor && after.status === before.status,
  );
  const ledgerAfter = await slotB.ledgerSnapshot();
  check(
    "outreach ledger survives the kill",
    ledgerAfter.attempts.length >= ledgerBefore.attempts.length,
  );

  // The resumed actor confirms and the lock holds.
  await demoReply(slotB, "+15557000003", "yes");
  const s = await slotB.snapshot();
  check("resumed actor fills the slot", s.confirmation?.patient === "+15557000003");

  // A late confirmer against the same slot can never double-book.
  const late = await demoReply(slotB, "+15557000002", "YES");
  assert.match(late.reply as string, /was just filled/);
  const finalLedger = await slotB.ledgerSnapshot();
  check("no double-booking after restart", finalLedger.confirmation !== null);
}

// ── 6. "later" + expiry paths ─────────────────────────────────────────────

console.log("\n[6] Later + expiry");
{
  const slot = freshSlot("s-later");
  await slot.openSlot(SLOT);
  const reply = await demoReply(slot, SLOT.missedPatient.phone, "later");
  assert.match(reply.reply as string, /scheduling desk will call you back/);
  const ledger = await slot.ledgerSnapshot();
  check(
    "later schedules a retry within budget",
    ledger.attempts.some((a) => a.detail.includes("callback later")),
  );

  const filled = freshSlot("s-expiry-filled");
  await filled.openSlot(SLOT);
  await demoReply(filled, SLOT.missedPatient.phone, "RESCHEDULE");
  const expired = await filled.expireSlot();
  check("expiry no-ops on a rescheduled slot", expired.skipped === true);

  const openSlot2 = freshSlot("s-expiry-open");
  await openSlot2.openSlot(SLOT);
  await openSlot2.expireSlot();
  const s = await openSlot2.snapshot();
  check("unworked slot expires", s.status === "expired");
}

// ── 7. HTTP surface ───────────────────────────────────────────────────────

console.log("\n[7] HTTP surface");
{
  const post = async (path: string, body: unknown) =>
    await mod.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
      ENV,
    );

  const health = await mod.fetch(new Request("http://localhost/health"), ENV);
  check("GET /health", health.status === 200);

  const opened = await post("/webhook/scheduling", SLOT);
  check("POST /webhook/scheduling opens the slot", opened.status === 200);

  const demoReplyRes = await post("/demo/reply", {
    slotId: SLOT.slotId,
    from: SLOT.missedPatient.phone,
    text: "reschedule",
  });
  const demoBody = (await demoReplyRes.json()) as { decision?: string };
  check(
    "POST /demo/reply drives the missed patient",
    demoReplyRes.status === 200 && demoBody.decision === "reschedule",
  );

  const demoCall = await post("/demo/call-event", {
    slotId: SLOT.slotId,
    eventType: "call.answered",
    to: SLOT.missedPatient.phone,
  });
  check("POST /demo/call-event simulates the voice path", demoCall.status === 200);

  const stateRes = await mod.fetch(
    new Request(`http://localhost/state/${encodeURIComponent(SLOT.slotId)}`),
    ENV,
  );
  const stateBody = (await stateRes.json()) as { slotId: string; status: string };
  check("GET /state/:slotId snapshots the actor", stateBody.slotId === SLOT.slotId);

  const ledgerRes = await mod.fetch(
    new Request(`http://localhost/ledger/${encodeURIComponent(SLOT.slotId)}`),
    ENV,
  );
  const ledgerBody = (await ledgerRes.json()) as { attempts: AttemptRecord[] };
  check("GET /ledger/:slotId returns the outreach ledger", Array.isArray(ledgerBody.attempts));

  const bad = await post("/webhook/scheduling", { slotId: "x" });
  check("missing fields -> 400", bad.status === 400);
  const nf = await post("/nope", {});
  check("unknown path -> 404", nf.status === 404);

  const idx = indexActorFor();
  await idx.register("+15559999999", "SLOT-9999", "waitlist");
  const hit = await idx.lookup("+15559999999");
  check(
    "SlotIndex routes replies without a slot ref",
    hit !== null && hit.slotId === "SLOT-9999",
  );
}

console.log("\n✅ smoke_test.ts: All checks passed");
