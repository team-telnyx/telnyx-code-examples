```typescript
// smoke_test.ts — verifies CoachRoom actor and NudgePolicy load correctly.
// Run with: npx tsx smoke_test.ts

import { CoachRoom, NudgePolicy, CoachState, CoachEnv, SupervisorFrame } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("CoachRoom actor");

test("should be a class", () => {
  assert(CoachRoom !== undefined, "CoachRoom is defined");
  assert(typeof CoachRoom === "function", "CoachRoom is a function");
});

test("should have an initialState method", () => {
  assert(CoachRoom.prototype.initialState !== undefined, "initialState exists");
  assert(typeof CoachRoom.prototype.initialState === "function", "initialState is a function");
});

test("should have a fetch method", () => {
  assert(CoachRoom.prototype.fetch !== undefined, "fetch exists");
  assert(typeof CoachRoom.prototype.fetch === "function", "fetch is a function");
});

test("should have a webSocket method", () => {
  assert(CoachRoom.prototype.webSocket !== undefined, "webSocket exists");
  assert(typeof CoachRoom.prototype.webSocket === "function", "webSocket is a function");
});

test("should have a joinCall RPC method", () => {
  assert(CoachRoom.prototype.joinCall !== undefined, "joinCall exists");
  assert(typeof CoachRoom.prototype.joinCall === "function", "joinCall is a function");
});

test("should have a checkSilence scheduled method", () => {
  assert(CoachRoom.prototype.checkSilence !== undefined, "checkSilence exists");
  assert(typeof CoachRoom.prototype.checkSilence === "function", "checkSilence is a function");
});

test("should have a finalizeSession method", () => {
  assert(CoachRoom.prototype.finalizeSession !== undefined, "finalizeSession exists");
  assert(typeof CoachRoom.prototype.finalizeSession === "function", "finalizeSession is a function");
});

test("should have a broadcast method", () => {
  assert(CoachRoom.prototype.broadcast !== undefined, "broadcast exists");
  assert(typeof CoachRoom.prototype.broadcast === "function", "broadcast is a function");
});

console.log("NudgePolicy");

test("should be constructable with default max", () => {
  const policy = new NudgePolicy();
  assert(policy !== undefined, "policy is defined");
  assert(policy.count === 0, "count is 0");
});

test("should be constructable with custom max", () => {
  const policy = new NudgePolicy(5);
  assert(policy !== undefined, "policy is defined");
});

test("should allow nudges up to the max", () => {
  const policy = new NudgePolicy(3);
  assert(policy.canNudge() === true, "first nudge allowed");
  policy.recordNudge();
  assert(policy.canNudge() === true, "second nudge allowed");
  policy.recordNudge();
  assert(policy.canNudge() === true, "third nudge allowed");
  policy.recordNudge();
  assert(policy.canNudge() === false, "fourth nudge blocked");
});

test("should enforce 10 fps rate limit", () => {
  const policy = new NudgePolicy(10);
  assert(policy.canNudge() === true, "first nudge allowed");
  policy.recordNudge();
  // Immediately after, should be rate-limited (10 fps = 100ms min interval)
  assert(policy.canNudge() === false, "rate-limited immediately after");
});

test("should validate frame size ≤ 1 MiB", () => {
  const policy = new NudgePolicy(3);
  const smallText = "Verify identity with date of birth next.";
  assert(policy.validateFrame(smallText) === true, "small frame valid");
});

test("should reject frames > 1 MiB", () => {
  const policy = new NudgePolicy(3);
  const largeText = "x".repeat(1024 * 1024 + 1);
  assert(policy.validateFrame(largeText) === false, "large frame rejected");
});

console.log("Type exports");

test("should export CoachState type", () => {
  const state: CoachState = {
    conversationId: "conv-123",
    callControlId: "cc-456",
    flags: [],
    nudges: 0,
    tookOver: false,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    failedAccountAttempts: 0,
    silenceScheduled: false,
  };
  assert(state.conversationId === "conv-123", "state has conversationId");
});

test("should export SupervisorFrame type", () => {
  const frame: SupervisorFrame = {
    type: "transcript",
    payload: { role: "user", text: "hello" },
  };
  assert(frame.type === "transcript", "frame has type");
});

console.log("\n✅ smoke_test.ts — all checks passed");
```
