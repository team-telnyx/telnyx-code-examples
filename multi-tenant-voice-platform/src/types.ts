/**
 * Shared types for the multi-tenant voice platform.
 *
 * Three persistence layers, all backed by Edge Compute primitives:
 *   - SQL DB  → shared tenants table (config + limits)
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

export type CallStatus = "queued" | "ringing" | "answered" | "completed" | "failed";

export type Call = {
  id: string;
  tenant_id: string;
  call_control_id: string | null;
  from_number: string;
  to_number: string;
  direction: "outbound";
  status: CallStatus;
  started_at: number;
  answered_at: number | null;
  ended_at: number | null;
  duration_seconds: number | null;
  failure_reason: string | null;
};

/** Dashboard snapshot — the entire UI state in one response. */
export type TenantDashboard = {
  tenant_id: string;
  name: string;
  rate_limit_per_minute: number;
  max_concurrent_calls: number;
  /** How many calls have been placed against this tenant in the current minute. */
  rate_limit: { used: number; limit: number };
  /** Calls currently in queued/ringing/answered state. */
  active_calls: number;
  /** Newest first, capped. */
  recent_calls: Call[];
};

export type DashboardSnapshot = {
  tenants: TenantDashboard[];
};

export type DashboardUpdate = {
  reason: "call_placed" | "call_updated" | "call_completed";
  tenant_id: string;
  at: number;
};

/** Telnyx `call.*` webhook payload — fields we read. */
export type CallWebhookPayload = {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: {
      call_control_id?: string;
      call_leg_id?: string;
      call_session_id?: string;
      from?: { phone_number?: string };
      to?: { phone_number?: string };
      direction?: string;
      hangup_cause?: string;
    };
  };
};

/** Bound on Edge — see telnyx.toml. Minimal for our local runner. */
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
        call_control_id?: string | null;
      }): Promise<Call>;
      getCall(id: string): Promise<Call | null>;
      listCalls(limit?: number): Promise<Call[]>;
      hangup(id: string): Promise<Call | null>;
      activeCount(): Promise<number>;
      rateLimitUsedThisMinute(tenantId: string): Promise<number>;
    };
  };
  LIVE_MODE?: boolean;
  TELNYX_API_KEY?: string;
  DEMO_MODE?: boolean;
};
