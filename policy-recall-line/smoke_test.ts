/**
 * Smoke test for policy-recall-line.
 * Verifies the actor class, its methods, and the fetch handler exist.
 * Run with: npx tsx smoke_test.ts
 */

import { PolicyLine, rpc } from "./src/index";

async function runSmokeTest(): Promise<void> {
  console.log("Running smoke test for policy-recall-line...");

  // Verify the actor class exists and extends Agent
  if (typeof PolicyLine !== "function") {
    throw new Error("PolicyLine class not exported");
  }
  console.log("✅ PolicyLine class exists");

  // Verify the rpc decorator is exported
  if (typeof rpc !== "function") {
    throw new Error("rpc decorator not exported");
  }
  console.log("✅ rpc decorator exported");

  // Verify the actor has the expected public methods
  const proto = PolicyLine.prototype as any;
  const expectedMethods = [
    "fetch",
    "audit",
    "reindexNow",
    "poll:Timer",
    "retry:Timer",
    "reindex:Timer",
  ];
  for (const method of expectedMethods) {
    if (typeof proto[method] !== "function") {
      throw new Error(`Missing method: ${method}`);
    }
  }
  console.log("✅ All expected actor methods present");

  // Verify the default export (fetch handler) exists
  const mod = await import("./src/index");
  if (typeof mod.default !== "function") {
    throw new Error("Default fetch handler export missing");
  }
  console.log("✅ Default fetch handler exported");

  // Verify constants are sane
  const state = new PolicyLine({} as any, {} as any);
  if (typeof state.initialState !== "function") {
    throw new Error("initialState method missing");
  }
  const initial = state.initialState();
  if (!initial.sources || typeof initial.sources !== "object") {
    throw new Error("initialState must return { sources: {} }");
  }
  console.log("✅ initialState returns correct shape");

  console.log("\nAll smoke tests passed! 🎉");
}

runSmokeTest().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
