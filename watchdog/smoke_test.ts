// Smoke test for watchdog. Run with: npx tsx smoke_test.ts
// Verifies the module loads, the actor class is wired to the Edge Agent base,
// and the acceptance-criteria behaviors of DEV-1402 run end to end against an
// in-memory environment: the demo-mode run loop (baseline → stale_ref recovery
// → broken verdict → incident → fix-close), crash-resume with no duplicate
// incident, owner authorization, webhook signature refusal in live mode, and
// the fixture/demo-fixture invariants the README documents. No network, no
// credentials required.

import { Agent } from "@telnyx/edge-runtime";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, {
  Watchdog,
  isDemo,
  maskPhone,
  normalizePhone,
  parseCommand,
  verifyWebhookSignature,
  watchId,
  type Env,
  type WatchdogState,
} from "./src/index";
import { FIXTURE_HTML } from "./src/fixture-html";

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/* ----------------------------- static checks ----------------------------- */

await check("default export exposes a fetch handler", () => {
  assert(typeof worker.fetch === "function", "worker.fetch is not a function");
});

await check("Watchdog extends the Edge Agent base class", () => {
  assert(typeof Watchdog === "function", "Watchdog is not a class");
  assert(Object.prototype.isPrototypeOf.call(Agent, Watchdog), "Watchdog does not extend Agent");
});

await check("Watchdog implements the actor surface", () => {
  const methods = ["arm", "runCheck", "statusReport", "ensureSchema", "smsReply", "fetch"];
  for (const method of methods) {
    assert(typeof (Watchdog.prototype as unknown as Record<string, unknown>)[method] === "function", `missing method: ${method}`);
  }
});

await check("watchId derives the host", () => {
  assert(watchId("https://demo-shop.example.com/pricing") === "demo-shop.example.com", "wrong watch id");
});

const DEMO_ENV_SECRETS = { get: async () => null } as unknown as Env["SECRETS"];

await check("isDemo defaults to true and honors DEMO_MODE=false", async () => {
  assert((await isDemo({ SECRETS: DEMO_ENV_SECRETS } as Env)) === true, "default is not demo");
  assert((await isDemo({ SECRETS: DEMO_ENV_SECRETS, DEMO_MODE: "true" } as Env)) === true, "true is not demo");
  assert((await isDemo({ SECRETS: DEMO_ENV_SECRETS, DEMO_MODE: "false" } as Env)) === false, "false is not live");
  assert((await isDemo({ SECRETS: DEMO_ENV_SECRETS, DEMO_MODE: "nope" } as Env)) === true, "garbage value should stay in demo");
});

await check("maskPhone never leaks the full number", () => {
  const masked = maskPhone("+15551234567");
  assert(!masked.includes("5551234567"), "masked value still contains the full number");
  assert(masked.startsWith("+15"), "masked value lost its prefix");
});

await check("normalizePhone is digits-only", () => {
  assert(normalizePhone("+1 (555) 123-4567") === "15551234567", "unexpected normalization");
});

await check("parseCommand recognizes every documented command", () => {
  assert(parseCommand("watch https://shop.example.com/pricing").kind === "watch", "watch not parsed");
  assert(parseCommand("status").kind === "status", "status not parsed");
  assert(parseCommand("status https://shop.example.com/pricing").url === "https://shop.example.com/pricing", "status url lost");
  assert(parseCommand("recheck now").kind === "recheck-now", "recheck now not parsed");
  assert(parseCommand("recheck now https://shop.example.com/pricing?price=0.00").url === "https://shop.example.com/pricing?price=0.00", "recheck url lost");
  assert(parseCommand("recheck 2026-11-04#2026-11-04T03:00:00.000Z").kind === "recheck-incident", "incident recheck not parsed");
  assert(parseCommand("hello").kind === "help", "unknown command should fall back to help");
});

await check("bundled fixture matches the embedded HTML served at /fixture", () => {
  const onDisk = readFileSync(new URL("./fixture/index.html", import.meta.url), "utf8");
  assert(onDisk === FIXTURE_HTML, "fixture/index.html and src/fixture-html.ts have drifted apart");
  assert(onDisk.includes('id="price"'), "fixture is missing the price module");
  assert(onDisk.includes('id="contact-form"'), "fixture is missing the contact form");
  assert(onDisk.includes("render_wave"), "fixture is missing the render-wave knob");
  assert(onDisk.includes('params.get("price")'), "fixture is missing the price override");
});

await check("recorded fixtures cover the full demo loop", () => {
  const recorded = JSON.parse(readFileSync(new URL("./demo/browser-fixtures.json", import.meta.url), "utf8")) as {
    envelopes: Record<string, { status: number; body: Record<string, unknown> }>;
    observations: Record<string, { observation_id: string; tree: string; refs: Record<string, unknown>; picked_refs?: Record<string, string> }>;
  };
  for (const envelope of ["session_created", "session_ready", "session_closed", "fill_ok", "stale_fill", "click_ok", "screenshot_running", "screenshot_done", "artifact"]) {
    assert(envelope in recorded.envelopes, `recorded envelope missing: ${envelope}`);
  }
  for (const obs of ["pricing_healthy", "pricing_rerendered", "pricing_broken", "post_submit"]) {
    assert(obs in recorded.observations, `recorded observation missing: ${obs}`);
    assert(recorded.observations[obs].tree.includes("$24.00") || obs === "pricing_broken", `recorded observation ${obs} lost the price`);
    assert(Object.keys(recorded.observations[obs].refs).length > 0, `recorded observation ${obs} has no refs`);
  }
  assert(recorded.observations.pricing_broken.tree.includes("$0.00"), "broken fixture does not show $0.00");
  assert(recorded.observations.pricing_healthy.picked_refs, "healthy fixture does not record the picked refs");
  const rerendered = recorded.observations.pricing_rerendered.picked_refs;
  const healthy = recorded.observations.pricing_healthy.picked_refs;
  assert(rerendered && healthy && rerendered.price !== healthy.price, "the re-render must invalidate the price ref for stale_ref to be meaningful");
});

/* ----------------------- behavioral environment ----------------------- */

class MemoryStorage {
  private map = new Map<string, unknown>();
  alarm: number | null = null;

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
  transaction<T>(fn: (txn: MemoryStorage) => Promise<T>): Promise<T> {
    return fn(this);
  }
  transactionSync<T>(fn: (txn: MemoryStorage) => T): T {
    return fn(this);
  }
  deleteAll(): Promise<void> {
    this.map.clear();
    this.alarm = null;
    return Promise.resolve();
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

/** Real in-process SQLite for the actor's durable state and the WATCHDOG_DB ledger. */
class SqlEngine {
  private inTx = false;

  constructor(private db: DatabaseSync) {}

  exec(sql: string, ...params: unknown[]): { toArray(): Array<Record<string, unknown>> } {
    if (/^\s*(select|with)\b/i.test(sql)) {
      const stmt = this.db.prepare(sql);
      const rows = (params.length > 0 ? stmt.all(...(params as never[])) : stmt.all()) as Array<Record<string, unknown>>;
      return { toArray: () => rows };
    }
    if (params.length > 0) {
      this.db.prepare(sql).run(...(params as never[]));
    } else {
      this.db.exec(sql); // multi-statement DDL
    }
    return { toArray: () => [] };
  }

  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => {
        const stmt = this.db.prepare(sql);
        const isSelect = /^\s*(select|with)\b/i.test(sql);
        const args = params as never[];
        return {
          run: async () => {
            if (isSelect) {
              const rows = (args.length ? stmt.all(...args) : stmt.all()) as Array<Record<string, unknown>>;
              return { results: rows, success: true, meta: { changes: 0, duration: 0 } };
            }
            const info = (args.length ? stmt.run(...args) : stmt.run()) as unknown as { changes: number };
            return { results: [], success: true, meta: { changes: info?.changes ?? 0, duration: 0 } };
          },
          all: async <T = Record<string, unknown>>() => {
            const rows = (args.length ? stmt.all(...args) : stmt.all()) as T[];
            return { results: rows, success: true, meta: { changes: 0, duration: 0 } };
          },
          first: async (column?: string) => {
            const row = (args.length ? stmt.get(...args) : stmt.get()) as Record<string, unknown> | undefined;
            if (row === undefined) return null;
            return column ? (row[column] ?? null) : row;
          },
        };
      },
    };
  }

  batch(statements: { sql: string }[]): Promise<unknown[]> {
    return Promise.all(statements.map((s) => this.exec(s.sql).toArray()));
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.transactionSync(fn);
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

interface Harness {
  env: Env;
  storage: MemoryStorage;
  db: DatabaseSync;
  alarms: number;
  sms: Array<{ to: string; text: string }>;
  rebuild: () => Watchdog;
  kv: Map<string, string>;
  actor: Watchdog;
}

const restoreLogFns: Array<() => void> = [];
const TODAY = new Date().toISOString().slice(0, 10);

const OWNER = "+15550001111";
const TARGET = "https://demo-shop.example.com/pricing";
const BROKEN_TARGET = "https://demo-shop.example.com/pricing?price=0.00";

/** Build a Watchdog bound to an in-memory environment. Rebuild = crash-resume. */
function makeHarness(demoMode: boolean): Harness {
  const storage = new MemoryStorage();
  const db = new DatabaseSync(":memory:");
  const kv = new Map<string, string>();
  const sms: Harness["sms"] = [];
  let alarms = 0;

  // The demo path prints SMS instead of sending it; capture the actor log.
  const rawLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.join(" ");
    const match = /^\[demo\] SMS to (\S+): (.*)$/.exec(line);
    if (match) sms.push({ to: match[1], text: match[2] });
    else rawLog(...args);
  };
  restoreLogFns.push(() => { console.log = rawLog; });

  const sql = new SqlEngine(db);

  const env: Env = {
    SECRETS: {
      get: async (key: string) =>
        key === "TELNYX_PUBLIC_KEY" ? (demoMode ? null : "not-a-real-key") : key === "TELNYX_API_KEY" && !demoMode ? "test-key" : null,
    } as unknown as Env["SECRETS"],
    WATCHDOG: {
      idFromName: () => makeActor() as unknown as never,
    } as unknown as Env["WATCHDOG"],
    WATCHDOG_DB: sql as unknown as Env["WATCHDOG_DB"],
    WATCHDOG_INDEX: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    } as unknown as Env["WATCHDOG_INDEX"],
    TELNYX: {
      messages: {
        send: async (params: { to: string; text: string }) => {
          sms.push(params);
          return {};
        },
      },
      ai: {
        openai: {
          chat: {
            createCompletion: async () => ({ choices: [{ message: { content: "{}" } }] }),
          },
        },
      },
    } as unknown as Env["TELNYX"],
    WATCH_TARGET_URL: TARGET,
    WATCH_OWNER_PHONE: OWNER,
    FROM_NUMBER: "+15550009999",
    DEMO_MODE: String(demoMode),
  } as Env;

  const ctx = () => ({
    id: "demo-shop.example.com",
    storage: Object.assign(storage, { sql }),
    blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => fn(),
    setAlarm: async () => {
      alarms += 1;
      return Promise.resolve();
    },
    count: () => 0,
    broadcast: () => 0,
  });

  const makeActor = (): Watchdog => {
    const actor = new Watchdog(ctx() as never, env);
    const runner = actor as unknown as { schedule: (delay: number, method: string, payload?: unknown) => Promise<string> };
    runner.schedule = async (delay: number, method: string, payload?: unknown) => {
      await ctx().setAlarm();
      void delay; void method; void payload;
      return "scheduled";
    };
    return actor as Watchdog;
  };

  const actor = makeActor();
  return { env, storage, db, alarms, sms, kv, rebuild: makeActor, actor };
}

interface RunRow {
  run_key: string; run_date: string; verdict: string | null; reason: string | null;
  price_text: string | null; screenshot_artifact_id: string | null; screenshot_url: string | null;
  stale_recovered: number;
}
interface IncidentRow {
  id: string; run_date: string; reason: string;
  before_artifact_id: string | null; after_artifact_id: string | null; status: string;
}

function query(db: DatabaseSync, sql: string, ...params: (string | number)[]): Record<string, unknown>[] {
  return (params.length ? db.prepare(sql).all(...(params as never[])) : db.prepare(sql).all()) as Record<string, unknown>[];
}

async function runOnce(h: Harness, payload: Record<string, unknown> = {}): Promise<void> {
  await (h.actor as unknown as { runCheck: (p: unknown) => Promise<void> }).runCheck({ reason: "manual", ...payload });
}

async function dispatchCmd(h: Harness, from: string, text: string): Promise<Response> {
  return worker.fetch(new Request("https://watchdog.example.com/webhooks/messaging", {
    method: "POST",
    body: JSON.stringify({ data: { event_type: "message.received", payload: { from: { phone_number: from }, text } } }),
  }), h.env);
}

/* -------------------------------- behavior -------------------------------- */

async function run(): Promise<void> {
  // ── AC: worker routes ──
  const h = makeHarness(true);
  const health = await worker.fetch(new Request("https://watchdog.example.com/health"), h.env);
  const healthBody = (await health.json()) as { ok?: boolean; demo_mode?: boolean };
  await check("GET /health returns ok + demo flag", () => {
    assert(health.status === 200, `status ${health.status}`);
    assert(healthBody.ok === true, "health body not ok");
    assert(healthBody.demo_mode === true, "demo_mode not reported");
  });

  await check("POST /watch validates https and returns 202", async () => {
    const missing = await worker.fetch(new Request("https://watchdog.example.com/watch", { method: "POST", body: JSON.stringify({}) }), h.env);
    assert(missing.status === 400, `missing url should 400, got ${missing.status}`);
    const insecure = await worker.fetch(new Request("https://watchdog.example.com/watch", {
      method: "POST", body: JSON.stringify({ url: "http://demo-shop.example.com/" }),
    }), h.env);
    assert(insecure.status === 400, `http target should 400, got ${insecure.status}`);
    const ok = await worker.fetch(new Request("https://watchdog.example.com/watch", {
      method: "POST", body: JSON.stringify({ url: TARGET, owner: OWNER }),
    }), h.env);
    assert(ok.status === 202, `valid watch should 202, got ${ok.status}`);
    const body = (await ok.json()) as { watch_id?: string; schedule_id?: string };
    assert(body.watch_id === "demo-shop.example.com", `wrong watch_id ${body.watch_id}`);
    assert(body.schedule_id, "schedule id missing");
  });

  // ── AC: SMS intake — watch command arms the schedule and seeds the KV index ──
  const armed = await dispatchCmd(h, OWNER, `watch ${TARGET}`);
  await check("unsigned webhook accepted in demo mode; watch command arms the actor", async () => {
    assert(armed.status === 200, `status ${armed.status}`);
    assert((h.kv.get("watch:demo-shop.example.com") ?? "") === normalizePhone(OWNER), "KV watch index not seeded");
    assert(h.sms.some((s) => s.text.startsWith("Watching")), "no arm ack SMS to the owner");
  });

  // ── AC: non-owner senders cannot command or read status ──
  const stranger = "+15557777777";
  await check("non-owner is refused for watch/status/recheck", async () => {
    const strangerWatch = await dispatchCmd(h, stranger, `watch ${TARGET}`);
    assert(strangerWatch.status === 403, `watch from stranger should 403, got ${strangerWatch.status}`);
    const strangerStatus = await dispatchCmd(h, stranger, "status");
    assert(strangerStatus.status === 403, `status from stranger should 403, got ${strangerStatus.status}`);
    const strangerRecheck = await dispatchCmd(h, stranger, "recheck now");
    assert(strangerRecheck.status === 403, `recheck from stranger should 403, got ${strangerRecheck.status}`);
  });

  // ── AC: status answers from actor SQL ──
  const status = await dispatchCmd(h, OWNER, "status");
  const statusBody = (await status.json()) as { status?: string };
  await check("status replies from actor SQL", () => {
    assert(status.status === 200, `status ${status.status}`);
    assert((statusBody.status ?? "").includes("Watch: https://demo-shop.example.com/pricing"), `unexpected status: ${statusBody.status}`);
    assert((statusBody.status ?? "").includes("Baseline: not captured"), "baseline state missing before first run");
  });

  // ── AC: first scheduled run captures the baseline; stale_ref recovered in-run ──
  await runOnce(h, { run_key: "2026-11-04#first", reason: "first" });
  const firstRows = query(h.db, "SELECT * FROM runs WHERE run_key = '2026-11-04#first'") as unknown as RunRow[];
  await check("first run records a healthy verdict and captures the baseline", async () => {
    assert(firstRows.length === 1, `expected 1 run row, got ${firstRows.length}`);
    const row = firstRows[0];
    assert(row.verdict === "healthy", `verdict ${row.verdict}`);
    assert(row.screenshot_artifact_id === "art_rec_0007", `artifact id ${row.screenshot_artifact_id}`);
    assert((row.screenshot_url ?? "").startsWith("https://api.telnyx.com/"), `artifact url ${row.screenshot_url}`);
    assert(row.stale_recovered === 1, "the recorded stale_ref recovery was not replayed");
  });
  await check("baseline survives in durable state after the first run", async () => {
    const state = (await (h.actor as unknown as { getState: () => Promise<WatchdogState> }).getState()) as WatchdogState;
    assert(state.baseline && state.baseline.price_text === "$24.00", `baseline price ${state.baseline?.price_text}`);
    assert(state.baseline?.form_labels.includes("Name"), "form labels not captured");
    assert(h.kv.get("owner:15550001111") === JSON.stringify(["demo-shop.example.com"]), "owner index lost the watch");
  });

  // ── AC: broken verdict files an incident + alert SMS ──
  const smsBefore = h.sms.length;
  await runOnce(h, { run_key: `${TODAY}#broken-manual`, reason: "manual", target_url: BROKEN_TARGET });
  const brokenIncidents = query(h.db, "SELECT * FROM incidents WHERE id NOT LIKE '%#stale'") as unknown as IncidentRow[];
  await check("broken verdict files a dated incident and alerts the owner", () => {
    assert(brokenIncidents.length === 1, `expected 1 incident, got ${brokenIncidents.length}`);
    const inc = brokenIncidents[0];
    assert(inc.run_date === TODAY, `run date ${inc.run_date}`);
    assert(inc.status === "open", `status ${inc.status}`);
    assert(inc.before_artifact_id === "art_rec_0007", `before artifact ${inc.before_artifact_id}`);
    assert((inc.reason ?? "").includes("$24.00"), `reason ${inc.reason}`);
    assert(h.sms.length > smsBefore, "no alert SMS");
    assert(h.sms.some((s) => s.text.startsWith("BROKEN")), "alert SMS missing BROKEN prefix");
  });

  // ── AC: no double-filed incident on a same-day replay ──
  await runOnce(h, { run_key: `${TODAY}#broken-replay`, reason: "scheduled", target_url: BROKEN_TARGET });
  await check("a replayed broken run never double-files the incident", async () => {
    const again = query(h.db, "SELECT * FROM incidents WHERE id NOT LIKE '%#stale'") as unknown as IncidentRow[];
    assert(again.length === 1, `expected still 1 incident, got ${again.length}`);
    assert(h.sms.some((s) => s.text.includes("BROKEN (again)")), "the re-alert should reference the existing incident");
  });

  // ── AC: fix-verification closes the incident with before/after artifacts ──
  const incidentId = brokenIncidents[0].id;
  await dispatchCmd(h, OWNER, `recheck ${incidentId}`);
  const closed = query(h.db, "SELECT * FROM incidents WHERE id = ?", incidentId) as unknown as IncidentRow[];
  await check("recheck <incident_id> closes the named incident with before/after artifacts", () => {
    assert(closed.length === 1, "incident not found");
    assert(closed[0].status === "closed", `status ${closed[0].status}`);
    assert(closed[0].before_artifact_id === "art_rec_0007", `before ${closed[0].before_artifact_id}`);
    assert(closed[0].after_artifact_id === "art_rec_0007", `after ${closed[0].after_artifact_id}`);
    assert(h.sms.some((s) => s.text.startsWith("FIXED")), "no FIXED SMS");
  });

  // ── AC: crash-resume — rebuild the actor, replay the same run, no duplicates ──
  const rebuilt = h.rebuild();
  const smsBeforeRebuild = h.sms.length;
  await (rebuilt as unknown as { runCheck: (p: unknown) => Promise<void> }).runCheck({ reason: "first", run_key: "2026-11-04#first" });
  const afterCrash = query(h.db, "SELECT * FROM runs WHERE run_key = '2026-11-04#first'") as unknown as RunRow[];
  await check("crash-resume: schedule re-arms, run is not duplicated, baseline intact", async () => {
    assert(h.storage.alarm !== null, "schedule was not re-armed on re-activation");
    assert(afterCrash.length === 1, `expected 1 run row, got ${afterCrash.length}`);
    assert(afterCrash[0].verdict === "healthy", "replayed run mutated the recorded verdict");
    assert(h.sms.length === smsBeforeRebuild, "replayed run re-sent SMS");
    const state = (await (rebuilt as unknown as { getState: () => Promise<WatchdogState> }).getState()) as WatchdogState;
    assert(state.baseline && state.baseline.price_text === "$24.00", "baseline lost across restart");
    const incidents = query(h.db, "SELECT * FROM incidents WHERE id NOT LIKE '%#stale'") as unknown as IncidentRow[];
    assert(incidents.length === 1, "crash-resume double-filed an incident");
  });

  // ── AC: SMS commands are owner-authorized end to end ──
  await check("recheck from a stranger is refused even with a live watch", async () => {
    const strangerAgain = await dispatchCmd(h, stranger, "recheck now");
    assert(strangerAgain.status === 403, `status ${strangerAgain.status}`);
  });

  // ── AC: live mode refuses unsigned webhooks ──
  const live = makeHarness(false);
  const unsigned = await worker.fetch(new Request("https://watchdog.example.com/webhooks/messaging", {
    method: "POST",
    body: JSON.stringify({ data: { event_type: "message.received", payload: { from: { phone_number: OWNER }, text: "status" } } }),
  }), live.env);
  await check("live mode refuses webhooks without a signature", () => {
    assert(unsigned.status === 401, `expected 401 for an unsigned webhook when TELNYX_PUBLIC_KEY is set, got ${unsigned.status}`);
  });

  await check("verifyWebhookSignature rejects garbage", async () => {
    assert(!(await verifyWebhookSignature(new Request("https://x/y"), "body", "not-a-key")), "accepted an invalid key");
  });

  // ── The single stale_ref is recovered, so no stale incident note is filed ──
  await check("stale-persist path files an incident note only on double staleness", async () => {
    const before = query(h.db, "SELECT * FROM incidents WHERE id LIKE '%#stale'").length;
    await runOnce(h, { run_key: `${TODAY}#stale-run`, target_url: BROKEN_TARGET });
    const after = query(h.db, "SELECT * FROM incidents WHERE id LIKE '%#stale'").length;
    assert(after === before, `expected no new stale note (single stale is recovered), got ${after - before}`);
  });
}

await run();
for (const restore of restoreLogFns) restore();

if (failures > 0) {
  console.error(`smoke_test: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("smoke_test: all checks passed");
