import { Agent } from "@telnyx/edge-runtime";
import type { Env } from "./types.js";
import {
  initSchema,
  listTenants,
  getTenant,
  checkRateLimit,
  resetRateLimit,
  type TenantConfigCtx,
} from "./tenantConfigLogic.js";
import type { Tenant } from "./types.js";

/**
 * Thin Agent wrapper so the Edge runtime can instantiate this actor via
 * `telnyx.toml`'s [actors.tenant_config] class name. All real logic lives
 * in `tenantConfigLogic.ts` so it can be tested without instantiating Agent
 * (the base class wires storage/state via super() which is brittle to mock).
 */
export class TenantConfigActor extends Agent<Env, { seeded: boolean; rate_limits: { windows: Record<string, { window_start: number; count: number }> } }> {
  protected override initialState() {
    return { seeded: false, rate_limits: { windows: {} } };
  }

  init(): Promise<void> { return initSchema(this as unknown as TenantConfigCtx); }
  list(): Promise<Tenant[]> { return listTenants(this as unknown as TenantConfigCtx); }
  get(id: string): Promise<Tenant | null> { return getTenant(this as unknown as TenantConfigCtx, id); }
  checkRateLimit(tenant: Tenant): Promise<{ allowed: boolean; current: number; retry_after_seconds: number }> {
    return checkRateLimit(this as unknown as TenantConfigCtx, tenant);
  }
  resetRateLimit(tenantId: string): Promise<void> { return resetRateLimit(this as unknown as TenantConfigCtx, tenantId); }
}
