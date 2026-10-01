/**
 * Smoke test — loads the module, verifies the Agent contract and the pure
 * answer/status helpers. Run with: npm test (tsx smoke_test.ts).
 */
import assert from "node:assert";
import { Agent } from "@telnyx/edge-runtime";
import mod, {
  DEFAULT_AI_MODEL,
  OrderAgent,
  actorNameFromPhone,
  type CarrierEvent,
  type CustomerState,
  type OrderRow,
} from "./src/index";

const proto = OrderAgent.prototype as unknown as Record<string, unknown>;

function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  console.log(`  ✓ ${name}`);
}

check("OrderAgent extends Agent", OrderAgent.prototype instanceof Agent);
check("has linkOrder method", typeof proto.linkOrder === "function");
check("has onCarrier method", typeof proto.onCarrier === "function");
check("has onInboundMessage method", typeof proto.onInboundMessage === "function");
check("has notifyDelay method", typeof proto.notifyDelay === "function");
check("has buildAnswer method", typeof proto.buildAnswer === "function");
check("has demoAnswer method", typeof proto.demoAnswer === "function");
check("has statusLabel method", typeof proto.statusLabel === "function");
check("has ensureTables method", typeof proto.ensureTables === "function");

const initial = (proto.initialState as () => CustomerState).call({});
assert.deepEqual(initial, { customer: "", linked: [], lastNotified: null });
console.log("  ✓ initialState returns valid CustomerState");

check("statusLabel maps carrier kinds", (proto.statusLabel as (k: string) => string).call(null, "shipped") === "shipped"
  && (proto.statusLabel as (k: string) => string).call(null, "delayed") === "delayed"
  && (proto.statusLabel as (k: string) => string).call(null, "delivered") === "delivered"
  && (proto.statusLabel as (k: string) => string).call(null, "unknown") === "pending");

const rows: OrderRow[] = [
  { order_id: "ORD-1", customer: "+15551234567", status: "shipped", eta: "Tue", ts: 2 },
];
const demoAnswer = proto.demoAnswer as (q: string, r: OrderRow[]) => string;
check("demoAnswer: status question for shipped", demoAnswer
  .call(null, "where's my order?", rows)
  .includes("On the way"));
check("demoAnswer: eta question surfaces the ETA", demoAnswer
  .call(null, "will it make it by Friday?", rows)
  .includes("Tue"));
const delayedRows: OrderRow[] = [
  { order_id: "ORD-1", customer: "+15551234567", status: "delayed", eta: "Fri", ts: 3 },
];
check("demoAnswer: delayed eta question reports the new ETA", demoAnswer
  .call(null, "will it make it by Friday?", delayedRows)
  .includes("delayed"));
check("demoAnswer: no linked orders guidance", demoAnswer
  .call(null, "where's my order?", [])
  .includes("don't see any orders"));

const shippedEvent: CarrierEvent = {
  kind: "shipped",
  orderId: "ORD-1",
  customer: "+15551234567",
  eta: "Tue",
  ts: 1,
};
check("statusSms announces proactive shipped text", ((proto.statusSms as (e: CarrierEvent) => string).call(null, shippedEvent)).includes("on the way"));
check("delaySms announces the new ETA + reason", ((proto.delaySms as (e: CarrierEvent) => string).call(null, {
  ...shippedEvent,
  kind: "delayed",
  eta: "Fri",
  reason: "weather hold",
} as CarrierEvent)).includes("Fri") && ((proto.delaySms as (e: CarrierEvent) => string).call(null, {
  ...shippedEvent,
  kind: "delayed",
  eta: "Fri",
  reason: "weather hold",
} as CarrierEvent)).includes("weather hold"));

check("actorNameFromPhone strips + and lowercases", actorNameFromPhone("+15551234567") === "15551234567");
check("DEFAULT_AI_MODEL is Telnyx-hosted (no BYOK key)", DEFAULT_AI_MODEL === "zai-org/GLM-5.2");

check("default export has fetch handler", typeof mod.fetch === "function");
check("OrderAgent is exported", typeof OrderAgent === "function");

console.log("✅ smoke_test.ts: All checks passed");
