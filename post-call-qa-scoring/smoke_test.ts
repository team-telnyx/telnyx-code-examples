/**
 * Smoke test — runs on Node with tsx against the PURE modules only
 * (judging / scoring / routing). The QAAgent class itself imports
 * `@telnyx/edge-runtime`, which only loads inside the Edge runtime, so the
 * agent and worker files are type-checked via `npm run typecheck` and
 * exercised on deploy.
 *
 * Verifies the pieces that carry the ticket's behavioral guarantees:
 * the real Decision Models request shape, response parsing, the
 * 10/30/60 retry-then-ungraded policy, rolling trend + coaching
 * decisions, digest line content, breach threshold, and webhook
 * routing/fallbacks.
 */

import {
  buildDecisionRequest,
  CHOICE_CRITERIA,
  isTransientDecisionStatus,
  gradingBackoffSeconds,
  DECISION_MODELS_ENDPOINT,
  DECISION_MODEL,
  MAX_GRADING_RETRIES,
  parseDecisionResponse,
  SCORE_CRITERIA,
} from "./src/judging";
import {
  BREACH_THRESHOLD,
  buildDigestLine,
  coachDecision,
  computeRolling,
  DEFAULT_COACHING_FLOOR,
  ROLLING_WINDOW,
  secondsUntilNextHour,
  type ScoreRowLite,
} from "./src/scoring";
import { DEFAULT_AGENT_KEY, resolveCall } from "./src/routing";
import { hasDisclosure, mockGrade } from "./src/mock-judging";

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`PASS: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// ── Decision Models request shape (real Decision Models API contract) ────────────────

const req = buildDecisionRequest("Agent: hello. Customer: hi.");
assert(req.model === DECISION_MODEL, "request uses telnyx/decision-flash");
assert(!Array.isArray(req.questions), "questions is an object, not an array");
assert(
  typeof req.questions.choice === "object" &&
    typeof req.questions.noul === "object" &&
    typeof req.questions.score === "object",
  "questions contains choice, noul, and score in ONE shared-state call",
);
assert(
  (req.questions.choice as { criteria?: unknown }).criteria !== undefined,
  "choice question declares criteria (required by the API)",
);
assert(
  Array.isArray((req.questions.score as { criteria?: unknown }).criteria) &&
    (req.questions.score as { criteria: unknown[] }).criteria.length === 6,
  "score question declares a 6-entry rubric (0–5)",
);
assert(
  typeof req.state.transcript === "string" && req.state.transcript.length > 0,
  "transcript rides in the shared state",
);
assert(Object.keys(CHOICE_CRITERIA).includes("pass"), "choice criteria includes pass");
assert(
  Object.keys(CHOICE_CRITERIA).filter((k) => k.startsWith("fail_")).length >= 3,
  "choice criteria includes failing categories",
);
assert(req.state === null || typeof req.state === "object", "state is JSON-shaped");

// ── Decision Models response parsing (doc-shaped response, no data wrapper) ──────────

const docResponse = {
  model: DECISION_MODEL,
  answers: {
    choice: { type: "choice", choice: "fail_empathy", probabilities: {}, confidence: 0.9 },
    noul: { type: "noul", noul: 0.92 },
    score: { type: "score", score: 1.4, legend: {}, probabilities: {} },
  },
  usage: { input_tokens: 267, output_tokens: 4 },
};
const parsed = parseDecisionResponse(docResponse);
assert(parsed !== null, "parses a doc-shaped response");
assert(parsed?.choice === "fail_empathy", "reads answers.choice.choice");
assert(parsed?.noul === 0.92, "reads answers.noul.noul");
assert(parsed?.score === 1.4, "reads answers.score.score");
assert(parseDecisionResponse({}) === null, "rejects a response without answers");
assert(parseDecisionResponse(null) === null, "rejects a null response");
assert(
  parseDecisionResponse({ answers: { choice: { choice: "bogus_category" } } })?.choice === "pass",
  "coerces an unknown choice to pass (never invents a failing category)",
);
assert(
  parseDecisionResponse({ answers: { choice: { choice: "pass" } } })?.noul === 0,
  "defaults noul to 0 when absent",
);

// ── Retry policy: 10 / 30 / 60 then terminal ungraded ────────────────────

assert(gradingBackoffSeconds(0) === 10, "backoff attempt 0 → 10s");
assert(gradingBackoffSeconds(1) === 30, "backoff attempt 1 → 30s");
assert(gradingBackoffSeconds(2) === 60, "backoff attempt 2 → 60s");
assert(gradingBackoffSeconds(3) === null, "backoff exhausted → terminal (ungraded), no infinite retry");
assert(MAX_GRADING_RETRIES === 3, "max 3 Decision Models retries");
assert(isTransientDecisionStatus(429) && isTransientDecisionStatus(502), "429/5xx are retried");
assert(!isTransientDecisionStatus(400) && !isTransientDecisionStatus(401), "4xx are terminal");

// ── Rolling window, trend, coaching flag ─────────────────────────────────

assert(ROLLING_WINDOW === 5, "rolling window is 5 calls");
assert(BREACH_THRESHOLD === 0.8, "breach threshold is 0.8");
assert(DEFAULT_COACHING_FLOOR === 3.0, "default coaching floor is 3.0 on the 0–5 scale");

const row = (score: number, ts: number, choice = "pass", status = "graded", lastError: string | null = null): ScoreRowLite => ({
  ts,
  choice,
  noul: 0,
  score,
  status,
  last_error: lastError,
});

const allPass = [row(4, 5), row(4, 4), row(4, 3), row(4, 2), row(4, 1)];
const rolling1 = computeRolling(allPass);
assert(rolling1.avg === 4, "rolling average over 5 graded calls");
assert(rolling1.worstCategory === null, "no worst category when nothing failed");
assert(rolling1.trend === "flat", "trend flat when recent and older halves match");

const slipping = [row(1, 5, "fail_empathy"), row(1, 4, "fail_empathy"), row(5, 3), row(5, 2), row(5, 1)];
const rolling2 = computeRolling(slipping);
assert(rolling2.avg === 3.4, "rolling average mixes failing calls");
assert(rolling2.worstCategory === "fail_empathy", "worst category = most frequent failing category");
assert(rolling2.trend === "declining", "trend declining when recent half is worse");

const improving = [row(5, 5), row(5, 4), row(1, 3), row(1, 2), row(1, 1)];
assert(computeRolling(improving).trend === "improving", "trend improving when recent half is better");

const withUngraded = [row(1, 5, "fail_process", "ungraded", "decision_http_500"), row(5, 4), row(5, 3), row(5, 2), row(5, 1), row(5, 0)];
const rolling3 = computeRolling(withUngraded);
assert(rolling3.avg === 5, "ungraded rows never counted as a false zero");
assert(rolling3.worstCategory === null, "ungraded rows contribute no failing category");

assert(computeRolling([]).avg === null, "empty history → null average");
assert(computeRolling([row(2, 1)]).trend === "flat", "single call → flat trend");

const flagged = coachDecision(2.5, 3.0, false);
assert(flagged.flagged === true && flagged.cleared === false, "avg < floor flags coaching");
const staysFlagged = coachDecision(2.5, 3.0, true);
assert(staysFlagged.flagged === true, "flag stays while avg remains below floor");
const cleared = coachDecision(3.2, 3.0, true);
assert(cleared.flagged === false && cleared.cleared === true, "flag auto-clears on recovery to >= floor");
const unchanged = coachDecision(null, 3.0, true);
assert(unchanged.flagged === true, "null average leaves the flag unchanged");

// ── Digest line content ──────────────────────────────────────────────────

const coachLine = buildDigestLine({
  agentId: "agent-001",
  avg: 2.4,
  trend: "declining",
  flagged: true,
  worstCategory: "fail_empathy",
  cleared: false,
  floor: 3.0,
});
assert(coachLine.startsWith("[agent-001]"), "digest line is prefixed with the agent identity");
assert(coachLine.includes("COACHING (worst: fail_empathy)"), "coaching digest names the worst failing category");
assert(!coachLine.includes("cleared"), "coaching digest does not claim cleared");

const clearLine = buildDigestLine({
  agentId: "agent-001",
  avg: 3.8,
  trend: "improving",
  flagged: false,
  worstCategory: null,
  cleared: true,
  floor: 3.0,
});
assert(clearLine.includes("cleared (avg 3.8)"), "recovered agent's digest shows cleared (avg X.X)");

const ungradedLine = buildDigestLine({
  agentId: "agent-002",
  avg: 4.0,
  trend: "flat",
  flagged: false,
  worstCategory: null,
  cleared: false,
  floor: 3.0,
  lastStatus: "ungraded",
  lastError: "decision_http_502",
});
assert(ungradedLine.includes("ungraded: decision_http_502"), "digest surfaces ungraded calls with the last error");

const breachLine = buildDigestLine({
  agentId: "agent-003",
  avg: 4.5,
  trend: "flat",
  flagged: false,
  worstCategory: null,
  cleared: false,
  floor: 3.0,
  lastStatus: "graded",
  lastNoul: 0.92,
});
assert(breachLine.includes("breach (noul=0.92)"), "digest flags a hard compliance breach");
assert(breachLine.startsWith("[agent-003] avg=4.5"), "breach does not affect the coaching line");

const emptyLine = buildDigestLine({
  agentId: "agent-004",
  avg: null,
  trend: "flat",
  flagged: false,
  worstCategory: null,
  cleared: false,
  floor: 3.0,
});
assert(emptyLine.includes("avg=n/a"), "agent with no graded calls shows n/a average");

// ── Digest scheduling math ───────────────────────────────────────────────

const at16_59 = secondsUntilNextHour(17, new Date(Date.UTC(2026, 8, 30, 16, 59, 0)));
assert(at16_59 === 60, "digest scheduled for the next 17:00 UTC (1 minute out)");
const at17_01 = secondsUntilNextHour(17, new Date(Date.UTC(2026, 8, 30, 17, 1, 0)));
assert(at17_01 === 23 * 3600 + 59 * 60, "after 17:00 UTC the digest rolls to the next day");
assert(secondsUntilNextHour(17, new Date(Date.UTC(2026, 8, 30, 0, 0, 0))) === 17 * 3600, "midnight → 17 hours to digest");

// ── Webhook routing: agent identity resolution and fallbacks ─────────────

const webhookBody = {
  data: {
    event: "call.conversation.ended",
    payload: {
      call_control_id: "call_abc123",
      called_number: "+15550001111",
      metadata: { agentId: "agent-001" },
      transcript: "Agent: hello",
    },
  },
};
const r1 = resolveCall(webhookBody, "agentId", null);
assert(r1 !== null && r1.agentId === "agent-001", "agentId from payload metadata");
assert(r1?.digestEnabled === true, "metadata-resolved agents get digests");
assert(r1?.callId === "call_abc123", "callId from payload");

const mappedBody = {
  data: {
    payload: { call_control_id: "call_2", called_number: "+15550002222", transcript: "Agent: hi" },
  },
};
const r2 = resolveCall(mappedBody, "agentId", { "+15550002222": "agent-002" });
assert(r2?.agentId === "agent-002", "AGENT_NUMBER_MAP fallback resolves the agent");
assert(r2?.digestEnabled === true, "map-resolved agents get digests");

const fallbackBody = {
  data: {
    payload: { call_control_id: "call_3", called_number: "+15550003333", transcript: "Agent: hi" },
  },
};
const r3 = resolveCall(fallbackBody, "agentId", null);
assert(r3?.agentId === "+15550003333", "no metadata + no map → key by called number");
assert(r3?.digestEnabled === false, "fallback-keyed actors have the digest suppressed (log-only)");

assert(
  resolveCall({ data: { payload: { call_control_id: "call_4" } } }, "agentId", null) === null,
  "payload without transcript → null (no scoring, no false zero)",
);
assert(DEFAULT_AGENT_KEY === "agentId", "default metadata key is agentId");

const customKeyBody = {
  data: { payload: { call_id: "call_5", transcript: "Agent: hi", metadata: { qa_agent: "agent-009" } } },
};
assert(resolveCall(customKeyBody, "qa_agent", null)?.agentId === "agent-009", "CALL_METADATA_AGENT_KEY is honored");

// ── Mock grading (local dev only; production uses real Decision Models) ─────────────

const goodCall = "Agent: I understand, let me walk you through it. Is there anything else I can help with? This call may be recorded for quality purposes.";
const good = mockGrade(goodCall);
assert(good.choice === "pass", "mock: empathy + resolution + disclosure → pass");
assert(good.noul === 0, "mock: disclosure present → no breach");
assert(good.score >= 4 && good.score <= 5, "mock: clean call scores high");

const badCall = "Agent: Just restart your router.";
const bad = mockGrade(badCall);
assert(bad.choice === "fail_compliance", "mock: missing disclosure → fail_compliance");
assert(bad.noul === 0.95, "mock: missing disclosure → hard breach (noul 0.95)");
assert(bad.score <= 1, "mock: breach + empathy + resolution defects → very low score");
const coldCall = "Agent: We received your request. This call may be recorded.";
const cold = mockGrade(coldCall);
assert(cold.choice === "fail_empathy" || cold.choice === "fail_resolution", "mock: cold call lands in a failing category");
assert(cold.noul === 0, "mock: disclosure present → no breach even when empathy fails");
assert(hasDisclosure("recorded for quality purposes") === true, "mock: disclosure marker detection");
assert(hasDisclosure("no notice at all here") === false, "mock: no marker → no disclosure");
assert(mockGrade(goodCall).score === good.score, "mock: grading is deterministic");

// ── Summary ──────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll smoke tests passed.");
}
