/**
 * Telnyx Decision Models — request construction and response parsing.
 *
 * Pure module (no runtime imports) so the smoke test can run it on Node.
 * Reference: https://developers.telnyx.com/docs/inference/decision-models
 *
 * The TypeSafe-compatible endpoint takes `questions` as an OBJECT keyed by
 * question name (not an array), each with `type` + `instructions` and — for
 * `choice` and `score` — a `criteria` block. The response returns `answers`
 * with one entry per question: `answers.<name>.choice|noul|score`.
 */

export const DECISION_MODELS_ENDPOINT = "https://api.telnyx.com/v2/ai/typesafe/v1/systemone";
export const DECISION_MODEL = "telnyx/decision-flash";

/** Bounded retry policy: 3 attempts with 10s / 30s / 60s backoff. */
export const MAX_GRADING_RETRIES = 3;
export const GRADING_BACKOFF_SECONDS = [10, 30, 60] as const;

export const PASS = "pass";
export const FAIL_PREFIX = "fail_";

/** 0–5 quality rubric: score answers are expected indices over this array. */
export const SCORE_CRITERIA = [
  "Very poor",
  "Poor",
  "Fair",
  "Good",
  "Very good",
  "Excellent",
] as const;

/**
 * Pass / fail-with-category rubric. A `choice` answer that starts with
 * `fail_` names the failing category; `pass` means the call met standards.
 */
export const CHOICE_CRITERIA: Record<string, string> = {
  pass: "The call met QA standards",
  fail_compliance: "Missed a required disclosure or violated a compliance rule",
  fail_empathy: "Rude, dismissive, or failed to acknowledge the customer's situation",
  fail_process: "Followed the wrong procedure or gave incorrect instructions",
  fail_resolution: "Failed to resolve or meaningfully advance the customer's issue",
};

export interface DecisionResult {
  choice: string;
  noul: number;
  score: number;
}

export interface DecisionRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

/** Build the `questions` object — all three types share one `state` call. */
export function buildDecisionQuestions(): Record<string, unknown> {
  return {
    choice: {
      type: "choice",
      instructions:
        "Did the support agent pass or fail QA? If the call failed, pick the failing category that best describes why.",
      criteria: CHOICE_CRITERIA,
    },
    noul: {
      type: "noul",
      instructions:
        "Does the transcript contain a hard compliance breach — e.g. a legally required disclosure is missing or a prohibited statement is made? 1 = yes, breach present; 0 = no breach.",
    },
    score: {
      type: "score",
      instructions:
        "Rate the overall call quality on the rubric, where lower is worse and higher is better.",
      criteria: SCORE_CRITERIA,
    },
  };
}

/** Build the full request body; the transcript rides in the shared `state`. */
export function buildDecisionRequest(transcript: string): DecisionRequest {
  return {
    model: DECISION_MODEL,
    state: { transcript },
    questions: buildDecisionQuestions(),
  };
}

/**
 * Backoff delay for a Decision Models attempt. Returns `null` once attempts are
 * exhausted — the caller should then record the call as `ungraded`
 * (terminal, no infinite retry).
 */
export function gradingBackoffSeconds(attempt: number): number | null {
  if (attempt < 0 || attempt >= GRADING_BACKOFF_SECONDS.length) return null;
  return GRADING_BACKOFF_SECONDS[attempt];
}

/** 429 and 5xx-class responses are worth retrying; 4xx are not. */
export function isTransientDecisionStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse the Decision Models response into a DecisionResult.
 *
 * Shape per the Decision Models docs: `{ model, answers: { <name>: { choice?
 * | noul? | score?, probabilities?, confidence? } }, usage }` — no `data`
 * wrapper. A `choice` answer not present in the rubric is coerced to
 * `pass` (conservative: never invent a failing category). Returns `null`
 * when the response is structurally unusable.
 */
export function parseDecisionResponse(data: unknown): DecisionResult | null {
  if (!data || typeof data !== "object") return null;
  const answers = (data as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return null;
  const a = answers as Record<string, Record<string, unknown> | undefined>;

  const rawChoice = a["choice"]?.["choice"];
  const choice =
    typeof rawChoice === "string" &&
    (rawChoice === PASS || rawChoice.startsWith(FAIL_PREFIX))
      ? rawChoice
      : PASS;
  const noul = asNumber(a["noul"]?.["noul"], 0);
  const score = asNumber(a["score"]?.["score"], 0);
  return { choice, noul, score };
}
