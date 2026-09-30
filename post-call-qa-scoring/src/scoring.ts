/**
 * Pure scoring logic — rolling window, coaching decision, digest line.
 * No runtime imports so the smoke test can run it on Node.
 */

import { FAIL_PREFIX } from "./judging";

export const ROLLING_WINDOW = 5;
export const BREACH_THRESHOLD = 0.8;
export const DEFAULT_COACHING_FLOOR = 3.0;
export const DEFAULT_DIGEST_HOUR = 17;

export type Trend = "improving" | "declining" | "flat";

/**
 * Shape of a `scores` SQL row (as read back). A type alias (not an
 * interface) so it satisfies the `SqlCursor<T extends
 * Record<string, SqlValue>>` constraint via its implicit index signature;
 * `null` is a valid SqlValue so `last_error` stays nullable.
 */
export type ScoreRowLite = {
  ts: number;
  choice: string;
  noul: number;
  score: number;
  status: string; // "graded" | "ungraded"
  last_error: string | null;
};

export interface Rolling {
  avg: number | null;
  worstCategory: string | null;
  trend: Trend;
}

/**
 * Rolling stats over the last ROLLING_WINDOW graded calls (rows assumed
 * newest-first). Ungraded rows are never counted — a failed grading is not
 * a zero score.
 *
 * `worstCategory` is the most frequent failing category in the window;
 * ties break toward the lower average score, then the most recent call.
 */
export function computeRolling(rows: ScoreRowLite[]): Rolling {
  const graded = rows
    .filter((r) => r.status === "graded")
    .sort((a, b) => b.ts - a.ts)
    .slice(0, ROLLING_WINDOW);
  if (graded.length === 0) return { avg: null, worstCategory: null, trend: "flat" };

  const avg = graded.reduce((s, r) => s + r.score, 0) / graded.length;

  let worstCategory: string | null = null;
  const fails = graded.filter((r) => r.choice.startsWith(FAIL_PREFIX));
  if (fails.length > 0) {
    const byCat = new Map<string, { count: number; total: number; latestTs: number }>();
    for (const r of fails) {
      const cur = byCat.get(r.choice) ?? { count: 0, total: 0, latestTs: 0 };
      cur.count += 1;
      cur.total += r.score;
      cur.latestTs = Math.max(cur.latestTs, r.ts);
      byCat.set(r.choice, cur);
    }
    let best: { cat: string; count: number; avg: number; latestTs: number } | null = null;
    for (const [cat, v] of byCat) {
      const cand = { cat, count: v.count, avg: v.total / v.count, latestTs: v.latestTs };
      if (
        !best ||
        cand.count > best.count ||
        (cand.count === best.count &&
          (cand.avg < best.avg ||
            (cand.avg === best.avg && cand.latestTs > best.latestTs)))
      ) {
        best = cand;
      }
    }
    worstCategory = best?.cat ?? null;
  }

  let trend: Trend = "flat";
  if (graded.length >= 2) {
    const half = Math.ceil(graded.length / 2);
    const recent = graded.slice(0, half);
    const older = graded.slice(half);
    const mean = (arr: ScoreRowLite[]) =>
      arr.reduce((s, r) => s + r.score, 0) / arr.length;
    const delta = mean(recent) - mean(older);
    trend = delta > 0.05 ? "improving" : delta < -0.05 ? "declining" : "flat";
  }

  return { avg, worstCategory, trend };
}

/**
 * Coaching flag decision on the 0–5 scale: flag when the rolling average
 * drops below the floor; the flag auto-clears once the average recovers
 * to the floor or above. `null` average leaves the flag unchanged.
 */
export function coachDecision(
  avg: number | null,
  floor: number,
  wasFlagged: boolean,
): { flagged: boolean; cleared: boolean } {
  if (avg === null) return { flagged: wasFlagged, cleared: false };
  if (avg < floor) return { flagged: true, cleared: false };
  return { flagged: false, cleared: wasFlagged };
}

export function secondsUntilNextHour(hour: number, now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export interface DigestInput {
  agentId: string;
  avg: number | null;
  trend: Trend;
  flagged: boolean;
  worstCategory: string | null;
  cleared: boolean;
  floor: number;
  lastStatus?: string | null;
  lastError?: string | null;
  lastNoul?: number | null;
}

/**
 * One-liner digest for this agent's actor. N agents → N texts, each
 * prefixed with the agent's identity.
 */
export function buildDigestLine(input: DigestInput): string {
  const avgText =
    input.avg === null ? "n/a" : `${input.avg.toFixed(1)}/${input.floor.toFixed(1)}`;
  let line = `[${input.agentId}] avg=${avgText} trend=${input.trend}`;

  if (input.flagged && input.worstCategory) {
    line += ` COACHING (worst: ${input.worstCategory})`;
  } else if (input.cleared && input.avg !== null) {
    line += ` cleared (avg ${input.avg.toFixed(1)})`;
  }

  if (input.lastStatus === "ungraded") {
    line += ` ungraded: ${input.lastError || "jev_failed"}`;
  }

  if (input.lastNoul !== null && input.lastNoul !== undefined && input.lastNoul > BREACH_THRESHOLD) {
    line += ` breach (noul=${input.lastNoul.toFixed(2)})`;
  }

  return line;
}
