/**
 * Smoke test for sub-agent-orchestrator-actor.
 * Verifies the actor classes and methods exist and are wired correctly.
 * Run with: npx tsx smoke_test.ts
 */

import {
  OrchestratorAgent,
  TranscriberAgent,
  default as handler,
} from "./src/index";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function runSmokeTest(): Promise<void> {
  console.log("Running smoke tests for sub-agent-orchestrator-actor...\n");

  // 1. Classes exist
  assert(typeof OrchestratorAgent === "function", "OrchestratorAgent class exported");
  assert(typeof TranscriberAgent === "function", "TranscriberAgent class exported");
  assert(typeof handler === "object" && handler !== null, "default fetch handler exported");

  // 2. Orchestrator methods exist (spec primitives)
  const orchProto = OrchestratorAgent.prototype as unknown as Record<string, unknown>;
  assert(typeof orchProto.startJob === "function", "OrchestratorAgent.startJob() exists");
  assert(typeof orchProto.reportComplete === "function", "OrchestratorAgent.reportComplete() exists");
  assert(typeof orchProto.reportFailure === "function", "OrchestratorAgent.reportFailure() exists");
  assert(typeof orchProto.checkChildren === "function", "OrchestratorAgent.checkChildren() exists");
  assert(typeof orchProto.reconcile === "function", "OrchestratorAgent.reconcile() exists");
  assert(typeof orchProto.finalize === "function", "OrchestratorAgent.finalize() exists");
  assert(typeof orchProto.fetch === "function", "OrchestratorAgent.fetch() exists");

  // 3. Transcriber methods
  const childProto = TranscriberAgent.prototype as unknown as Record<string, unknown>;
  assert(typeof childProto.assign === "function", "TranscriberAgent.assign() exists");

  // 4. Verify Agent base-class primitives are inherited (spawn, children, destroy, schedule, queue)
  const agentBase = Object.getPrototypeOf(OrchestratorAgent.prototype) as Record<string, unknown>;
  assert(typeof agentBase.spawn === "function", "spawn() inherited from Agent");
  assert(typeof agentBase.children === "function", "children() inherited from Agent");
  assert(typeof agentBase.despawn === "function", "despawn() inherited from Agent");
  assert(typeof agentBase.destroy === "function", "destroy() inherited from Agent");
  assert(typeof agentBase.schedule === "function", "schedule() inherited from Agent");
  assert(typeof agentBase.queue === "function", "queue() inherited from Agent");

  // 4b. Resumability state shape — attempts + outcome fields present
  try {
    const orch = new OrchestratorAgent({} as never, {} as never) as unknown as {
      initialState: () => Record<string, unknown>;
    };
    const fresh = orch.initialState();
    assert(
      Array.isArray(fresh.audioUrls) && Array.isArray(fresh.outcomes),
      "state carries audioUrls + outcomes for resume/scorecard"
    );
  } catch {
    console.log("⚠️  SKIP: OrchestratorAgent constructor requires a live ActorContext");
  }

  // 5. HTTP handler routes
  const resp404 = await handler.fetch(new Request("http://localhost/nowhere"), {
    SECRETS: {} as never,
    TRANSCRIBER: {} as never,
    JOB_KV: {} as never,
    MOCK_AUDIO_URLS: "",
    STUCK_TIMEOUT_SECONDS: "300",
    MAX_CHILD_ATTEMPTS: "3",
  } as never);
  assert(resp404.status === 404, "Unknown route returns 404");

  const respHome = await handler.fetch(new Request("http://localhost/"), {
    SECRETS: {} as never,
    TRANSCRIBER: {} as never,
    JOB_KV: {} as never,
    MOCK_AUDIO_URLS: "https://example.com/a.mp3",
    STUCK_TIMEOUT_SECONDS: "300",
    MAX_CHILD_ATTEMPTS: "3",
  } as never);
  assert(respHome.status === 200, "GET / serves the clinic front door");
  assert(
    (respHome.headers.get("content-type") ?? "").includes("text/html"),
    "GET / returns HTML"
  );

  const respConsole = await handler.fetch(new Request("http://localhost/console"), {
    SECRETS: {} as never,
    TRANSCRIBER: {} as never,
    JOB_KV: {} as never,
    MOCK_AUDIO_URLS: "https://example.com/a.mp3",
    STUCK_TIMEOUT_SECONDS: "300",
    MAX_CHILD_ATTEMPTS: "3",
  } as never);
  assert(respConsole.status === 200, "GET /console serves the engineering console");
  assert(
    (respConsole.headers.get("content-type") ?? "").includes("text/html"),
    "GET /console returns HTML"
  );

  const respConfig = await handler.fetch(new Request("http://localhost/config"), {
    SECRETS: {} as never,
    TRANSCRIBER: {} as never,
    JOB_KV: {} as never,
    MOCK_AUDIO_URLS: "https://example.com/a.mp3,https://example.com/b.mp3",
    TRANSCRIPTION_MODEL: "distil-whisper/distil-large-v2",
    STUCK_TIMEOUT_SECONDS: "300",
    MAX_CHILD_ATTEMPTS: "3",
  } as never);
  const cfg = (await respConfig.json()) as { audioUrls?: string[]; demoMode?: boolean };
  assert(respConfig.status === 200, "GET /config returns 200");
  assert(Array.isArray(cfg.audioUrls) && cfg.audioUrls.length === 2, "config exposes audio URLs");
  assert(typeof cfg.demoMode === "boolean", "config exposes demo mode");

  const respBadJob = await handler.fetch(
    new Request("http://localhost/jobs", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    {} as never
  );
  assert(respBadJob.status === 400, "POST /jobs without jobId returns 400");

  console.log("\n🎉 All smoke tests passed!");
}

runSmokeTest().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
