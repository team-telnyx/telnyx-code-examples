import { Agent } from "@telnyx/edge-runtime";
import type { SqlBindValue } from "@telnyx/edge-runtime";
import { randomBytes } from "node:crypto";
import type { Call, Env } from "./types.js";

/**
 * TenantVoiceActor — one Stateful Actor instance PER TENANT.
 *
 * Addressed by idFromName(tenant_id), so each tenant gets isolated call state.
 * Storage is per-actor (ctx.storage.sql is scoped to the actor instance), so
 * two tenants cannot read each other's calls.
 */
export class TenantVoiceActor extends Agent<Env, { tenant_id: string | null }> {
  protected override initialState(): { tenant_id: string | null } {
    return { tenant_id: null };
  }

  private sql = () => this.ctx.storage.sql as unknown as {
    exec<T>(query: string, ...bindings: SqlBindValue[]): Iterable<T> & { toArray(): T[] };
  };

  private fetchAll<T>(query: string, ...bindings: SqlBindValue[]): T[] {
    const cursor = this.sql().exec<T>(query, ...bindings);
    const out: T[] = [];
    for (const row of cursor) out.push(row);
    return out;
  }

  private fetchOne<T>(query: string, ...bindings: SqlBindValue[]): T | null {
    const cursor = this.sql().exec<T>(query, ...bindings);
    for (const row of cursor) return row;
    return null;
  }

  private exec(query: string, ...bindings: SqlBindValue[]): void {
    const cursor = this.sql().exec<unknown>(query, ...bindings);
    void cursor.toArray();
  }

  private ensureSchema(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id                TEXT PRIMARY KEY,
        tenant_id         TEXT NOT NULL,
        call_control_id   TEXT,
        from_number       TEXT NOT NULL,
        to_number         TEXT NOT NULL,
        direction         TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'queued',
        started_at        INTEGER NOT NULL,
        answered_at       INTEGER,
        ended_at          INTEGER,
        duration_seconds  INTEGER,
        failure_reason    TEXT
      );
      CREATE INDEX IF NOT EXISTS calls_by_status ON calls(status);
    `);
  }

  async startCall(args: {
    tenant_id: string;
    from_number: string;
    to_number: string;
  }): Promise<Call> {
    this.ensureSchema();

    const activeRow = this.fetchOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM calls WHERE status IN ('queued','ringing','answered');`,
    );

    const id = `call_${Date.now()}_${randomBytes(3).toString("hex")}`;
    const now = Date.now();
    const row: Call = {
      id,
      tenant_id: args.tenant_id,
      call_control_id: null,
      from_number: args.from_number,
      to_number: args.to_number,
      direction: "outbound",
      status: "queued",
      started_at: now,
      answered_at: null,
      ended_at: null,
      duration_seconds: null,
      failure_reason: null,
    };
    this.exec(
      `INSERT INTO calls
         (id, tenant_id, call_control_id, from_number, to_number, direction, status,
          started_at, answered_at, ended_at, duration_seconds, failure_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      row.id, row.tenant_id, row.call_control_id, row.from_number, row.to_number,
      row.direction, row.status, row.started_at, row.answered_at, row.ended_at,
      row.duration_seconds, row.failure_reason,
    );

    void activeRow;
    return row;
  }

  async getCall(id: string): Promise<Call | null> {
    this.ensureSchema();
    return this.fetchOne<Call>(`SELECT * FROM calls WHERE id = ?;`, id);
  }

  async listCalls(): Promise<Call[]> {
    this.ensureSchema();
    return this.fetchAll<Call>(
      `SELECT * FROM calls ORDER BY started_at DESC LIMIT 200;`,
    );
  }

  async hangup(id: string): Promise<Call | null> {
    this.ensureSchema();
    const existing = this.fetchOne<Call>(`SELECT * FROM calls WHERE id = ?;`, id);
    if (!existing) return null;
    if (existing.status === "completed" || existing.status === "failed") {
      return existing;
    }
    const now = Date.now();
    const duration = Math.max(
      0,
      Math.floor((now - existing.started_at) / 1000),
    );
    this.exec(
      `UPDATE calls
         SET status = 'completed', ended_at = ?, duration_seconds = ?
       WHERE id = ?;`,
      now, duration, id,
    );
    return this.getCall(id);
  }

  async activeCount(): Promise<number> {
    this.ensureSchema();
    const row = this.fetchOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM calls WHERE status IN ('queued','ringing','answered');`,
    );
    return row?.n ?? 0;
  }
}
