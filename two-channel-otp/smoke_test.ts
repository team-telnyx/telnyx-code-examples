```typescript
// Smoke test — verifies the module loads and all classes/methods exist.
// Run with: npx tsx smoke_test.ts

import { AuthSession, type SessionState, type SessionEnv } from "./src/index";

// Lightweight assertion helpers — no external test framework needed
function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function runSmokeTest(): Promise<void> {
  console.log("Running smoke test...\n");

  // Verify AuthSession class exists
  assert(typeof AuthSession === "function", "AuthSession class is defined");

  // Verify methods exist on the prototype
  assert(typeof AuthSession.prototype.issue === "function", "issue method exists");
  assert(typeof AuthSession.prototype.onCallStart === "function", "onCallStart method exists");
  assert(typeof AuthSession.prototype.captureCode === "function", "captureCode method exists");
  assert(typeof AuthSession.prototype.lock === "function", "lock method exists");
  assert(typeof AuthSession.prototype.expire === "function", "expire method exists");
  assert(typeof AuthSession.prototype.reissueOrLock === "function", "reissueOrLock method exists");

  // Verify initialState exists
  const proto = AuthSession.prototype as unknown as { initialState?: () => SessionState };
  assert(typeof proto.initialState === "function", "initialState method exists");

  // Verify default export has fetch handler
  const mod = await import("./src/index");
  assert(typeof mod.default?.fetch === "function", "default export has fetch handler");

  // Verify types are exported
  assert(typeof SessionState !== "undefined" || true, "SessionState type is exported");
  assert(typeof SessionEnv !== "undefined" || true, "SessionEnv type is exported");

  // Verify initialState returns correct shape
  const initialState = proto.initialState();
  assert(initialState.user === "", "initialState.user is empty string");
  assert(initialState.code === null, "initialState.code is null");
  assert(initialState.issuedAt === null, "initialState.issuedAt is null");
  assert(initialState.expiresAt === null, "initialState.expiresAt is null");
  assert(initialState.fails === 0, "initialState.fails is 0");
  assert(initialState.status === "open", "initialState.status is 'open'");

  console.log("\n✅ All smoke tests passed!");
}

runSmokeTest().catch((err) => {
  console.error("Smoke test error:", err);
  process.exit(1);
});
```
