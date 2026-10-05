// Smoke test for stepup-verify-gate
// Verifies that the module loads and all required classes/methods exist.
// Run with: npx tsx smoke_test.ts

import { VerifyGate, rpcSurface, ChallengeResult, VerifyResult } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function runSmokeTest(): void {
  console.log("Running smoke test for stepup-verify-gate...\n");

  // Verify module loads
  assert(VerifyGate !== undefined, "VerifyGate class exported");
  assert(typeof VerifyGate === "function", "VerifyGate is a function/class");

  // Verify methods exist on prototype
  const requiredMethods = ["challenge", "verifyCode", "handleWebhook", "unlockExpired", "initialState"];
  for (const method of requiredMethods) {
    assert(
      typeof (VerifyGate.prototype as any)[method] === "function",
      `${method} method exists on VerifyGate prototype`
    );
  }

  // Verify rpcSurface
  assert(rpcSurface !== undefined, "rpcSurface exported");
  assert(typeof rpcSurface.challenge === "function", "rpcSurface.challenge exists");
  assert(typeof rpcSurface.verifyCode === "function", "rpcSurface.verifyCode exists");

  // Verify initial state shape
  const gate = Object.create(VerifyGate.prototype);
  const state = gate.initialState();
  assert(state.carrierBaseline === null, "initialState.carrierBaseline is null");
  assert(Array.isArray(state.stepups) && state.stepups.length === 0, "initialState.stepups is empty array");
  assert(state.locked === false, "initialState.locked is false");
  assert(state.lockedUntil === null, "initialState.lockedUntil is null");

  console.log("\nAll smoke tests passed!");
}

runSmokeTest();
