/**
 * Smoke test for the Dispatch Line sample.
 * Run with: npx tsx smoke_test.ts
 *
 * Verifies the module loads, the actor exposes the shift-log surface, and the
 * job parser / confirmation line / idempotency helpers behave as the demo needs.
 */
import assert from "node:assert/strict";
import worker, {
  DispatchLine,
  confirmationLine,
  keywordsOf,
  parseJob,
  segmentSeq,
  shiftIdFor,
  toSegment,
} from "./src/index";

function test(name: string, fn: () => void): void {
  fn();
  console.log(`ok - ${name}`);
}

test("worker exposes a fetch handler", () => {
  assert.equal(typeof worker.fetch, "function");
});

test("DispatchLine exposes the shift-log surface", () => {
  for (const method of ["onCallStart", "onTranscription", "confirmOverCall", "onCallHangup", "onJobReference", "tally"]) {
    assert.equal(typeof (DispatchLine.prototype as Record<string, unknown>)[method], "function", `missing ${method}`);
  }
});

test("parseJob extracts the demo job line", () => {
  const job = parseJob("swap the actuator on north yard door 3");
  assert.ok(job, "expected a parsed job");
  assert.equal(job?.jobText, "actuator swap");
  assert.equal(job?.site, "north yard door 3");
});

test("confirmationLine reads the job back over the call", () => {
  assert.equal(
    confirmationLine({ jobText: "actuator swap", site: "north yard door 3" }),
    "North yard, door 3, actuator swap \u2014 logged.",
  );
});

test("parseJob ignores chit-chat", () => {
  assert.equal(parseJob("hey how is the coffee up there"), null);
});

test("segmentSeq is stable for redelivered webhooks", () => {
  const payload = { call_control_id: "v3:abc", transcript: "swap the actuator" };
  assert.equal(segmentSeq(payload, "evt-1"), segmentSeq(payload, "evt-1"));
  assert.equal(segmentSeq({ transcription_data: { sequence: 7 } }, "evt-1"), 7);
});

test("shiftIdFor derives the day's actor name", () => {
  assert.equal(shiftIdFor("2026-11-19T07:00:00Z"), "shift-2026-11-19");
});

test("keywordsOf drops stopwords for cross-call linking", () => {
  assert.deepEqual(keywordsOf("that actuator from this morning"), ["actuator"]);
});

test("toSegment normalizes the call.transcription payload", () => {
  const segment = toSegment(
    { call_control_id: "v3:abc", transcription_data: { transcript: "swap the actuator on north yard door 3", is_final: true } },
    "evt-1",
    "shift-2026-11-19",
  );
  assert.equal(segment.callId, "v3:abc");
  assert.equal(segment.shiftId, "shift-2026-11-19");
  assert.equal(segment.isFinal, true);
  assert.ok(segment.transcript.includes("actuator"));
});

console.log("\nAll dispatch-line smoke checks passed.");
