/**
 * QAAgent — THE quality profile.
 *
 * The actor IS a support agent's quality record. One durable actor per
 * agent, addressed by `idFromName(agentId)` (resolved from call metadata,
 * with a phone-number map fallback). It grades each ended call with the
 * Telnyx Decision Models API, appends every score to its own SQL history,
 * tracks the 5-call rolling average + trend, flags slipping agents for
 * coaching (auto-clearing on recovery), flags compliance breaches for
 * manager review independently of pass/fail, and texts a daily digest.
 *
 * Exactly-once grading: every call gets a stable scheduled task
 * `grade:<callId>` (a re-delivered webhook re-schedules the same id; the
 * SDK replaces the pending task), backed by a UNIQUE `call_id` PRIMARY
 * KEY on the `scores` table where the pending row is written before the
 * task is scheduled. Decision Models API failures retry on a 10s / 30s / 60s schedule
 * (max 3 retries, honoring `Retry-After`); after that the call is
 * recorded `ungraded` with the last error — surfaced in the digest,
 * never retried forever.
 *
 * State uses `-1` / `""` sentinels instead of nulls: `setState` merges as
 * RFC-7396 merge patch, where a `null` value deletes the key.
 */

import {
  Agent,
  type ActorContext,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
  type Secrets,
} from "@telnyx/edge-runtime";

import {
  buildDecisionRequest,
  isTransientDecisionStatus,
  DECISION_MODELS_ENDPOINT,
  parseDecisionResponse,
  type DecisionResult,
  gradingBackoffSeconds,
} from "./judging";
import { mockGrade } from "./mock-judging";
import {
  BREACH_THRESHOLD,
  buildDigestLine,
  coachDecision,
  computeRolling,
  DEFAULT_COACHING_FLOOR,
  DEFAULT_DIGEST_HOUR,
  ROLLING_WINDOW,
  secondsUntilNextHour,
  type ScoreRowLite,
  type Trend,
} from "./scoring";

// ── Bindings ─────────────────────────────────────────────────────────────

export interface TelnyxBinding {
  messages: {
    send: (params: { to: string; from?: string; text: string }) => Promise<unknown>;
  };
}

export interface QAAgentStub extends ActorStub, Pick<QAAgent, "recordCallEnded"> {}

export interface QAAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): QAAgentStub;
}

export interface Env {
  QA_AGENT: QAAgentNamespace;
  TELNYX: TelnyxBinding;
  SECRETS: Secrets;
}

// ── State ────────────────────────────────────────────────────────────────

/**
 * Fast-path state only — the guarantees (history, exactly-once) live in
 * the agent's SQL tables. The index signature satisfies the Agent
 * merge-patch constraint; `-1` / `""` mean "unset" (see module doc).
 */
export interface QAAgentState {
  agentId: string;
  digestEnabled: boolean;
  digestScheduled: boolean;
  flagged: boolean;
  /** "" = no failing category in the rolling window. */
  worstCategory: string;
  /** -1 = no graded calls yet. */
  rolling: number;
  /** "improving" | "declining" | "flat" */
  trend: string;
  /** Average at which the coaching flag last auto-cleared; -1 = none. */
  clearedAvg: number;
  [key: string]: unknown;
}

export interface RecordOutcome {
  status: "already_recorded" | "grade_scheduled";
  callId: string;
  agentId: string;
  digestEnabled: boolean;
}

type ScoreRow = ScoreRowLite & {
  call_id: string;
  agent_id: string;
  transcript: string;
};

// ── Agent ────────────────────────────────────────────────────────────────

export class QAAgent extends Agent<Env, QAAgentState> {
  private schemaReady = false;

  protected initialState(): QAAgentState {
    return {
      agentId: "",
      digestEnabled: false,
      digestScheduled: false,
      flagged: false,
      worstCategory: "",
      rolling: -1,
      trend: "flat",
      clearedAvg: -1,
    };
  }

  // ── SQL schema (private to this actor; created on first use) ──────────

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS scores(
        call_id     TEXT PRIMARY KEY,
        agent_id    TEXT,
        ts          INTEGER,
        choice      TEXT,
        noul        REAL,
        score       REAL,
        status      TEXT,
        transcript  TEXT,
        last_error  TEXT
      )`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS breaches(
        agent_id TEXT,
        call_id  TEXT,
        ts       INTEGER,
        noul     REAL,
        choice   TEXT
      )`);
    this.schemaReady = true;
  }

  private findScore(callId: string): ScoreRow | null {
    const rows = this.ctx.storage.sql
      .exec<ScoreRow>(
        "SELECT call_id, agent_id, ts, choice, noul, score, status, transcript, last_error FROM scores WHERE call_id = ?",
        callId,
      )
      .toArray();
    return rows[0] ?? null;
  }

  // ── Entry point (RPC from the worker) ─────────────────────────────────

  /**
   * Secret reads are defensive: in local dev (`telnyx-edge dev`) the
   * SECRETS binding is undefined, so reads must degrade to "unset" rather
   * than throwing.
   */
  private async getSecret(handle: string): Promise<string | null> {
    try {
      return await this.env.SECRETS.get(handle);
    } catch {
      return null;
    }
  }

  /** The TELNYX binding only exists in a real deployment (not local dev). */
  private hasTelnyxBinding(): boolean {
    return typeof (this.env as unknown as Record<string, unknown>).TELNYX !== "undefined";
  }

  /**
   * Record an ended call and schedule its one-time grading. The `pending`
   * row is the durable dedup marker: a re-delivery of the same call
   * finds the row and no-ops, and the stable `grade:<callId>` task id
   * means at most one pending grading task per call.
   */
  async recordCallEnded(
    callId: string,
    transcript: string,
    agentId: string,
    digestEnabled: boolean,
  ): Promise<RecordOutcome> {
    this.ensureSchema();

    if (this.findScore(callId)) {
      return { status: "already_recorded", callId, agentId, digestEnabled };
    }

    this.ctx.storage.sql.exec(
      "INSERT INTO scores(call_id, agent_id, ts, choice, noul, score, status, transcript, last_error) VALUES (?, ?, ?, '', 0, 0, 'pending', ?, '')",
      callId,
      agentId,
      Date.now(),
      transcript,
    );

    // Persist identity + digest configuration on first sight.
    const state = await this.getState();
    const patch: Partial<QAAgentState> = {};
    if (state.agentId !== agentId) patch.agentId = agentId;
    if (digestEnabled !== state.digestEnabled) patch.digestEnabled = digestEnabled;
    if (!state.digestScheduled) {
      const delay = secondsUntilNextHour(await this.digestHour());
      await this.schedule(delay, "runDigest", undefined, { id: "digest" });
      patch.digestScheduled = true;
    }
    if (Object.keys(patch).length > 0) await this.setState(patch);

    await this.schedule(0, "gradeCall", { callId, attempt: 0 }, {
      id: stableGradeId(callId),
    });
    return { status: "grade_scheduled", callId, agentId, digestEnabled };
  }

  // ── Scheduled task handlers ───────────────────────────────────────────

  /**
   * Grade one call. Attempts 0..MAX: the initial call plus retries on
   * 10s / 30s / 60s (honoring `Retry-After`); then the call is parked as
   * `ungraded` — terminal, surfaced in the digest.
   */
  async gradeCall(payload: { callId: string; attempt: number }): Promise<void> {
    this.ensureSchema();

    const row = this.findScore(payload.callId);
    if (!row || row.status !== "pending") return; // graded/ungraded → no-op
    const transcript = row.transcript ?? "";
    if (!transcript) {
      await this.markUngraded(payload.callId, "no_transcript");
      return;
    }

    const apiKey = await this.getSecret("TELNYX_API_KEY");
    if (!apiKey) {
      if (this.hasTelnyxBinding()) {
        // Real deployment without a key: park honestly, never mock in prod.
        await this.markUngraded(payload.callId, "missing_api_key");
        return;
      }
      // Local dev (no SECRETS, no TELNYX binding): deterministic mock grade.
      const mock = mockGrade(transcript);
      console.log(`mock_grading call=${payload.callId} (set TELNYX_API_KEY for real Decision Models grading)`);
      await this.applyGrade(payload.callId, mock);
      return;
    }

    let res: Response;
    try {
      res = await fetch(DECISION_MODELS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDecisionRequest(transcript)),
      });
    } catch {
      await this.retryOrPark(payload.callId, payload.attempt, "decision_network_error");
      return;
    }

    if (!res.ok) {
      if (isTransientDecisionStatus(res.status)) {
        await this.retryOrPark(
          payload.callId,
          payload.attempt,
          `decision_http_${res.status}`,
          res.headers.get("Retry-After"),
        );
      } else {
        await this.markUngraded(payload.callId, `decision_http_${res.status}`);
      }
      return;
    }

    const data = (await res.json().catch(() => null)) as unknown;
    const result = parseDecisionResponse(data);
    if (!result) {
      await this.markUngraded(payload.callId, "decision_invalid_response");
      return;
    }

    await this.applyGrade(payload.callId, result);
  }

  /**
   * Daily digest tick. Re-arms the next DIGEST_HOUR_UTC run first (the
   * chain survives a mid-SMS crash), then texts this actor's own
   * one-liner to TEAM_LEAD_E164 — suppressed log-only when the agent
   * identity was only a fallback (no metadata, no number map).
   */
  async runDigest(): Promise<void> {
    const delay = secondsUntilNextHour(await this.digestHour());
    await this.schedule(delay, "runDigest", undefined, { id: "digest" });

    const state = await this.getState();
    if (!state.digestEnabled) {
      console.log(`digest_suppressed agent=${state.agentId}`);
      return;
    }

    const last = this.ctx.storage.sql
      .exec<ScoreRowLite>(
        "SELECT ts, choice, noul, score, status, last_error FROM scores WHERE status != 'pending' ORDER BY ts DESC LIMIT 1",
      )
      .toArray()[0] ?? null;
    const graded = this.ctx.storage.sql
      .exec<ScoreRowLite>(
        `SELECT ts, choice, noul, score, status, last_error FROM scores WHERE status = 'graded' ORDER BY ts DESC LIMIT ${ROLLING_WINDOW}`,
      )
      .toArray();
    const { avg, worstCategory, trend } = computeRolling(graded);
    const floor = await this.coachingFloor();

    const line = buildDigestLine({
      agentId: state.agentId || "unknown",
      avg: state.rolling >= 0 ? state.rolling : avg,
      trend: (state.trend || trend) as Trend,
      flagged: state.flagged,
      worstCategory: state.worstCategory || null,
      cleared: state.clearedAvg >= 0,
      floor,
      lastStatus: last?.status ?? null,
      lastError: last?.last_error ?? null,
      lastNoul: last?.noul ?? null,
    });

    await this.sendDigest(line);

    if (state.clearedAvg >= 0) {
      // The recovery note is a one-time event — consume it after reporting.
      await this.setState({ clearedAvg: -1 });
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Schedule the next Decision Models API attempt (10/30/60), or park the call ungraded. */
  private async retryOrPark(
    callId: string,
    attempt: number,
    reason: string,
    retryAfterHeader?: string | null,
  ): Promise<void> {
    // Attempts exhausted → park, regardless of any Retry-After header.
    const backoff = gradingBackoffSeconds(attempt);
    if (backoff === null) {
      await this.markUngraded(callId, "decision_failed_after_retries");
      return;
    }
    const headerDelay = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const delay =
      Number.isFinite(headerDelay) && headerDelay > 0 ? headerDelay : backoff;
    await this.schedule(delay, "gradeCall", { callId, attempt: attempt + 1 }, {
      id: stableGradeId(callId),
    });
    console.log(`decision_retry_scheduled call=${callId} attempt=${attempt + 1} delay=${delay} reason=${reason}`);
  }

  private async markUngraded(callId: string, error: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE scores SET status = 'ungraded', last_error = ? WHERE call_id = ? AND status = 'pending'",
      error,
      callId,
    );
    console.log(`call_ungraded call=${callId} error=${error}`);
  }

  private async applyGrade(callId: string, result: DecisionResult): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE scores SET ts = ?, choice = ?, noul = ?, score = ?, status = 'graded', last_error = '' WHERE call_id = ?",
      Date.now(),
      result.choice,
      result.noul,
      result.score,
      callId,
    );
    await this.recomputeTrend();

    // Breach is independent of pass/fail: a passing call can still carry
    // a hard compliance breach and gets flagged for manager review.
    if (result.noul > BREACH_THRESHOLD) {
      const state = await this.getState();
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO breaches(agent_id, call_id, ts, noul, choice) VALUES (?, ?, ?, ?, ?)",
        state.agentId,
        callId,
        Date.now(),
        result.noul,
        result.choice,
      );
      await this.sendDigest(
        `QA BREACH review needed: agent=${state.agentId} call=${callId} noul=${result.noul.toFixed(2)} choice=${result.choice}`,
      );
    }
  }

  /** Recompute the rolling window and coaching flag from durable history. */
  private async recomputeTrend(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<ScoreRowLite>(
        `SELECT ts, choice, noul, score, status, last_error FROM scores WHERE status = 'graded' ORDER BY ts DESC LIMIT ${ROLLING_WINDOW}`,
      )
      .toArray();
    const { avg, worstCategory, trend } = computeRolling(rows);
    const floor = await this.coachingFloor();
    const wasFlagged = (await this.getState()).flagged;
    const { flagged, cleared } = coachDecision(avg, floor, wasFlagged);

    await this.setState({
      rolling: avg ?? -1,
      worstCategory: worstCategory ?? "",
      trend,
      flagged,
      clearedAvg: cleared && avg !== null ? avg : -1,
    });

    const state = await this.getState();
    if (flagged && !wasFlagged) {
      console.log(`coach_flagged agent=${state.agentId} avg=${avg?.toFixed(2)} worst=${worstCategory ?? "n/a"}`);
    } else if (cleared) {
      console.log(`coach_cleared agent=${state.agentId} avg=${avg?.toFixed(2)}`);
    }
  }

  private async sendDigest(text: string): Promise<void> {
    const to = await this.getSecret("TEAM_LEAD_E164");
    const from = await this.getSecret("TELNYX_FROM_NUMBER");
    if (!to || !from) {
      console.log("digest_not_configured: TEAM_LEAD_E164 and TELNYX_FROM_NUMBER required");
      return;
    }
    try {
      await this.env.TELNYX.messages.send({ to, from, text });
    } catch (err) {
      // Digest delivery failures must not kill the digest chain (the next
      // run is already scheduled) — log and move on.
      console.log(`digest_send_failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  private async coachingFloor(): Promise<number> {
    const raw = await this.getSecret("QA_COACHING_FLOOR");
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) ? n : DEFAULT_COACHING_FLOOR;
  }

  private async digestHour(): Promise<number> {
    const raw = await this.getSecret("DIGEST_HOUR_UTC");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_DIGEST_HOUR;
  }
}

/** Stable scheduled-task id for a call's grading — plain string only. */
export function stableGradeId(callId: string): string {
  return `grade:${callId.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
}
