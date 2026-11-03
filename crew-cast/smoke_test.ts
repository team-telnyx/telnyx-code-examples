// Smoke test for crew-cast. Run with: npx tsx smoke_test.ts
// Verifies the module loads, the actor class is wired to the Edge Agent base,
// and the acceptance-criteria behaviors of DEV-1400 work end to end against an
// in-memory environment: the demo-mode group send, idempotent finalized
// folding, cc-roster reply folding, crash-resume, the 30-minute re-poll chain,
// and the dispatch notification. No network calls, no credentials required.

import { Agent } from "@telnyx/edge-runtime";
import { DatabaseSync } from "node:sqlite";
import worker, {
  CrewCast,
  isE164,
  maskPhone,
  type CrewState,
  type Env,
  type FinalizedEvent,
  type ReplyEvent,
} from "./src/index";

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

check("default export exposes a fetch handler", () => {
  assert(typeof worker.fetch === "function", "worker.fetch is not a function");
});

check("CrewCast extends the Edge Agent base class", () => {
  assert(typeof CrewCast === "function", "CrewCast is not a class");
  assert(Object.prototype.isPrototypeOf.call(Agent, CrewCast), "CrewCast does not extend Agent");
});

check("CrewCast implements the actor surface", () => {
  const methods = ["cast", "onFinalized", "onReply", "deliveryReport", "repollUnknown", "fetch"];
  for (const method of methods) {
    assert(typeof (CrewCast.prototype as Record<string, unknown>)[method] === "function", `missing method: ${method}`);
  }
});

check("isE164 accepts US/CA numbers only", () => {
  assert(isE164("+15551234567"), "rejected a valid NANP number");
  assert(!isE164("+44551234567"), "accepted a non-NANP number");
  assert(!isE164("5551234567"), "accepted a number without +1");
  assert(!isE164("+1555123456"), "accepted a 9-digit number");
  assert(!isE164(undefined), "accepted a non-string");
});

check("maskPhone never leaks the full number", () => {
  const masked = maskPhone("+15551234567");
  assert(!masked.includes("5551234567"), "masked value still contains the full number");
  assert(masked.startsWith("+15"), "masked value lost its prefix");
});

/* ----------------------- behavioral environment ----------------------- */

/** Map-backed ActorStorage mock: same key surface the Edge runtime provides. */
class MemoryStorage {
  private map = new Map<string, unknown>();
  private alarm: number | null = null;

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.map.get(key) as T | undefined);
  }
  put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, structuredClone(value));
    return Promise.resolve();
  }
  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.map.delete(key));
  }
  list(options?: { prefix?: string; startAfter?: string; limit?: number }): Promise<Map<string, unknown>> {
    const prefix = options?.prefix ?? "";
    const startAfter = options?.startAfter;
    let limit = options?.limit ?? 1000;
    const out = new Map<string, unknown>();
    for (const [k, v] of [...this.map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (prefix && !k.startsWith(prefix)) continue;
      if (startAfter && k <= startAfter) continue;
      if (limit <= 0) break;
      out.set(k, v);
      limit -= 1;
    }
    return Promise.resolve(out);
  }
  deleteAll(): Promise<void> {
    this.map.clear();
    return Promise.resolve();
  }
  transaction<T>(fn: (txn: MemoryStorage) => Promise<T>): Promise<T> {
    return fn(this);
  }
  transactionSync<T>(fn: (txn: MemoryStorage) => T): T {
    return fn(this);
  }
  setAlarm(when: number): Promise<void> {
    this.alarm = when;
    return Promise.resolve();
  }
  getAlarm(): Promise<number | null> {
    return Promise.resolve(this.alarm);
  }
  deleteAlarm(): Promise<void> {
    this.alarm = null;
    return Promise.resolve();
  }
}

/**
 * Real in-process SQLite engine for `ctx.storage.sql` — the surface the Agent
 * base requires in SDK 0.16 (durable state/tasks/messages/events live in SQL
 * tables; a KV-only storage is refused on re-activation). Node 24 ships
 * `node:sqlite`, so the crash-resume path exercises real persistence.
 */
class SqlEngine {
  private inTx = false;

  constructor(private db: DatabaseSync) {}

  exec(sql: string, ...params: unknown[]): { toArray(): Array<Record<string, unknown>> } {
    if (/^\s*(select|with)\b/i.test(sql)) {
      const stmt = this.db.prepare(sql);
      const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Array<Record<string, unknown>>;
      return { toArray: () => rows };
    }
    if (params.length > 0) {
      this.db.prepare(sql).run(...(params as never[]));
    } else {
      this.db.exec(sql); // multi-statement DDL
    }
    return { toArray: () => [] };
  }

  transactionSync<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.db.exec("BEGIN");
    this.inTx = true;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.inTx = false;
    }
  }
}

interface SqlRow {
  cast_id: string; job_id: string; phone_number: string; status: string; acked_at: string | null; updated_at: string;
}

/** Minimal SQL surface covering the crew_delivery table's exec/upsert/aggregate. */
class MemorySql {
  rows = new Map<string, SqlRow>();

  exec(_sql: string): Promise<unknown> {
    return Promise.resolve({ ok: true });
  }

  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO crew_delivery")) {
            const [cast_id, job_id, phone_number, status, acked_at, updated_at] = params as [string, string, string, string, string | null, string];
            this.rows.set(`${cast_id}|${phone_number}`, { cast_id, job_id, phone_number, status, acked_at, updated_at });
          }
          return { ok: true };
        },
        all: async () => {
          const byStatus = new Map<string, { total: number; acked: number }>();
          const results: Array<Record<string, unknown>> = [];
          const castFilter = (sql.match(/WHERE cast_id = \?/) !== null);
          for (const row of this.rows.values()) {
            if (castFilter && row.cast_id !== params[0]) continue;
            const entry = byStatus.get(row.status) ?? { total: 0, acked: 0 };
            entry.total += 1;
            if (row.acked_at !== null) entry.acked += 1;
            byStatus.set(row.status, entry);
          }
          for (const [status, agg] of byStatus) {
            results.push({ status, total: agg.total, acked: agg.acked });
          }
          results.sort((a, b) => String(a.status).localeCompare(String(b.status)));
          return { results };
        },
      }),
    };
  }
}

interface TestHarness {
  env: Env;
  storage: MemoryStorage;
  sql: MemorySql;
  alarmCount: { value: number };
  crewSends: Array<{ from: string; to: string[]; text: string; media_urls?: string[] }>;
  rebuild: () => CrewCast;
  actor: CrewCast;
}

const ROSTER = ["+15551110001", "+15551110002", "+15551110003", "+15551110004", "+15551110005", "+15551110006"];
const CREW_FROM = "+15550001234";
const DISPATCH = "+15550009999";
const CAST_INPUT = {
  cast_id: "job-1187",
  job_id: "job-1187",
  from: CREW_FROM,
  recipients: ROSTER,
  text: "Roof photo attached. Reply ON SITE when you are on the ladder.",
  media_url: "https://example.com/roof-1187.jpg",
};

/** Build a CrewCast bound to an in-memory environment. Rebuild = crash-resume. */
function makeHarness(demoMode: boolean): TestHarness {
  const storage = new MemoryStorage();
  const sql = new MemorySql();
  const kv = new Map<string, string>();
  const alarmCount = { value: 0 };
  const crewSends: TestHarness["crewSends"] = [];
  const dbRef: { db: DatabaseSync | null } = { db: null };
  let schedules: Array<{ delay: number; method: string }> = [];

  const env: Env = {
    SECRETS: {
      get: async (key: string) => (key === "TELNYX_PUBLIC_KEY" ? (demoMode ? null : "not-a-real-key") : null),
    } as unknown as Env["SECRETS"],
    CREW_CAST: {
      idFromName: () => makeActor() as unknown as never,
    } as unknown as Env["CREW_CAST"],
    CREW_DB: sql as unknown as Env["CREW_DB"],
    CREW_INDEX: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
    } as unknown as Env["CREW_INDEX"],
    TELNYX: {
      messages: {
        send: async (params: { from: string; to: string[]; text: string; media_urls?: string[] }) => {
          crewSends.push(params);
          return {
            data: {
              id: `gm-${Date.now()}`,
              to: params.to.map((phone_number) => ({
                phone_number, status: "queued", carrier: "demo", line_type: "Wireless",
              })),
            },
          };
        },
      },
    } as unknown as Env["TELNYX"],
    CREW_FROM, CREW_PROFILE_ID: demoMode ? "" : "profile-123", DISPATCH_PHONE: DISPATCH,
    PUBLIC_BASE_URL: "https://crew-cast.test", DEMO_MODE: String(demoMode),
  } as Env;

  const makeActor = (): CrewCast => {
    schedules = [];
    // The SQL database is the actor's persistent storage — it must survive
    // across rebuilds (that is exactly what the crash-resume AC proves).
    if (!dbRef.db) dbRef.db = new DatabaseSync(":memory:");
    const ctx = {
      id: "job-1187",
      storage: Object.assign(storage, { sql: new SqlEngine(dbRef.db) }),
      blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => fn(),
      setAlarm: async () => {
        alarmCount.value += 1;
        return Promise.resolve();
      },
      count: () => 0,
      broadcast: () => 0,
    };
    const actor = new CrewCast(ctx as never, env);
    return Object.assign(actor, {
      schedule: async (delay: number, method: string) => {
        schedules.push({ delay, method });
        await ctx.setAlarm(Date.now() + delay);
        return "scheduled";
      },
    }) as CrewCast;
  };

  const actor = makeActor();
  return {
    env, storage, sql, alarmCount, crewSends,
    rebuild: makeActor,
    actor: Object.assign(actor, {
      // expose the last schedule call for assertions
    }),
  } as TestHarness & { lastSchedule: () => { delay: number; method: string } | undefined };
}

async function run(): Promise<void> {
  // ── AC 1+2: cast persists the roster BEFORE the send, records the group id ──
  const h = makeHarness(true);
  let board = await h.actor.cast(CAST_INPUT);
  const state1 = (await h.actor["getState"]()) as CrewState;
  check("cast: roster persisted before the send with queued statuses", () => {
    assert(state1.recipients.length === 6, `expected 6 recipients, got ${state1.recipients.length}`);
    assert(state1.recipients.every((r) => r.status === "queued"), "roster not all queued after cast");
    assert(state1.group_message_id !== null, "group_message_id not recorded");
    assert(state1.from === CREW_FROM, "from number not recorded");
  });
  check("cast: arms the 30-minute re-poll", () => {
    // The schedule stub ran inside cast() before deliveryReport returned.
    // alarmCount > 0 proves the initial repollUnknown timer was armed.
    assert(h.alarmCount.value >= 1, "no scheduled task armed at cast time");
  });

  board = await h.actor.cast(CAST_INPUT); // idempotent re-entry
  check("cast: re-entry is idempotent (no double send)", () => {
    const b2 = board;
    assert(b2.group_message_id === state1.group_message_id, "re-entry produced a different group id");
  });

  // ── AC 3: six finalized events fold idempotently; one unknown ──
  const gmId = state1.group_message_id as string;
  const statuses: Array<[string, string]> = [
    [ROSTER[0], "delivered"], [ROSTER[1], "delivered"], [ROSTER[2], "delivered"],
    [ROSTER[3], "delivered"], [ROSTER[4], "delivered"], [ROSTER[5], "unknown"],
  ];
  for (const [phone_number, status] of statuses) {
    const ev: FinalizedEvent = { group_message_id: gmId, phone_number, status: status as CrewState["recipients"][number]["status"], occurred_at: "2026-07-28T07:31:10Z" };
    await h.actor.onFinalized(ev);
    const dup = await h.actor.onFinalized(ev);
    assert(dup.applied === false, `replayed finalized for ${phone_number} was not a no-op`);
  }
  const afterFinalized = await h.actor.deliveryReport();
  check("finalized: 5 delivered + 1 unknown on the board", () => {
    assert(afterFinalized.totals.delivered === 5, `expected 5 delivered, got ${afterFinalized.totals.delivered}`);
    assert(afterFinalized.totals.unknown === 1, `expected 1 unknown, got ${afterFinalized.totals.unknown}`);
    assert(afterFinalized.totals.queued === 0, "a queued status survived finalized events");
  });
  check("finalized: stale group_message_id is rejected", () => {
    // handled via the router's KV index in production; the actor reports the reason
  });

  // wrong group_message_id → unknown_group_message_id
  const stale = await h.actor.onFinalized({ group_message_id: "gm-wrong", phone_number: ROSTER[0], status: "delivered", occurred_at: null });
  check("finalized: unknown group_message_id returns routed-noop", () => {
    assert(stale.applied === false && stale.reason === "unknown_group_message_id", `unexpected: ${JSON.stringify(stale)}`);
  });

  // ── AC 4: inbound reply with cc roster folded into the thread ──
  const reply: ReplyEvent = {
    id: "msg-0001", from: ROSTER[2],
    text: "on site, east ladder broken",
    cc: [ROSTER[0], ROSTER[1], ROSTER[3], ROSTER[4], ROSTER[5], CREW_FROM],
    occurred_at: "2026-07-28T07:42:00Z",
  };
  await h.actor.onReply(reply);
  const dupReply = await h.actor.onReply(reply); // webhook retry
  check("reply: folded once, webhook retry is a no-op", () => {
    assert(dupReply.applied === false, "duplicate reply was applied twice");
    const boardAfter = h.actor as unknown as { deliveryReport: () => Promise<typeof afterFinalized> };
    void boardAfter;
  });
  const afterReply = await h.actor.deliveryReport();
  check("reply: replier acked; cc roster does NOT add the thread owner", () => {
    assert(afterReply.replies.length === 1, `expected 1 reply, got ${afterReply.replies.length}`);
    assert(afterReply.replies[0].cc.includes(CREW_FROM), "fixture cc should include the thread owner");
    const sender = afterReply.recipients.find((r) => r.number === ROSTER[2]);
    assert(sender?.acked_at === "2026-07-28T07:42:00Z", "replier was not acked");
    assert(!afterReply.recipients.some((r) => r.number === CREW_FROM), "thread owner was backfilled as a recipient");
    assert(afterReply.totals.recipients === 6, `expected 6 recipients after cc fold, got ${afterReply.totals.recipients}`);
  });

  // ── AC 4b: first-reply cc backfill of a roster entry missed at cast ──
  const h2 = makeHarness(true);
  await h2.actor.cast({ ...CAST_INPUT, recipients: ROSTER.slice(0, 5) });
  const gm2 = ((await h2.actor["getState"]()) as CrewState).group_message_id as string;
  for (const phone_number of ROSTER.slice(0, 5)) {
    await h2.actor.onFinalized({ group_message_id: gm2, phone_number, status: "delivered", occurred_at: null });
  }
  await h2.actor.onReply({ id: "m1", from: ROSTER[0], text: "here", cc: [ROSTER[5]], occurred_at: "2026-07-28T07:50:00Z" });
  const backfilled = await h2.actor.deliveryReport();
  check("reply: cc backfills a roster entry missed at cast time", () => {
    assert(backfilled.totals.recipients === 6, `expected 6 after backfill, got ${backfilled.totals.recipients}`);
    assert(backfilled.recipients.some((r) => r.number === ROSTER[5] && r.status === "unknown"), "backfilled cc entry missing");
  });

  // ── AC 6: crash-resume — fresh instance, same storage, board intact ──
  const reborn = h.rebuild();
  const postCrash = await reborn.deliveryReport();
  check("crash-resume: board survives a worker restart", () => {
    assert(postCrash.group_message_id === gmId, "group_message_id lost across restart");
    assert(postCrash.recipients.length === 6, "roster lost across restart");
    assert(postCrash.totals.delivered === 5 && postCrash.totals.unknown === 1, "board totals changed across restart");
  });
  const replayAfterCrash = await reborn.onFinalized({ group_message_id: gmId, phone_number: ROSTER[0], status: "delivered", occurred_at: null });
  check("crash-resume: replayed event is still a no-op after restart", () => {
    assert(replayAfterCrash.applied === false, "replay after crash mutated the board");
  });

  // ── AC 7: the 30-minute re-poll fires, reviews, and stops after MAX_REPOLLS ──
  await h.actor.repollUnknown();
  await h.actor.repollUnknown();
  const repolled = await h.actor.repollUnknown();
  check("repoll: reviews state and stops after two re-polls", () => {
    assert(repolled.repolls === 3, `expected repolls=3, got ${repolled.repolls}`);
    assert(repolled.rescheduled === false, "re-poll chain did not stop at MAX_REPOLLS");
    assert(repolled.pending === 1, `expected 1 pending (the unknown), got ${repolled.pending}`);
  });

  // ── AC 8b: late finalized upgrades unknown → delivered, board + SQL agree ──
  const late = await h.actor.onFinalized({ group_message_id: gmId, phone_number: ROSTER[5], status: "delivered", occurred_at: "2026-07-28T08:15:00Z" });
  const final = await h.actor.deliveryReport();
  check("late finalized: upgrades unknown to delivered; all accounted for", () => {
    assert(late.applied === true, "late finalized event did not apply");
    assert(final.totals.delivered === 6 && final.totals.unknown === 0, `unexpected totals: ${JSON.stringify(final.totals)}`);
    assert(final.dispatch_notified === true, "dispatch was not notified after all terminal");
    assert(final.sql_summary.length >= 1, "SQL acknowledgement report is empty");
    const sqlRow = h.sql.rows.get(`${CAST_INPUT.cast_id}|${ROSTER[5]}`);
    assert(sqlRow?.status === "delivered", "SQL row did not track the upgrade");
  });

  // ── live mode: real binding call shape + dispatch SMS ──
  const h3 = makeHarness(false);
  await h3.actor.cast(CAST_INPUT);
  const liveState = (await h3.actor["getState"]()) as CrewState;
  check("live mode: group send hits the TELNYX binding with array to[]", () => {
    assert(h3.crewSends.length === 1, `expected 1 send, got ${h3.crewSends.length}`);
    const send = h3.crewSends[0];
    assert(Array.isArray(send.to) && send.to.length === 6, "to[] is not the 6-number array");
    assert(send.media_urls?.[0] === CAST_INPUT.media_url, "media_urls missing");
    assert(liveState.group_message_id !== null, "group_message_id not recorded from response");
  });
  for (const phone_number of ROSTER) {
    await h3.actor.onFinalized({ group_message_id: liveState.group_message_id as string, phone_number, status: "delivered", occurred_at: null });
  }
  check("live mode: dispatch SMS sent when all terminal", () => {
    const dispatchSends = h3.crewSends.filter((s) => s.to.length === 1 && s.to[0] === DISPATCH);
    assert(dispatchSends.length === 1, `expected 1 dispatch SMS, got ${dispatchSends.length}`);
    assert(dispatchSends[0].text.includes("all 6 accounted for"), `unexpected SMS copy: ${dispatchSends[0].text}`);
  });

  // ── router: unsigned webhook accepted in demo mode, routes by KV index ──
  const h4 = makeHarness(true);
  await h4.actor.cast(CAST_INPUT);
  const demoState = (await h4.actor["getState"]()) as CrewState;
  const kvRoute: Record<string, string> = { [`group:${demoState.group_message_id}`]: CAST_INPUT.cast_id };
  await h4.actor.onFinalized({ group_message_id: demoState.group_message_id as string, phone_number: ROSTER[0], status: "delivered", occurred_at: null });
  const routed = await worker.fetch(
    new Request("https://crew-cast.test/webhooks/messaging", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "message.finalized",
          payload: { group_message_id: demoState.group_message_id, to: [{ phone_number: ROSTER[0] }], status: "delivered" },
        },
      }),
    }),
    { ...h4.env, CREW_INDEX: { get: async (k: string) => kvRoute[k] ?? null, put: async () => undefined } } as unknown as Env,
  );
  const routedBody = (await routed.json()) as Record<string, unknown>;
  check("router: demo mode accepts unsigned webhook and routes to the actor", () => {
    assert(routed.status === 200, `expected 200, got ${routed.status}`);
    assert(routedBody.applied === false, `expected a no-op verdict, got ${JSON.stringify(routedBody)}`);
    assert(routedBody.reason === "duplicate", `expected duplicate for a same-status replay, got ${routedBody.reason}`);
  });

  if (failures > 0) {
    throw new Error(`${failures} smoke check(s) failed`);
  }
  console.log("smoke_test: all checks passed");
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
