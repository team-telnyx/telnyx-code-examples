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
  const orchProto = OrchestratorAgent.prototype as Record<string, unknown>;
  assert(typeof orchProto.startJob === "function", "OrchestratorAgent.startJob() exists");
  assert(typeof orchProto.reportComplete === "function", "OrchestratorAgent.reportComplete() exists");
  assert(typeof orchProto.reportFailure === "function", "OrchestratorAgent.reportFailure() exists");
  assert(typeof orchProto.checkChildren === "function", "OrchestratorAgent.checkChildren() exists");
  assert(typeof orchProto.finalize === "function", "OrchestratorAgent.finalize() exists");
  assert(typeof orchProto.fetch === "function", "OrchestratorAgent.fetch() exists");

  // 3. Transcriber methods
  const childProto = TranscriberAgent.prototype as Record<string, unknown>;
  assert(typeof childProto.assign === "function", "TranscriberAgent.assign() exists");

  // 4. Verify Agent base-class primitives are inherited (spawn, children, destroy, schedule, queue)
  const agentBase = Object.getPrototypeOf(OrchestratorAgent.prototype) as Record<string, unknown>;
  assert(typeof agentBase.spawn === "function", "spawn() inherited from Agent");
  assert(typeof agentBase.children === "function", "children() inherited from Agent");
  assert(typeof agentBase.destroy === "function", "destroy() inherited from Agent");
  assert(typeof agentBase.schedule === "function", "schedule() inherited from Agent");
  assert(typeof agentBase.queue === "function", "queue() inherited from Agent");

  // 5. HTTP handler routes
  const resp404 = await handler.fetch(new Request("http://localhost/"), {
    SECRETS: {} as never,
    TRANSCRIBER: {} as never,
    JOB_KV: {} as never,
    TELNYX: {} as never,
    MOCK_AUDIO_URLS: "",
  } as never);
  assert(resp404.status === 404, "Unknown route returns 404");

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
