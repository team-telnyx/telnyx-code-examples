import { StatefulActor } from "@telnyx/edge-runtime";

export interface CallRecord {
  call_control_id: string;
  from: string;
  to: string;
  answered_at: string;
  status: "screening" | "forwarded" | "blocked" | "hungup";
  transcript?: string;
  verdict?: "robocall" | "legitimate" | "unknown";
  confidence?: number;
  reason?: string;
}

export interface Stats {
  total_calls: number;
  blocked: number;
  forwarded: number;
  blocklist: string[];
}

/**
 * CallScreener — one actor instance per screened phone number.
 *
 * Tracks per-number state:
 *  - call history (recent calls to this number)
 *  - cumulative stats (total, blocked, forwarded)
 *  - blocklist (caller numbers flagged as robocalls)
 *
 * Persistence: state survives across invocations via this.ctx.storage.
 */
export class CallScreener extends StatefulActor {
  private async getStats(): Promise<Stats> {
    return (
      (await this.ctx.storage.get<Stats>("stats")) ?? {
        total_calls: 0,
        blocked: 0,
        forwarded: 0,
        blocklist: [],
      }
    );
  }

  private async saveStats(stats: Stats): Promise<void> {
    await this.ctx.storage.put("stats", stats);
  }

  private async getCalls(): Promise<CallRecord[]> {
    return (await this.ctx.storage.get<CallRecord[]>("calls")) ?? [];
  }

  private async saveCall(record: CallRecord): Promise<void> {
    const calls = await this.getCalls();
    calls.unshift(record);
    // keep most recent 50
    const trimmed = calls.slice(0, 50);
    await this.ctx.storage.put("calls", trimmed);
  }

  private async updateCall(
    callControlId: string,
    patch: Partial<CallRecord>,
  ): Promise<CallRecord | null> {
    const calls = await this.getCalls();
    const idx = calls.findIndex((c) => c.call_control_id === callControlId);
    if (idx === -1) return null;
    calls[idx] = { ...calls[idx], ...patch };
    await this.ctx.storage.put("calls", calls);
    return calls[idx];
  }

  /** Record a new inbound call (status: screening). */
  async recordCall(
    callControlId: string,
    from: string,
    to: string,
  ): Promise<CallRecord> {
    const record: CallRecord = {
      call_control_id: callControlId,
      from,
      to,
      answered_at: new Date().toISOString(),
      status: "screening",
    };
    await this.saveCall(record);
    const stats = await this.getStats();
    stats.total_calls += 1;
    await this.saveStats(stats);
    return record;
  }

  /** Mark a call as forwarded to a human. */
  async markForwarded(callControlId: string): Promise<CallRecord | null> {
    const updated = await this.updateCall(callControlId, { status: "forwarded" });
    if (updated) {
      const stats = await this.getStats();
      stats.forwarded += 1;
      await this.saveStats(stats);
    }
    return updated;
  }

  /** Mark a call as blocked (robocall detected). */
  async markBlocked(
    callControlId: string,
    verdict: string,
    confidence: number,
    reason: string,
    callerNumber: string,
  ): Promise<CallRecord | null> {
    const updated = await this.updateCall(callControlId, {
      status: "blocked",
      verdict: verdict as CallRecord["verdict"],
      confidence,
      reason,
    });
    if (updated) {
      const stats = await this.getStats();
      stats.blocked += 1;
      // Add caller to blocklist if high confidence
      if (confidence >= 0.85 && !stats.blocklist.includes(callerNumber)) {
        stats.blocklist.push(callerNumber);
      }
      await this.saveStats(stats);
    }
    return updated;
  }

  /** Mark a call as hung up (caller ended or timeout). */
  async markHungup(callControlId: string): Promise<CallRecord | null> {
    return this.updateCall(callControlId, { status: "hungup" });
  }

  /** Store the transcript for a call. */
  async setTranscript(
    callControlId: string,
    transcript: string,
  ): Promise<CallRecord | null> {
    return this.updateCall(callControlId, { transcript });
  }

  /** Check if a caller number is on the blocklist. */
  async isBlocklisted(callerNumber: string): Promise<boolean> {
    const stats = await this.getStats();
    return stats.blocklist.includes(callerNumber);
  }

  /** Get recent calls. */
  async listCalls(limit = 20): Promise<CallRecord[]> {
    const calls = await this.getCalls();
    return calls.slice(0, limit);
  }

  /** Get cumulative stats. */
  async getCallStats(): Promise<Stats> {
    return this.getStats();
  }

  /** Clear the blocklist (admin action). */
  async clearBlocklist(): Promise<Stats> {
    const stats = await this.getStats();
    stats.blocklist = [];
    await this.saveStats(stats);
    return stats;
  }
}
