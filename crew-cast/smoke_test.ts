// Smoke test for crew-cast. Run with: npx tsx smoke_test.ts
// Verifies the module loads, the actor class is wired to the Edge Agent base,
// the actor surface the router depends on exists, and the validation helpers
// behave. No network calls, no credentials required.

import { Agent } from "@telnyx/edge-runtime";
import worker, { CrewCast, isE164, maskPhone } from "./src/index";

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

check("default export exposes a fetch handler", () => {
  assert(typeof worker.fetch === "function", "worker.fetch is not a function");
});

check("CrewCast extends the Edge Agent base class", () => {
  assert(typeof CrewCast === "function", "CrewCast is not a class");
  assert(Object.prototype.isPrototypeOf.call(Agent, CrewCast), "CrewCast does not extend Agent");
});

check("CrewCast implements the actor surface", () => {
  const methods = ["cast", "onFinalized", "onReply", "deliveryReport", "repollUnknown", "fetch"];
  for (const method of methods) {
    assert(typeof (CrewCast.prototype as Record<string, unknown>)[method] === "function", `missing method: ${method}`);
  }
});

check("isE164 accepts US/CA numbers only", () => {
  assert(isE164("+15551234567"), "rejected a valid NANP number");
  assert(!isE164("+44551234567"), "accepted a non-NANP number");
  assert(!isE164("5551234567"), "accepted a number without +1");
  assert(!isE164("+1555123456"), "accepted a 9-digit number");
  assert(!isE164(undefined), "accepted a non-string");
});

check("maskPhone never leaks the full number", () => {
  const masked = maskPhone("+15551234567");
  assert(!masked.includes("5551234567"), "masked value still contains the full number");
  assert(masked.startsWith("+15"), "masked value lost its prefix");
});

if (failures > 0) {
  throw new Error(`${failures} smoke check(s) failed`);
}
console.log("smoke_test: all checks passed");
