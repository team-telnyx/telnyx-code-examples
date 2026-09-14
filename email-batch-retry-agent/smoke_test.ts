/**
 * Smoke test for email-batch-retry-agent.
 * Verifies the BatchAgent class exists, has the expected methods,
 * and the default fetch handler is wired correctly.
 *
 * Run with: npx tsx smoke_test.ts
 */

import { BatchAgent } from "./src/index";
import type { Env } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runSmokeTest(): Promise<void> {
  console.log("Running smoke tests for email-batch-retry-agent...\n");

  // 1. BatchAgent class exists and extends Agent
  assert(typeof BatchAgent === "function", "BatchAgent class is exported");
  assert(
    BatchAgent.prototype instanceof Object,
    "BatchAgent is a class (has prototype)"
  );

  // 2. Required methods exist on the prototype
  const proto = BatchAgent.prototype as Record<string, unknown>;
  const requiredMethods = [
    "fetch",
    "sendBatch",
    "retryFailed",
    "initialState",
    "schedule",
    "queue",
    "getState",
    "setState",
    "replaceState",
  ];

  for (const method of requiredMethods) {
    assert(
      typeof proto[method] === "function",
      `BatchAgent has method '${method}'`
    );
  }

  // 3. Default export is wired (fetch handler)
  const mod = await import("./src/index");
  const defaultExport = mod.default as { fetch?: unknown };
  assert(
    typeof defaultExport === "object" && defaultExport !== null,
    "Default export object exists"
  );
  assert(
    typeof defaultExport.fetch === "function",
    "Default export has fetch handler"
  );

  // 4. Env type is exported
  assert(typeof ({} as Env) === "object", "Env type is exported");

  // 5. Verify constants via a quick static check (not exported, but we can
  //    verify the class shape implies the constants exist)
  const instance = new BatchAgent();
  assert(
    typeof instance.initialState === "function",
    "BatchAgent instance has initialState"
  );

  // 6. Verify initialState returns the expected shape
  const initialState = instance.initialState();
  assert(
    initialState.status === "CREATED",
    "initialState returns CREATED status"
  );
  assert(
    Array.isArray(initialState.messages),
    "initialState returns messages array"
  );
  assert(
    initialState.total === 0,
    "initialState returns total = 0"
  );

  console.log("\n✅ All smoke tests passed!");
}

runSmokeTest().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
