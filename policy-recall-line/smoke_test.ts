/**
 * Smoke test — loads the module, verifies the Agent contract, the task-method
 * surface, and the pure hit/no-hit decision logic.
 * Run with: npm test (tsx smoke_test.ts).
 */
import assert from "node:assert";
import { Agent } from "@telnyx/edge-runtime";
import mod, {
  DEFAULT_AI_MODEL,
  FALLBACK_AI_MODEL,
  MAX_RETRIES,
  POLL_INTERVAL_S,
  REINDEX_INTERVAL_S,
  RETRY_DELAY_S,
  SIMILARITY_FLOOR,
  PolicyLine,
  selectTopHit,
  type PolicyState,
  type SearchHit,
} from "./src/index";

const proto = PolicyLine.prototype as unknown as Record<string, unknown>;

function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  console.log(`  ✓ ${name}`);
}

check("PolicyLine extends Agent", PolicyLine.prototype instanceof Agent);
check("has fetch hook", typeof proto.fetch === "function");
check("has handleRegisterSource method", typeof proto.handleRegisterSource === "function");
check("has handleAsk method", typeof proto.handleAsk === "function");
check("has onPollTask method", typeof proto.onPollTask === "function");
check("has onRetryTask method", typeof proto.onRetryTask === "function");
check("has onReindexTask method", typeof proto.onReindexTask === "function");
check("has audit rpc method", typeof proto.audit === "function");
check("has reindexNow rpc method", typeof proto.reindexNow === "function");
check("has ensureSchema method", typeof proto.ensureSchema === "function");
check("has startEmbed method", typeof proto.startEmbed === "function");
check("has similaritySearch method", typeof proto.similaritySearch === "function");
check("has composeAnswer method", typeof proto.composeAnswer === "function");

const initial = (proto.initialState as () => PolicyState).call({});
assert.deepEqual(initial, { sources: {} });
console.log("  ✓ initialState returns { sources: {} }");

check("SIMILARITY_FLOOR is 0.9", SIMILARITY_FLOOR === 0.9);
check("POLL_INTERVAL_S is 60", POLL_INTERVAL_S === 60);
check("REINDEX_INTERVAL_S is 86400 (24h)", REINDEX_INTERVAL_S === 86400);
check("RETRY_DELAY_S is 600", RETRY_DELAY_S === 600);
check("MAX_RETRIES is 3", MAX_RETRIES === 3);
check(
  "DEFAULT_AI_MODEL is Telnyx-hosted Kimi (no BYOK key)",
  DEFAULT_AI_MODEL === "moonshotai/Kimi-K3",
);
check(
  "FALLBACK_AI_MODEL is Telnyx-hosted GLM (no BYOK key)",
  FALLBACK_AI_MODEL === "zai-org/GLM-5.3-Flash",
);
check(
  "default models are not BYOK-gated OpenAI models",
  !DEFAULT_AI_MODEL.startsWith("openai/") && !FALLBACK_AI_MODEL.startsWith("openai/"),
);

// Hit / no-hit decision (AC: distance <= 0.9 answers, every distance > 0.9 does not).
check("selectTopHit picks the top chunk within the floor", selectTopHit([
  { document_chunk: "PTO carry-over cap is 5 days.", distance: 0.31 },
  { document_chunk: "Expense policy.", distance: 0.62 },
])?.document_chunk.includes("PTO carry-over") === true);
check("selectTopHit picks the LOWEST distance, not just data[0]", selectTopHit([
  { document_chunk: "worse", distance: 0.5 },
  { document_chunk: "best", distance: 0.31 },
])?.document_chunk === "best");
check("selectTopHit treats distance exactly at the floor as a hit", selectTopHit([
  { document_chunk: "boundary", distance: 0.9 },
]) !== null);
check("selectTopHit returns null when every distance exceeds the floor", selectTopHit([
  { document_chunk: "unrelated", distance: 0.94 },
  { document_chunk: "also unrelated", distance: 0.99 },
]) === null);
check("selectTopHit returns null on an empty result", selectTopHit([]) === null);
check("selectTopHit ignores malformed chunks", selectTopHit([
  { document_chunk: "no distance", distance: Number.NaN },
] as SearchHit[]) === null);

check("default export has fetch handler", typeof mod.fetch === "function");
check("PolicyLine is exported", typeof PolicyLine === "function");

console.log("✅ smoke_test.ts: All checks passed");
