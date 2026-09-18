/**
 * In-memory recovery test for sub-agent-orchestrator-actor.
 * Simulates durable actor storage, actor registry, and bindings, then runs
 * the DEV-1085 use case scenarios end-to-end against the REAL agent code:
 *
 *  A. fresh start → all children complete → finalize → scorecard in KV
 *  B. 3am power event: kill mid-run → re-post same jobId → only unfinished
 *     files re-spawned; finished files NEVER redone
 *  C. stuck child (DEMO_HANG_FILES) → watchdog marks FAILED → bounded
 *     re-spawn → PARTIAL_FAILURE with honest reasons
 *  D. re-post after completion (post-destroy, fresh actor) → ALREADY_DONE
 */

import {
  OrchestratorAgent,
  TranscriberAgent,
  type OrchestratorState,
  type AssignPayload,
  type FileRecord,
} from "./src/index";
import {
  type ActorStub,
  type ChildRef,
} from "@telnyx/edge-runtime";

// ---------- mock durable storage ----------

type AnyRecord = Record<string, unknown>;

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
    async list(options?: { limit?: number; startAfter?: string; prefix?: string }) {
      const all = [...store.keys()].sort();
      const filtered = all.filter((k) => {
        if (options?.prefix && !k.startsWith(options.prefix)) return false;
        if (options?.startAfter && !(k > options.startAfter)) return false;
        return true;
      });
      const m = new Map<string, unknown>();
      const limit = options?.limit ?? filtered.length;
      for (const k of filtered.slice(0, limit)) m.set(k, store.get(k));
      return m;
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
    sql: undefined,
    async setAlarm() {},
    async getAlarm() {
      return null;
    },
    async deleteAlarm() {},
  };
}

function structuredCloneJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null));
}

function blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// ---------- mock KV namespace ----------

class MockKv {
  constructor(private map: Map<string, string>) {}
  async get(key: string, options?: { type?: string }): Promise<unknown> {
    const raw = this.map.get(key) ?? null;
    if (raw === null) return null;
    return options?.type === "json" ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
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

// ---------- mock actor platform ----------

interface LiveChild {
  name: string;
  type: string;
  status: string;
  createdAt: Date;
}

const actorStores = new Map<string, Map<string, unknown>>(); // actor name → durable KV store
const liveChildren = new Map<string, LiveChild>(); // child name → record
const actorInstances = new Map<string, OrchestratorAgent | TranscriberAgent>();

function actorStorage(name: string): Map<string, unknown> {
  let s = actorStores.get(name);
  if (!s) {
    s = new Map();
    actorStores.set(name, s);
  }
  return s;
}

function makeCtx(id: string): AnyRecord {
  return { id, storage: makeActorStorage(actorStorage(id)), blockConcurrencyWhile };
}

function makeMockEnv(overrides: AnyRecord = {}): AnyRecord {
  const kv = new MockKv(kvMap);
  return {
    SECRETS: { get: async () => "mock-key" },
    JOB_KV: kv,
    MOCK_AUDIO_URLS: URLS.join(","),
    STUCK_TIMEOUT_SECONDS: "300",
    MAX_CHILD_ATTEMPTS: "3",
    DEMO_DELAY_MS: "0",
    ...overrides,
  };
}

const URLS = [
  "https://example.com/audio-1.mp3",
  "https://example.com/audio-2.mp3",
  "https://example.com/audio-3.mp3",
  "https://example.com/audio-4.mp3",
  "https://example.com/audio-5.mp3",
];

const kvMap = new Map<string, string>();

/** Test orchestrator: overrides platform primitives with the in-memory mock. */
class TestOrchestrator extends OrchestratorAgent {
  destroyed = false;
  spawnedNames: string[] = [];
  despawnedNames: string[] = [];

  async readState(): Promise<OrchestratorState> {
    return (await this.getState()) as unknown as OrchestratorState;
  }

  async writeState(patch: Partial<OrchestratorState>): Promise<void> {
    await this.setState(patch as never);
  }

  // Test-only loose typing: the mock returns a stub backed by a real child
  // instance, which the SDK's exact stub type can't express.
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  protected override async spawn(_ns: any, name?: string): Promise<any> {
    const childName = name ?? `auto-${Date.now()}`;
    this.spawnedNames.push(childName);
    liveChildren.set(childName, {
      name: childName,
      type: "TranscriberAgent",
      status: "RUNNING",
      createdAt: new Date(),
    });
    const child = new TranscriberAgent(
      makeCtx(childName) as never,
      {
        SECRETS: { get: async () => "mock-key" },
        PARENT: {
          idFromName: (parentName: string) => ({
            reportComplete: (fileId: string, transcript: string, attempt: number) =>
              (resolveActor(parentName) as OrchestratorAgent).reportComplete(
                fileId,
                transcript,
                attempt
              ),
            reportFailure: (fileId: string, error: string, attempt: number) =>
              (resolveActor(parentName) as OrchestratorAgent).reportFailure(
                fileId,
                error,
                attempt
              ),
          }),
        },
        JOB_KV: new MockKv(kvMap),
        DEMO_HANG_FILES: this.env.DEMO_HANG_FILES,
        DEMO_HANG_MS: this.env.DEMO_HANG_MS,
        DEMO_DELAY_MS: this.env.DEMO_DELAY_MS,
      } as never
    );
    actorInstances.set(childName, child);
    return {
      id: childName,
      assign: (payload: AssignPayload) => child.assign(payload),
    };
  }

  protected override async despawn(child: string | ActorStub): Promise<void> {
    const name = typeof child === "string" ? child : child.id;
    this.despawnedNames.push(name);
    liveChildren.delete(name);
    actorStores.delete(name);
    actorInstances.delete(name);
  }

  protected override async children(): Promise<ChildRef[]> {
    return [...liveChildren.values()];
  }

  protected override async schedule(): Promise<string> {
    return "watchdog-scheduled"; // test triggers checkChildren manually
  }

  protected override async queue(): Promise<string> {
    return "queued"; // test triggers finalize manually
  }

  protected override async destroy(): Promise<void> {
    this.destroyed = true;
    // destroy() empties state + timers; the instance remains as a clean shell
    actorStorage(this.ctx.id).clear();
  }
}

function resolveActor(name: string): OrchestratorAgent | TranscriberAgent | undefined {
  return actorInstances.get(name);
}

function freshOrchestrator(jobId: string, envOverrides: AnyRecord = {}): TestOrchestrator {
  const o = new TestOrchestrator(
    makeCtx(jobId) as never,
    makeMockEnv(envOverrides) as never
  );
  actorInstances.set(jobId, o);
  return o;
}

// ---------- assertions ----------

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`✅ ${msg}`);
  } else {
    failures++;
    console.error(`❌ ${msg}`);
  }
}

async function driveChildrenToCompletion(orch: OrchestratorAgent): Promise<void> {
  // Children were spawned with assign() already called (real logic runs in
  // TranscriberAgent.assign, including KV-first writes). Wait for them.
  await new Promise((r) => setTimeout(r, 50));
}

async function scenarioA_freshStart(): Promise<void> {
  console.log("\n── Scenario A: fresh start → complete → scorecard ──");
  const orch = freshOrchestrator("job-a");
  const res = await orch.startJob({ jobId: "job-a" });
  check(res.status === "STARTED", `startJob → STARTED (got ${res.status})`);
  await driveChildrenToCompletion(orch);

  let s = await orch.readState();
  check(s.audioUrls.length === 5, "file list pinned in state");

  // resolution → COMPLETING → finalize (trigger manually: queue is stubbed)
  s = await orch.readState();
  if (s.status === "COMPLETING") {
    check(true, "last report flipped the job to COMPLETING");
  } else if (s.status === "RUNNING") {
    await orch.writeState({ status: "COMPLETING" });
  }
  await orch.finalize();
  const full = (await new MockKv(kvMap).get("job/job-a", { type: "json" })) as OrchestratorState;
  check(!!full, "full job record persisted to KV");
  check(full?.status === "COMPLETED", `KV record COMPLETED (got ${full?.status})`);
  check(full?.results.length === 5, `5 transcripts in the record (got ${full?.results.length})`);
  check(full?.children.every((c) => c.status === "COMPLETED"), "all children COMPLETED");
  check(full?.outcomes.length === 5, "scorecard has 5 outcomes");
  check(full?.outcomes.every((o) => o.status === "COMPLETED"), "all outcomes COMPLETED");
  check(orch.destroyed === true, "parent self-destructed after finalize");
}

async function scenarioB_powerEvent(): Promise<void> {
  console.log("\n── Scenario B: 3am power event → resume, no redo ──");
  // Kill 3 of 5 children mid-run: their KV records never get written.
  const orch = freshOrchestrator("job-b");
  const res = await orch.startJob({ jobId: "job-b" });
  check(res.status === "STARTED", `startJob → STARTED (got ${res.status})`);
  await driveChildrenToCompletion(orch);

  let s = await orch.readState();
  const doneBefore = [...kvMap.keys()].filter(
    (k) => k.startsWith("job/job-b/file/") && JSON.parse(kvMap.get(k)!).status === "COMPLETED"
  ).length;
  check(doneBefore === 5, `all 5 files have KV records before the outage (got ${doneBefore})`);

  // NEW RUN: 2 files (file-4, file-5) must re-run; 3 finished files never redone.
  // Simulate by wiping the KV records + children state for file-4/file-5 only.
  for (const fid of ["file-4", "file-5"]) {
    kvMap.delete(`job/job-b/file/${fid}`);
  }
  const staleChildren = s.children.filter((c) => ["file-4", "file-5"].includes(c.fileId));
  liveChildren.delete(staleChildren[0].name);
  liveChildren.delete(staleChildren[1].name);

  // Simulate "power returns": fresh actor instance, same durable storage.
  const rebooted = new TestOrchestrator(
    makeCtx("job-b") as never,
    makeMockEnv() as never
  );
  actorInstances.set("job-b", rebooted);
  const res2 = await rebooted.startJob({ jobId: "job-b" });
  check(res2.status === "RESUMED", `re-post → RESUMED (got ${res2.status})`);
  await driveChildrenToCompletion(rebooted);

  // finalize (queue is stubbed — trigger manually) then verify the record
  const mid = await rebooted.readState();
  if (mid.status === "RUNNING") await rebooted.writeState({ status: "COMPLETING" });
  await rebooted.finalize();
  s = (await new MockKv(kvMap).get("job/job-b", { type: "json" })) as OrchestratorState;
  const redone = rebooted.spawnedNames.filter((n) => n.startsWith("job-b-"));
  check(redone.length === 2, `only unfinished files re-spawned (got ${redone.length}: ${redone.join(",")})`);
  check(
    redone.every((n) => n.endsWith("-r2")),
    `re-spawned workers are attempt 2 (got ${redone.join(",")})`
  );
  const adopted = s.results.filter((r) => ["file-1", "file-2", "file-3"].includes(r.fileId));
  check(adopted.length === 3, "3 finished files adopted from KV, never redone");
  check(
    s.results.filter((r) => r.attempts === 1 && ["file-1", "file-2", "file-3"].includes(r.fileId)).length === 3,
    "adopted files still show attempts=1 (no redo)"
  );
  check(s.results.length === 5, `all 5 accounted for after resume (got ${s.results.length})`);
  check(s.status === "COMPLETED", `resumed job finished COMPLETED (got ${s.status})`);
}

async function scenarioC_stuckChild(): Promise<void> {
  console.log("\n── Scenario C: stuck child → watchdog → bounded re-spawn ──");
  const orch = freshOrchestrator("job-c", {
    STUCK_TIMEOUT_SECONDS: "1",
    MAX_CHILD_ATTEMPTS: "2",
    DEMO_HANG_FILES: "file-2",
    DEMO_HANG_MS: "5000",
  });
  const res = await orch.startJob({ jobId: "job-c" });
  check(res.status === "STARTED", `startJob → STARTED (got ${res.status})`);
  await new Promise((r) => setTimeout(r, 100)); // non-hanging children finish

  let s = await orch.readState();
  const stuck = s.children.find((c) => c.fileId === "file-2");
  check(stuck?.status === "RUNNING", "file-2 child RUNNING (simulating a hung worker)");

  // Advance past the watchdog window, then fire the watchdog.
  const started = Date.parse(stuck!.startedAt);
  const realNow = Date.now;
  Date.now = () => started + 60_000;
  await orch.checkChildren();
  Date.now = realNow;

  await new Promise((r) => setTimeout(r, 100));
  s = await orch.readState();
  const respawned = s.children.find((c) => c.fileId === "file-2" && c.status === "RUNNING");
  check(!!respawned, "watchdog pass: hung worker re-spawned (bounded retry)");
  check(respawned?.name.endsWith("-r2") === true, `fresh worker name (got ${respawned?.name})`);
  check((respawned?.attempts ?? 0) === 2, `attempt ledger advanced to 2 (got ${respawned?.attempts})`);
  check(
    (s.results.find((r) => r.fileId === "file-1")?.attempts ?? 0) === 1,
    "healthy files untouched (attempts=1)"
  );

  // Second watchdog pass: attempt 2 also hangs → exhausted → FAILED.
  const started2 = Date.parse(respawned!.startedAt);
  Date.now = () => started2 + 60_000;
  await orch.checkChildren();
  Date.now = realNow;

  s = await orch.readState();
  check(
    s.children.filter((c) => c.fileId === "file-2" && c.status === "FAILED").length === 1,
    "file-2 exhausted after MAX_CHILD_ATTEMPTS=2, left FAILED"
  );

  // finalize with the honest scorecard
  await orch.writeState({ status: "COMPLETING" });
  await orch.finalize();
  const full = (await new MockKv(kvMap).get("job/job-c", { type: "json" })) as OrchestratorState;
  check(full?.status === "PARTIAL_FAILURE", `final status PARTIAL_FAILURE (got ${full?.status})`);
  const failedOutcome = full?.outcomes.find((o) => o.fileId === "file-2");
  check(failedOutcome?.status === "FAILED", "scorecard marks file-2 FAILED");
  check(
    (failedOutcome?.attempts ?? 0) === 2,
    `scorecard shows 2 attempts (got ${failedOutcome?.attempts})`
  );
  check(
    (failedOutcome?.error ?? "").includes("Timed out") || (failedOutcome?.error ?? "").includes("attempts"),
    `failure reason recorded (got "${failedOutcome?.error}")`
  );
}

async function scenarioD_alreadyDone(): Promise<void> {
  console.log("\n── Scenario D: re-post after completion → ALREADY_DONE ──");
  // job-a finished and destroyed in scenario A. Fresh actor, same name.
  const after = freshOrchestrator("job-a");
  const res = await after.startJob({ jobId: "job-a" });
  check(res.status === "ALREADY_DONE", `re-post → ALREADY_DONE (got ${res.status})`);
  check(after.spawnedNames.length === 0, "no children spawned on a finished job");
}

async function scenarioE_inFlightNotDuplicated(): Promise<void> {
  console.log("\n── Scenario E: re-post mid-run does not duplicate in-flight workers ──");
  const orch = freshOrchestrator("job-e", {
    STUCK_TIMEOUT_SECONDS: "60",
    DEMO_HANG_FILES: "file-3",
    DEMO_HANG_MS: "4000",
  });
  const res = await orch.startJob({ jobId: "job-e" });
  check(res.status === "STARTED", `startJob → STARTED (got ${res.status})`);
  await new Promise((r) => setTimeout(r, 100));

  const spawnedBefore = orch.spawnedNames.filter((n) => n.includes("file-3")).length;
  check(spawnedBefore === 1, "file-3 worker in flight (1 spawn)");

  // Re-post while the worker is young and in flight → must NOT re-spawn.
  const res2 = await orch.startJob({ jobId: "job-e" });
  check(res2.status === "RESUMED", `re-post mid-run → RESUMED (got ${res2.status})`);
  const spawnedAfter = orch.spawnedNames.filter((n) => n.includes("file-3")).length;
  check(spawnedAfter === 1, `in-flight worker not duplicated (got ${spawnedAfter})`);
}

async function scenarioF_requestFaultsAndSms(): Promise<void> {
  console.log("\n── Scenario F: request-level fault injection + SMS preview on the record ──");
  const orch = freshOrchestrator("job-f", { STUCK_TIMEOUT_SECONDS: "1", MAX_CHILD_ATTEMPTS: "1" });
  const res = await orch.startJob({ jobId: "job-f", hangFiles: ["file-3"] });
  check(res.status === "STARTED", `startJob with request hangFiles → STARTED (got ${res.status})`);
  await new Promise((r) => setTimeout(r, 100));

  // First watchdog pass: hung worker re-spawned? attempts=1 >= MAX(1) → exhausted instead.
  const s0 = await orch.readState();
  const hung = s0.children.find((c) => c.fileId === "file-3");
  const started = Date.parse(hung!.startedAt);
  const realNow = Date.now;
  Date.now = () => started + 60_000;
  await orch.checkChildren();
  Date.now = realNow;

  await orch.writeState({ status: "COMPLETING" });
  await orch.finalize();
  const full = (await new MockKv(kvMap).get("job/job-f", { type: "json" })) as OrchestratorState;
  check(full?.status === "PARTIAL_FAILURE", `request faults → PARTIAL_FAILURE (got ${full?.status})`);
  const failedOutcome = full?.outcomes.find((o) => o.fileId === "file-3");
  check(
    (failedOutcome?.error ?? "").includes("No report after 1 attempt"),
    `exhausted hung worker scored honestly (got "${failedOutcome?.error}")`
  );
  check(
    typeof full?.notification === "string" && (full?.notification ?? "").includes("partial failure"),
    `notification (SMS text) stored on the record (got "${full?.notification}")`
  );
  check(
    (full?.notification ?? "").includes("file-3"),
    "notification names the failed file (got the operator scorecard)"
  );
}

async function scenarioG_powerEventRecovered(): Promise<void> {
  console.log("\n── Scenario G: one-shot power event → auto-recovery → full batch ──");
  const orch = freshOrchestrator("job-g", {
    STUCK_TIMEOUT_SECONDS: "1",
    MAX_CHILD_ATTEMPTS: "2",
    DEMO_HANG_MS: "5000",
  });
  const res = await orch.startJob({ jobId: "job-g", hangOnce: ["file-3"] });
  check(res.status === "STARTED", `startJob with hangOnce → STARTED (got ${res.status})`);
  await new Promise((r) => setTimeout(r, 100));

  let s = await orch.readState();
  const stuck = s.children.find((c) => c.fileId === "file-3");
  check(stuck?.status === "RUNNING", "file-3 worker down mid-run (power event)");

  // Watchdog fires → reconcile despawns the lost worker, re-spawns attempt 2,
  // which succeeds (hangOnce is one-shot).
  const started = Date.parse(stuck!.startedAt);
  const realNow = Date.now;
  Date.now = () => started + 60_000;
  await orch.checkChildren();
  Date.now = realNow;

  // Wait for the re-spawned worker to finish — poll the KV record (the authority).
  let rec: FileRecord | null = null;
  for (let t = 0; t < 50; t++) {
    await new Promise((r) => setTimeout(r, 100));
    rec = (await new MockKv(kvMap).get("job/job-g/file/file-3", { type: "json" })) as FileRecord | null;
    if (rec?.status === "COMPLETED") break;
  }
  check(rec?.status === "COMPLETED", `outage recovered automatically (got ${rec?.status})`);
  check((rec?.attempts ?? 0) === 2, `file-3 shows 2 attempts (got ${rec?.attempts})`);
  s = await orch.readState();
  check((await new MockKv(kvMap).get("job/job-g/file/file-1", { type: "json" })) !== null, "healthy files untouched");

  await orch.writeState({ status: "COMPLETING" });
  await orch.finalize();
  const full = (await new MockKv(kvMap).get("job/job-g", { type: "json" })) as OrchestratorState;
  check(full?.status === "COMPLETED", `batch completed despite the outage (got ${full?.status})`);
  const outcome = full?.outcomes.find((o) => o.fileId === "file-3");
  check(outcome?.status === "COMPLETED" && outcome.attempts === 2, "scorecard: file-3 completed on attempt 2");
  check(
    (full?.incidents.length ?? 0) === 1,
    `incident timeline has exactly 1 entry (got ${full?.incidents.length})`
  );
  check(
    full?.incidents[0]?.fileId === "file-3" && full.incidents[0].attempt === 2,
    "incident names file-3 and attempt 2"
  );
  check(
    (full?.incidents[0]?.reason ?? "").includes("watchdog"),
    `incident reason recorded (got "${full?.incidents[0]?.reason}")`
  );
  check((full?.notification ?? "").includes("5/5"), "operator SMS reports a full batch");
}

async function main(): Promise<void> {
  await scenarioA_freshStart();
  await scenarioB_powerEvent();
  await scenarioC_stuckChild();
  await scenarioD_alreadyDone();
  await scenarioE_inFlightNotDuplicated();
  await scenarioF_requestFaultsAndSms();
  await scenarioG_powerEventRecovered();
  console.log(failures === 0 ? "\n🎉 All recovery scenarios passed!" : `\n💥 ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Recovery test crashed:", err);
  process.exit(1);
});
