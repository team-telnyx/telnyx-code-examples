```typescript
import { AfterHoursLine, type EnvBindings, type LineState, type AfterHoursRecord, initSchema } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Test 1: AfterHoursLine is a class
assert(typeof AfterHoursLine === "function", "AfterHoursLine should be a class/function");

// Test 2: onCall method exists
assert(typeof AfterHoursLine.prototype.onCall === "function", "onCall method should exist");

// Test 3: onSmsReply method exists
assert(typeof AfterHoursLine.prototype.onSmsReply === "function", "onSmsReply method should exist");

// Test 4: callback method exists
assert(typeof AfterHoursLine.prototype.callback === "function", "callback method should exist");

// Test 5: recognizeCaller method exists
assert(typeof AfterHoursLine.prototype.recognizeCaller === "function", "recognizeCaller method should exist");

// Test 6: initialState method exists
assert(typeof AfterHoursLine.prototype.initialState === "function", "initialState method should exist");

// Test 7: initialState produces correct state
const mockEnv: EnvBindings = {
  CLINIC_LINE: "+15551234567",
  CLINIC_NAME: "Test Clinic",
  DEMO_MODE: "true",
} as unknown as EnvBindings;

const instance = Object.create(AfterHoursLine.prototype);
instance.env = mockEnv;
const state = instance.initialState();
assert(state.line === "+15551234567", "initialState line should match CLINIC_LINE");
assert(state.staffed === false, "initialState staffed should be false");
assert(Array.isArray(state.openSlots), "initialState openSlots should be an array");
assert(state.openSlots.length === 3, "initialState openSlots should have 3 entries");
assert(state.lastCallbackAt === null, "initialState lastCallbackAt should be null");

// Test 8: optionsSms produces correct output
const sms = instance.optionsSms("rash on arm", "medium");
assert(sms.includes("rash on arm"), "optionsSms should include reason");
assert(sms.includes("Mon 9:15am"), "optionsSms should include first slot");
assert(sms.includes("Reply 1"), "optionsSms should include Reply 1");
assert(sms.includes("Reply 2"), "optionsSms should include Reply 2");

// Test 9: maskPhone masks correctly
const masked = instance.maskPhone("+15551234567");
assert(masked === "+1***67", `maskPhone should return "+1***67", got "${masked}"`);

// Test 10: msUntilNextBizMorning returns positive value
const delay = instance.msUntilNextBizMorning();
assert(delay > 0, "msUntilNextBizMorning should return positive value");
assert(delay < 7 * 24 * 60 * 60 * 1000, "msUntilNextBizMorning should be less than a week");

// Test 11: sendSms in demo mode does not call real API
const demoEnv: EnvBindings = {
  CLINIC_NAME: "Test Clinic",
  CLINIC_LINE: "+15551234567",
  DEMO_MODE: "true",
  TELNYX: {
    messages: {
      create: async () => {
        throw new Error("Should not call real API in demo mode");
      },
    },
  },
} as unknown as EnvBindings;

const demoInstance = Object.create(AfterHoursLine.prototype);
demoInstance.env = demoEnv;
demoInstance.state = demoInstance.initialState();
await demoInstance.sendSms("+15551234567", "Test message");

// Test 12: initSchema is exported and callable
assert(typeof initSchema === "function", "initSchema should be exported");

console.log("✅ All smoke tests passed!");
```
