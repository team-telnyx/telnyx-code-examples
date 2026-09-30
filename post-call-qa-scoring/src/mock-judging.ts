/**
 * Deterministic offline grader — used ONLY when there is no TELNYX_API_KEY
 * AND no TELNYX binding (i.e., local development, where env.SECRETS and
 * env.TELNYX are undefined). Production deployments always have both, so
 * production calls are graded by the real Telnyx Decision Models API; a
 * missing key in production parks the call as `ungraded` instead.
 *
 * Pure module (no runtime imports) so the smoke test can run it on Node.
 */

import { type DecisionResult, PASS, FAIL_PREFIX } from "./judging";

/** Phrases that indicate the legally-relevant recording disclosure was made. */
const DISCLOSURE_MARKERS = [
  "recorded for quality",
  "may be recorded",
  "call may be recorded",
  "this call is recorded",
  "calls are recorded",
  "recording notice",
];

/** Phrases that signal empathy / acknowledgment. */
const EMPATHY_MARKERS = [
  "i understand",
  "i'm sorry",
  "i am sorry",
  "apologize",
  "happy to help",
  "i'd be happy to help",
  "i can help with that",
];

/** Phrases that signal resolution / closing the loop. */
const RESOLUTION_MARKERS = [
  "is there anything else",
  "have a great day",
  "anything else i can help",
  "let me walk you through",
  "that should",
];

export function hasDisclosure(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return DISCLOSURE_MARKERS.some((m) => lower.includes(m));
}

/**
 * Keyword-based stand-in for the Decision Models grade:
 * - `noul`: 0.95 when no recording disclosure is found (hard breach), else 0.
 * - `choice`: `pass` when empathy + resolution markers appear and nothing
 *   contradicts; otherwise the first matching `fail_` category.
 * - `score`: 4.5 base, −1.0 per defect, clamped to [0, 5].
 */
export function mockGrade(transcript: string): DecisionResult {
  const lower = transcript.toLowerCase();

  const breach = hasDisclosure(transcript) ? 0 : 0.95;

  let defects = 0;
  let choice = PASS;
  if (breach) {
    // A hard compliance breach is the most severe defect — count it double.
    defects += 2;
    choice = `${FAIL_PREFIX}compliance`;
  }
  if (!EMPATHY_MARKERS.some((m) => lower.includes(m))) {
    defects += 1;
    if (choice === PASS) choice = `${FAIL_PREFIX}empathy`;
  }
  if (!RESOLUTION_MARKERS.some((m) => lower.includes(m))) {
    defects += 1;
    if (choice === PASS) choice = `${FAIL_PREFIX}resolution`;
  }

  const score = Math.max(0, Math.min(5, 4.5 - defects));
  return { choice, noul: breach, score };
}
