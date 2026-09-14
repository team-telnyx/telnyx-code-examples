import type { SqlBindValue } from "@telnyx/edge-runtime";
import type { Env, Tenant } from "./types.js";

/**
 * Pure functions for the shared tenants table and rate-limit logic.
 *
 * These don't depend on the Agent base class — they take an explicit ctx
 * (storage + setState/getState) so they can be unit-tested with a plain
 * better-sqlite3 DB and a plain Map-backed state object. The
 * TenantConfigActor class is a thin wrapper that wires `this.ctx`,
 * `this.setState`, and `this.getState` into these functions.
 */

export type TenantConfigCtx = {
  readonly storage: {
    sql: {
      exec<T>(query: string, ...bindings: SqlBindValue[]): Iterable<T> & { toArray(): T[] };
    };
  };
  getState<T>(): Promise<T>;
  setState<T>(state: T): Promise<void>;
};

export type RateLimitState = {
  /** `${tenantId}` → { window_start_unix_sec, count } */
  windows: Record<string, { window_start: number; count: number }>;
};

function fetchAll<T>(
  ctx: TenantConfigCtx,
  query: string,
  ...bindings: SqlBindValue[]
): T[] {
  const cursor = ctx.storage.sql.exec<T>(query, ...bindings);
  const out: T[] = [];
  for (const row of cursor) out.push(row);
  return out;
}

function fetchOne<T>(
  ctx: TenantConfigCtx,
  query: string,
  ...bindings: SqlBindValue[]
): T | null {
  const cursor = ctx.storage.sql.exec<T>(query, ...bindings);
  for (const row of cursor) return row;
  return null;
}

function exec(ctx: TenantConfigCtx, query: string, ...bindings: SqlBindValue[]): void {
  const cursor = ctx.storage.sql.exec<unknown>(query, ...bindings);
  void cursor.toArray();
}

export async function initSchema(ctx: TenantConfigCtx): Promise<void> {
  exec(ctx, `
    CREATE TABLE IF NOT EXISTS tenants (
      id                       TEXT PRIMARY KEY,
      name                     TEXT NOT NULL,
      rate_limit_per_minute    INTEGER NOT NULL DEFAULT 60,
      max_concurrent_calls     INTEGER NOT NULL DEFAULT 10,
      default_voice_profile_id TEXT NOT NULL DEFAULT '',
      webhook_url              TEXT NOT NULL DEFAULT '',
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL
    );
  `);

  const state = await ctx.getState<{ seeded: boolean; rate_limits: RateLimitState }>();
  if (state.seeded) return;
  const now = Date.now();

  const seed: Array<Omit<Tenant, "created_at" | "updated_at">> = [
    {
      id: "tenant_a",
      name: process.env.TENANT_A_NAME ?? "Tenant A",
      rate_limit_per_minute: 10,
      max_concurrent_calls: 5,
      default_voice_profile_id: process.env.TENANT_A_VOICE_PROFILE_ID ?? "",
      webhook_url: process.env.TENANT_A_WEBHOOK_URL ?? "",
    },
    {
      id: "tenant_b",
      name: process.env.TENANT_B_NAME ?? "Tenant B",
      rate_limit_per_minute: 5,
      max_concurrent_calls: 3,
      default_voice_profile_id: process.env.TENANT_B_VOICE_PROFILE_ID ?? "",
      webhook_url: process.env.TENANT_B_WEBHOOK_URL ?? "",
    },
  ];

  for (const t of seed) {
    exec(ctx,
      `INSERT OR IGNORE INTO tenants
         (id, name, rate_limit_per_minute, max_concurrent_calls,
          default_voice_profile_id, webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      t.id, t.name, t.rate_limit_per_minute, t.max_concurrent_calls,
      t.default_voice_profile_id, t.webhook_url, now, now,
    );
  }
  await ctx.setState({ ...state, seeded: true });
}

export async function listTenants(ctx: TenantConfigCtx): Promise<Tenant[]> {
  await initSchema(ctx);
  return fetchAll<Tenant>(ctx, `SELECT * FROM tenants ORDER BY id ASC;`);
}

export async function getTenant(ctx: TenantConfigCtx, id: string): Promise<Tenant | null> {
  await initSchema(ctx);
  return fetchOne<Tenant>(ctx, `SELECT * FROM tenants WHERE id = ?;`, id);
}

export async function checkRateLimit(
  ctx: TenantConfigCtx,
  tenant: Tenant,
): Promise<{ allowed: boolean; current: number; retry_after_seconds: number }> {
  await initSchema(ctx);
  const state = await ctx.getState<{ seeded: boolean; rate_limits: RateLimitState }>();
  const windows = { ...state.rate_limits.windows };
  const nowSec = Math.floor(Date.now() / 1000);
  const existing = windows[tenant.id];

  if (!existing || nowSec - existing.window_start >= 60) {
    const next = { window_start: nowSec, count: 1 };
    windows[tenant.id] = next;
    await ctx.setState({ ...state, rate_limits: { windows } });
    return { allowed: true, current: 1, retry_after_seconds: 0 };
  }

  const next = { window_start: existing.window_start, count: existing.count + 1 };
  windows[tenant.id] = next;
  await ctx.setState({ ...state, rate_limits: { windows } });
  const allowed = next.count <= tenant.rate_limit_per_minute;
  const retry_after_seconds = allowed ? 0 : 60 - (nowSec - existing.window_start);
  return { allowed, current: next.count, retry_after_seconds };
}

export async function resetRateLimit(
  ctx: TenantConfigCtx,
  tenantId: string,
): Promise<void> {
  const state = await ctx.getState<{ seeded: boolean; rate_limits: RateLimitState }>();
  const windows = { ...state.rate_limits.windows };
  delete windows[tenantId];
  await ctx.setState({ ...state, rate_limits: { windows } });
}

export type { Env, Tenant };
