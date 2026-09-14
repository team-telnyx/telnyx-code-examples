import { Agent } from "@telnyx/edge-runtime";
import type { SqlBindValue } from "@telnyx/edge-runtime";
import { randomBytes } from "node:crypto";
import type { Call, Env } from "./types.js";

/**
 * Pure functions for per-tenant call state.
 *
 * Accepts an optional `emit` callback that fires on every state change —
 * the local runner wires this to the SSE bus; tests pass a no-op.
 */

export type TenantVoiceCtx = {
  readonly storage: {
    sql: {
      exec<T>(query: string, ...bindings: SqlBindValue[]): Iterable<T> & { toArray(): T[] };
    };
  };
};

export type Emit = (event: { kind: "placed" | "updated" | "completed"; call: Call }) => void;

const NOOP_EMIT: Emit = () => {};

function fetchAll<T>(
  ctx: TenantVoiceCtx,
  query: string,
  ...bindings: SqlBindValue[]
): T[] {
  const cursor = ctx.storage.sql.exec<T>(query, ...bindings);
  const out: T[] = [];
  for (const row of cursor) out.push(row);
  return out;
}

function fetchOne<T>(
  ctx: TenantVoiceCtx,
  query: string,
  ...bindings: SqlBindValue[]
): T | null {
  const cursor = ctx.storage.sql.exec<T>(query, ...bindings);
  for (const row of cursor) return row;
  return null;
}

function exec(ctx: TenantVoiceCtx, query: string, ...bindings: SqlBindValue[]): void {
  const cursor = ctx.storage.sql.exec<unknown>(query, ...bindings);
  void cursor.toArray();
}

export function ensureCallsSchema(ctx: TenantVoiceCtx): void {
  exec(ctx, `
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
    )
  `);
  exec(ctx, `CREATE INDEX IF NOT EXISTS calls_by_status ON calls(status);`);
  exec(ctx, `CREATE INDEX IF NOT EXISTS calls_by_tenant_started ON calls(tenant_id, started_at DESC);`);
}

export async function startCall(
  ctx: TenantVoiceCtx,
  args: {
    tenant_id: string;
    from_number: string;
    to_number: string;
    call_control_id?: string | null;
    started_at?: number;
  },
  emit: Emit = NOOP_EMIT,
): Promise<Call> {
  ensureCallsSchema(ctx);
  const id = `call_${args.started_at ?? Date.now()}_${randomBytes(3).toString("hex")}`;
  const now = args.started_at ?? Date.now();
  const row: Call = {
    id,
    tenant_id: args.tenant_id,
    call_control_id: args.call_control_id ?? null,
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
  exec(ctx,
    `INSERT INTO calls
       (id, tenant_id, call_control_id, from_number, to_number, direction, status,
        started_at, answered_at, ended_at, duration_seconds, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    row.id, row.tenant_id, row.call_control_id, row.from_number, row.to_number,
    row.direction, row.status, row.started_at, row.answered_at, row.ended_at,
    row.duration_seconds, row.failure_reason,
  );
  emit({ kind: "placed", call: row });
  return row;
}

export async function getCall(ctx: TenantVoiceCtx, id: string): Promise<Call | null> {
  ensureCallsSchema(ctx);
  return fetchOne<Call>(ctx, `SELECT * FROM calls WHERE id = ?;`, id);
}

export async function getCallByControlId(
  ctx: TenantVoiceCtx,
  callControlId: string,
): Promise<Call | null> {
  ensureCallsSchema(ctx);
  return fetchOne<Call>(ctx, `SELECT * FROM calls WHERE call_control_id = ?;`, callControlId);
}

export async function listCalls(ctx: TenantVoiceCtx, limit = 20): Promise<Call[]> {
  ensureCallsSchema(ctx);
  return fetchAll<Call>(ctx,
    `SELECT * FROM calls ORDER BY started_at DESC LIMIT ?;`,
    limit,
  );
}

export async function updateCallStatus(
  ctx: TenantVoiceCtx,
  args: { id: string; status: Call["status"]; at?: number },
  emit: Emit = NOOP_EMIT,
): Promise<Call | null> {
  ensureCallsSchema(ctx);
  const now = args.at ?? Date.now();
  if (args.status === "answered") {
    exec(ctx, `UPDATE calls SET status = ?, answered_at = ? WHERE id = ?;`, args.status, now, args.id);
  } else if (args.status === "completed" || args.status === "failed") {
    const existing = fetchOne<Call>(ctx, `SELECT * FROM calls WHERE id = ?;`, args.id);
    const duration = existing ? Math.max(0, Math.floor((now - existing.started_at) / 1000)) : 0;
    exec(ctx,
      `UPDATE calls SET status = ?, ended_at = ?, duration_seconds = ? WHERE id = ?;`,
      args.status, now, duration, args.id,
    );
  } else {
    exec(ctx, `UPDATE calls SET status = ? WHERE id = ?;`, args.status, args.id);
  }
  const updated = await getCall(ctx, args.id);
  if (updated) emit({ kind: updated.status === "completed" || updated.status === "failed" ? "completed" : "updated", call: updated });
  return updated;
}

export async function hangup(
  ctx: TenantVoiceCtx,
  id: string,
  emit: Emit = NOOP_EMIT,
): Promise<Call | null> {
  return updateCallStatus(ctx, { id, status: "completed" }, emit);
}

export async function activeCount(ctx: TenantVoiceCtx): Promise<number> {
  ensureCallsSchema(ctx);
  const row = fetchOne<{ n: number }>(ctx,
    `SELECT COUNT(*) AS n FROM calls WHERE status IN ('queued','ringing','answered');`,
  );
  return row?.n ?? 0;
}

export async function rateLimitUsedThisMinute(ctx: TenantVoiceCtx, tenantId: string): Promise<number> {
  ensureCallsSchema(ctx);
  const sinceMs = Date.now() - 60_000;
  const row = fetchOne<{ n: number }>(ctx,
    `SELECT COUNT(*) AS n FROM calls WHERE tenant_id = ? AND started_at >= ?;`,
    tenantId, sinceMs,
  );
  return row?.n ?? 0;
}

export async function deleteCalls(ctx: TenantVoiceCtx): Promise<void> {
  exec(ctx, `DELETE FROM calls;`);
}

/**
 * Thin Agent wrapper for the Edge runtime. Methods delegate to the pure
 * functions above; the actor adds no behavior of its own.
 */
export class TenantVoiceActor extends Agent<Env, never> {
  protected override initialState(): never {
    return undefined as never;
  }
  startCall(args: Parameters<typeof startCall>[1]): Promise<Call> {
    return startCall(this.ctx as unknown as TenantVoiceCtx, args);
  }
  getCall(id: string): Promise<Call | null> {
    return getCall(this.ctx as unknown as TenantVoiceCtx, id);
  }
  getCallByControlId(id: string): Promise<Call | null> {
    return getCallByControlId(this.ctx as unknown as TenantVoiceCtx, id);
  }
  listCalls(limit?: number): Promise<Call[]> {
    return listCalls(this.ctx as unknown as TenantVoiceCtx, limit);
  }
  updateCallStatus(args: Parameters<typeof updateCallStatus>[1]): Promise<Call | null> {
    return updateCallStatus(this.ctx as unknown as TenantVoiceCtx, args);
  }
  hangup(id: string): Promise<Call | null> {
    return hangup(this.ctx as unknown as TenantVoiceCtx, id);
  }
  activeCount(): Promise<number> {
    return activeCount(this.ctx as unknown as TenantVoiceCtx);
  }
  rateLimitUsedThisMinute(tenantId: string): Promise<number> {
    return rateLimitUsedThisMinute(this.ctx as unknown as TenantVoiceCtx, tenantId);
  }
  deleteCalls(): Promise<void> {
    return deleteCalls(this.ctx as unknown as TenantVoiceCtx);
  }
}
