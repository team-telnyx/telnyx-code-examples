import { verifyTelnyxSignature } from "./webhookVerify.js";
import { dashboardHtml } from "./dashboard.js";
import type {
  Call,
  CallWebhookPayload,
  DashboardSnapshot,
  Tenant,
  TenantDashboard,
} from "./types.js";

/**
 * Default fetch handler for the multi-tenant voice platform.
 *
 * Routes:
 *   GET  /                                                → dashboard HTML
 *   GET  /health                                          → ok
 *   GET  /api/dashboard                                   → snapshot for dashboard
 *   GET  /api/tenants                                      → list (config actor)
 *   GET  /api/tenants/:id                                  → single tenant
 *   GET  /api/tenants/:id/config                           → full row
 *   POST /api/tenants/:id/calls                            → rate-limit check → voice actor startCall
 *   GET  /api/tenants/:id/calls                            → list (voice actor)
 *   GET  /api/tenants/:id/calls/:callId                   → single call
 *   POST /api/tenants/:id/calls/:callId/hangup            → mark completed
 *   POST /webhooks/voice                                  → verify Ed25519, route by call_control_id
 *   GET  /api/events                                      → SSE: dashboard updates
 *
 * Tenant ID is encoded in the URL — no separate header needed. This makes
 * the per-tenant namespace explicit and avoids the redundancy the previous
 * Flask prototype had.
 */

export type Emit = (event: { kind: "placed" | "updated" | "completed"; call: Call }) => void;

export type PlaceCallContext = {
  voice: {
    idFromName(tenantId: string): {
      startCall: (
        args: { tenant_id: string; from_number: string; to_number: string; call_control_id?: string | null },
        emit: Emit,
      ) => Promise<Call>;
      getCall(id: string): Promise<Call | null>;
      getCallByControlId(id: string): Promise<Call | null>;
      listCalls(limit?: number): Promise<Call[]>;
      updateCallStatus(args: { id: string; status: Call["status"]; at?: number }, emit: Emit): Promise<Call | null>;
      hangup(id: string): Promise<Call | null>;
      activeCount(): Promise<number>;
      rateLimitUsedThisMinute(tenantId: string): Promise<number>;
    };
  };
  placeLiveCall?: (args: { tenant: Tenant; from_number: string; to_number: string }) => Promise<{ call_control_id: string }>;
  simulateProgress?: (call: Call) => void;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function badRequest(error: string): Response {
  return json({ error }, { status: 400 });
}

function notFound(error = "not found"): Response {
  return json({ error }, { status: 404 });
}

function tooManyRequests(retryAfterSeconds: number, current: number, limit: number): Response {
  return json(
    { error: "rate limit exceeded", current, limit, retry_after_seconds: retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

const PLACE_EMIT: Emit = () => {};

export function makeHandler(deps: {
  publicKey: string | null | undefined;
  listTenants: () => Promise<Tenant[]>;
  getTenant: (id: string) => Promise<Tenant | null>;
  checkRateLimit: (tenant: Tenant) => Promise<{ allowed: boolean; current: number; retry_after_seconds: number }>;
  resetRateLimit: (tenantId: string) => Promise<void>;
  rateLimitUsedThisMinute: (tenantId: string) => Promise<number>;
  ctx: PlaceCallContext;
  demoMode: boolean;
  apiBase: string;
}): { fetch: (request: Request) => Promise<Response> } {
  const {
    publicKey,
    listTenants,
    getTenant,
    checkRateLimit,
    rateLimitUsedThisMinute,
    ctx,
    demoMode,
    apiBase,
  } = deps;

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (method === "GET" && path === "/") {
        return new Response(
          dashboardHtml({ demoMode, apiBase }),
          { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
        );
      }

      if (method === "GET" && path === "/health") {
        return json({ ok: true, demoMode });
      }

      if (method === "GET" && path === "/api/dashboard") {
        const tenants = await listTenants();
        const dashboards: TenantDashboard[] = [];
        for (const t of tenants) {
          const voice = ctx.voice.idFromName(t.id);
          const recent = await voice.listCalls(50);
          const used = await rateLimitUsedThisMinute(t.id);
          dashboards.push({
            tenant_id: t.id,
            name: t.name,
            rate_limit_per_minute: t.rate_limit_per_minute,
            max_concurrent_calls: t.max_concurrent_calls,
            rate_limit: { used, limit: t.rate_limit_per_minute },
            active_calls: recent.filter((c) => c.status === "queued" || c.status === "ringing" || c.status === "answered").length,
            recent_calls: recent.slice(0, 10),
          });
        }
        const snapshot: DashboardSnapshot = { tenants: dashboards };
        return json(snapshot);
      }

      if (method === "GET" && path === "/api/tenants") {
        const tenants = await listTenants();
        return json({ tenants });
      }

      const tenantsMatch = path.match(/^\/api\/tenants\/([a-z0-9_-]+)(?:\/(config|calls)(?:\/([a-z0-9_]+)(?:\/(hangup))?)?)?$/i);
      if (tenantsMatch) {
        const [, tenantId, segment, callId, action] = tenantsMatch;
        const tenant = await getTenant(tenantId);
        if (!tenant) return notFound("unknown tenant");

        if (segment === "config" && method === "GET") {
          return json({ tenant });
        }

        if (segment === "calls" && method === "GET" && !callId) {
          const voice = ctx.voice.idFromName(tenantId);
          const calls = await voice.listCalls(200);
          return json({ calls });
        }

        if (segment === "calls" && method === "POST" && !callId) {
          let body: { from?: string; to?: string } = {};
          try {
            body = await request.json() as typeof body;
          } catch {
            return badRequest("invalid JSON body");
          }
          if (!body.from || !body.to) {
            return badRequest("from and to are required");
          }
          const decision = await checkRateLimit(tenant);
          if (!decision.allowed) {
            return tooManyRequests(decision.retry_after_seconds, decision.current, tenant.rate_limit_per_minute);
          }
          const voice = ctx.voice.idFromName(tenantId);
          const recent = await voice.listCalls(200);
          const active = recent.filter((c) => c.status === "queued" || c.status === "ringing" || c.status === "answered").length;
          if (active >= tenant.max_concurrent_calls) {
            return json(
              { error: "max concurrent calls reached", active, max: tenant.max_concurrent_calls },
              { status: 429 },
            );
          }

          let call_control_id: string | null = null;
          if (!demoMode && ctx.placeLiveCall) {
            try {
              const live = await ctx.placeLiveCall({ tenant, from_number: body.from, to_number: body.to });
              call_control_id = live.call_control_id;
            } catch (err) {
              return json({ error: `Telnyx API error: ${(err as Error).message ?? err}` }, { status: 502 });
            }
          } else if (!demoMode) {
            return json({ error: "live mode requires TELNYX_API_KEY and tenant voice profile IDs" }, { status: 500 });
          }

          const call = await voice.startCall(
            {
              tenant_id: tenantId,
              from_number: body.from,
              to_number: body.to,
              call_control_id,
            },
            (event) => {
              void event;
            },
          );

          if (demoMode && ctx.simulateProgress) {
            ctx.simulateProgress(call);
          }

          return json({ call, rate_limit: decision }, { status: 202 });
        }

        if (segment === "calls" && callId && method === "GET") {
          const voice = ctx.voice.idFromName(tenantId);
          const all = await voice.listCalls(200);
          const call = all.find((c) => c.id === callId) ?? null;
          return call ? json({ call }) : notFound();
        }

        if (segment === "calls" && callId && action === "hangup" && method === "POST") {
          const voice = ctx.voice.idFromName(tenantId);
          const all = await voice.listCalls(200);
          const call = all.find((c) => c.id === callId) ?? null;
          if (!call) return notFound();
          if (call.status === "completed" || call.status === "failed") {
            return json({ call });
          }
          const updated = await voice.updateCallStatus({ id: callId, status: "completed" }, PLACE_EMIT);
          return updated ? json({ call: updated }) : notFound();
        }
      }

      if (method === "POST" && path === "/webhooks/voice") {
        const sig = request.headers.get("telnyx-signature-ed25519");
        const ts = request.headers.get("telnyx-timestamp");
        const raw = Buffer.from(await request.arrayBuffer());
        const verification = verifyTelnyxSignature({
          rawBody: raw,
          signature: sig,
          timestamp: ts,
          publicKeyPem: publicKey,
        });
        if (!verification.ok) {
          return json({ error: "invalid signature", reason: verification.reason }, { status: 401 });
        }
        let payload: CallWebhookPayload = {};
        try {
          payload = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          return badRequest("invalid JSON");
        }
        const p = payload.data?.payload ?? {};
        const callControlId = p.call_control_id;
        if (!callControlId) return badRequest("missing call_control_id");
        const tenants = await listTenants();
        for (const t of tenants) {
          const voice = ctx.voice.idFromName(t.id);
          const call = await voice.getCallByControlId(callControlId);
          if (!call) continue;
          const eventType = payload.data?.event_type ?? "";
          if (eventType === "call.answered") {
            await voice.updateCallStatus({ id: call.id, status: "answered" }, PLACE_EMIT);
          } else if (eventType === "call.hangup") {
            await voice.updateCallStatus(
              { id: call.id, status: p.hangup_cause === "normal_clearing" ? "completed" : "failed" },
              PLACE_EMIT,
            );
          }
          return json({ ok: true, call_control_id: callControlId, tenant_id: t.id });
        }
        return json({ ok: true, ignored: "unknown call_control_id" });
      }

      return notFound();
    },
  };
}

export { type Emit as DashboardEmit };
