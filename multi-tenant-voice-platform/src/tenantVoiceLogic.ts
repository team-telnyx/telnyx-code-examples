import { Agent } from "@telnyx/edge-runtime";
import type { SqlBindValue } from "@telnyx/edge-runtime";
import { randomBytes } from "node:crypto";
import type { Call, Env } from "./types.js";

/**
 * Pure functions for per-tenant call state.
 *
 * Like tenantConfigLogic, these don't depend on the Agent base class — they
 * take a plain ctx with just the SQL primitive, so they can be unit-tested
 * with a better-sqlite3 DB. The TenantVoiceActor class is a thin wrapper
 * for Edge deployment.
 */

export type TenantVoiceCtx = {
  readonly storage: {
    sql: {
      exec<T>(query: string, ...bindings: SqlBindValue[]): Iterable<T> & { toArray(): T[] };
    };
  };
};

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
}

export async function startCall(
  ctx: TenantVoiceCtx,
  args: { tenant_id: string; from_number: string; to_number: string },
): Promise<Call> {
  ensureCallsSchema(ctx);
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
  exec(ctx,
    `INSERT INTO calls
       (id, tenant_id, call_control_id, from_number, to_number, direction, status,
        started_at, answered_at, ended_at, duration_seconds, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    row.id, row.tenant_id, row.call_control_id, row.from_number, row.to_number,
    row.direction, row.status, row.started_at, row.answered_at, row.ended_at,
    row.duration_seconds, row.failure_reason,
  );
  return row;
}

export async function getCall(ctx: TenantVoiceCtx, id: string): Promise<Call | null> {
  ensureCallsSchema(ctx);
  return fetchOne<Call>(ctx, `SELECT * FROM calls WHERE id = ?;`, id);
}

export async function listCalls(ctx: TenantVoiceCtx): Promise<Call[]> {
  ensureCallsSchema(ctx);
  return fetchAll<Call>(ctx,
    `SELECT * FROM calls ORDER BY started_at DESC LIMIT 200;`,
  );
}

export async function hangup(ctx: TenantVoiceCtx, id: string): Promise<Call | null> {
  ensureCallsSchema(ctx);
  const existing = fetchOne<Call>(ctx, `SELECT * FROM calls WHERE id = ?;`, id);
  if (!existing) return null;
  if (existing.status === "completed" || existing.status === "failed") {
    return existing;
  }
  const now = Date.now();
  const duration = Math.max(
    0,
    Math.floor((now - existing.started_at) / 1000),
  );
  exec(ctx,
    `UPDATE calls
       SET status = 'completed', ended_at = ?, duration_seconds = ?
     WHERE id = ?;`,
    now, duration, id,
  );
  return getCall(ctx, id);
}

export async function activeCount(ctx: TenantVoiceCtx): Promise<number> {
  ensureCallsSchema(ctx);
  const row = fetchOne<{ n: number }>(ctx,
    `SELECT COUNT(*) AS n FROM calls WHERE status IN ('queued','ringing','answered');`,
  );
  return row?.n ?? 0;
}

/**
 * Thin Agent wrappers so the Edge runtime can instantiate the actor via
 * `telnyx.toml`'s [actors.*] class names. Methods delegate to the pure
 * functions above; the actor adds nothing — no setState, no alarm, no
 * queue. The runtime still wires ctx/env via super(), which the pure
 * functions don't need.
 */
export class TenantVoiceActor extends Agent<Env, never> {
  protected override initialState(): never {
    return undefined as never;
  }
  startCall(args: { tenant_id: string; from_number: string; to_number: string }): Promise<Call> {
    return startCall(this.ctx as unknown as TenantVoiceCtx, args);
  }
  getCall(id: string): Promise<Call | null> {
    return getCall(this.ctx as unknown as TenantVoiceCtx, id);
  }
  listCalls(): Promise<Call[]> {
    return listCalls(this.ctx as unknown as TenantVoiceCtx);
  }
  hangup(id: string): Promise<Call | null> {
    return hangup(this.ctx as unknown as TenantVoiceCtx, id);
  }
  activeCount(): Promise<number> {
    return activeCount(this.ctx as unknown as TenantVoiceCtx);
  }
}
