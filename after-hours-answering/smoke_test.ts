import { AfterHoursLine, type LineState, type Env, type AfterHoursRecord, type AfterHoursInstruction } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

assert(typeof AfterHoursLine === "function", "AfterHoursLine should be a class");
assert(typeof AfterHoursLine.prototype.onCall === "function", "onCall should exist");
assert(typeof AfterHoursLine.prototype.onSmsReply === "function", "onSmsReply should exist");
assert(typeof AfterHoursLine.prototype.callback === "function", "callback should exist");
assert(typeof AfterHoursLine.prototype.recognizeCaller === "function", "recognizeCaller should exist");

// Type checks
const state: LineState = {
  line: "+15551234567", staffed: false, openSlots: ["Mon 9:15am"], lastCallbackAt: null,
};
assert(state.line === "+15551234567", "LineState shape should match");

const record: AfterHoursRecord = {
  id: 1, line: "+15551234567", caller: "+15559876543",
  reason: "rash on arm", urgency: "medium", ts: "2026-09-28T20:40:00Z",
  smsSent: 0, calledBack: 0,
};
assert(record.reason === "rash on arm", "AfterHoursRecord shape should match");

const inst: AfterHoursInstruction = { action: "speak", text: "Hello" };
assert(inst.action === "speak", "AfterHoursInstruction shape should match");

function main(): void {
  console.log("All smoke tests passed!");
}
main();
