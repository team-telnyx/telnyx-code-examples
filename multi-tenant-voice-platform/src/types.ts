/**
 * Shared types for the multi-tenant voice platform.
 *
 * Three persistence layers, all backed by Edge Compute primitives:
 *   - SQL DB  → shared tenants table (config + limits)
 *   - KV      → per-tenant rate-limit counters
 *   - Actor   → per-tenant call state (one StatefulActor instance per tenant)
 */

export type Tenant = {
  id: string;
  name: string;
  rate_limit_per_minute: number;
  max_concurrent_calls: number;
  default_voice_profile_id: string;
  webhook_url: string;
  created_at: number;
  updated_at: number;
};

export type Call = {
  id: string;
  tenant_id: string;
  call_control_id: string | null;
  from_number: string;
  to_number: string;
  direction: "inbound" | "outbound";
  status: "queued" | "ringing" | "answered" | "completed" | "failed";
  started_at: number;
  answered_at: number | null;
  ended_at: number | null;
  duration_seconds: number | null;
  /** Failure reason if status='failed'. */
  failure_reason: string | null;
};

export type RateLimitDecision = {
  allowed: boolean;
  current: number;
  limit: number;
  retry_after_seconds: number;
  window_started_at: number;
};

/** Bound on Edge — see telnyx.toml. */
export type Env = {
  TENANT_CONFIG: {
    idFromName(name: string): {
      init(): Promise<void>;
      list(): Promise<Tenant[]>;
      get(id: string): Promise<Tenant | null>;
      checkRateLimit(tenant: Tenant): Promise<{ allowed: boolean; current: number; retry_after_seconds: number }>;
    };
  };
  TENANT_VOICE: {
    idFromName(name: string): {
      startCall(args: {
        tenant_id: string;
        from_number: string;
        to_number: string;
      }): Promise<Call>;
      getCall(id: string): Promise<Call | null>;
      listCalls(): Promise<Call[]>;
      hangup(id: string): Promise<Call | null>;
      activeCount(): Promise<number>;
    };
  };
  TELNYX?: {
    calls?: {
      create?(args: Record<string, unknown>): Promise<unknown>;
    };
  };
};

export const KV_RATE_KEY = (tenantId: string) => `tenant:${tenantId}:rate:minute`;
export const KV_WINDOW_KEY = (tenantId: string) => `tenant:${tenantId}:rate:window`;
