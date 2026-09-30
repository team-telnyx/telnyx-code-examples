import assert from "node:assert";
import { Agent } from "@telnyx/edge-runtime";
import mod, { DisputeCase, type DisputeState } from "./src/index";

const proto = DisputeCase.prototype as unknown as Record<string, unknown>;

function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  console.log(`  ✓ ${name}`);
}

check("DisputeCase extends Agent", DisputeCase.prototype instanceof Agent);
check("has initialState method", typeof proto.initialState === "function");
check("has onChargeback method", typeof proto.onChargeback === "function");
check("has decide method", typeof proto.decide === "function");
check("has deadline method", typeof proto.deadline === "function");
check("has onNewEvidence method", typeof proto.onNewEvidence === "function");

const initial = (proto.initialState as () => DisputeState).call({});
assert.deepEqual(initial, {
  disputeId: "",
  customer: "",
  orderId: "",
  order: null,
  status: "pending",
  verdict: null,
  decided: false,
  deadlineMs: 0,
  evidence: { order: null, delivery: null, contactLog: [], mediaUrl: null },
});
console.log("  ✓ initialState returns valid DisputeState");

const dummy: DisputeState = {
  disputeId: "test",
  customer: "test",
  orderId: "test",
  order: null,
  status: "pending",
  verdict: null,
  decided: false,
  deadlineMs: 0,
  evidence: { order: null, delivery: null, contactLog: [], mediaUrl: null },
};
check("DisputeState shape typechecks", dummy.disputeId === "test");

check("default export has fetch handler", typeof mod.fetch === "function");
check("DisputeCase is exported", typeof DisputeCase === "function");

console.log("✅ smoke_test.ts: All checks passed");
