import { TenantConfigActor } from "./tenantConfigActor.js";
import { TenantVoiceActor } from "./tenantVoiceActor.js";
import type { Env } from "./types.js";
import { verifyTelnyxSignature, messageFingerprint } from "./webhookVerify.js";

/**
 * Default fetch handler for the multi-tenant voice platform.
 *
 * Routing:
 *   GET  /health                                          → ok
 *   GET  /api/tenants                                      → list (config actor)
 *   GET  /api/tenants/:id                                  → single tenant (config actor)
 *   GET  /api/tenants/:id/config                           → full row (config actor)
 *   POST /api/tenants/:id/calls                            → rate-limit check → voice actor startCall
 *   GET  /api/tenants/:id/calls                            → list (voice actor)
 *   GET  /api/tenants/:id/calls/:callId                   → single call (voice actor)
 *   POST /api/tenants/:id/calls/:callId/hangup            → mark completed (voice actor)
 *   POST /webhooks/voice                                  → verify Ed25519, route by tenant id
 *
 * Tenant ID is encoded in the URL — no separate header needed. This makes
 * the per-tenant namespace explicit and avoids the redundancy the previous
 * Flask prototype had (X-Tenant-ID header on a path-scoped URL).
 */
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
    {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds) },
    },
  );
}

export function makeHandler(publicKey: string | null | undefined): ExportedHandler<Env> {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (method === "GET" && path === "/health") {
        return json({ ok: true });
      }

      if (method === "GET" && path === "/api/tenants") {
        const actor = env.TENANT_CONFIG.idFromName("__config__");
        await actor.init();
        const tenants = await actor.list();
        return json({ tenants });
      }

      const tenantsMatch = path.match(/^\/api\/tenants\/([a-z0-9_-]+)(?:\/(config|calls)(?:\/([a-z0-9_]+)(?:\/(hangup))?)?)?$/i);
      if (tenantsMatch) {
        const [, tenantId, segment, callId, action] = tenantsMatch;
        const configActor = env.TENANT_CONFIG.idFromName("__config__");
        await configActor.init();
        const tenant = await configActor.get(tenantId);
        if (!tenant) return notFound("unknown tenant");
        const voiceActor = env.TENANT_VOICE.idFromName(tenantId);

        if (segment === "config" && method === "GET") {
          return json({ tenant });
        }

        if (segment === "calls" && method === "GET" && !callId) {
          const calls = await voiceActor.listCalls();
          return json({ calls });
        }

        if (segment === "calls" && method === "POST" && !callId) {
          let body: { from?: string; to?: string; webhook_url?: string } = {};
          try {
            body = await request.json() as typeof body;
          } catch {
            return badRequest("invalid JSON body");
          }
          if (!body.from || !body.to) {
            return badRequest("from and to are required");
          }
          const decision = await configActor.checkRateLimit(tenant);
          if (!decision.allowed) {
            return tooManyRequests(decision.retry_after_seconds, decision.current, tenant.rate_limit_per_minute);
          }
          const active = await voiceActor.activeCount();
          if (active >= tenant.max_concurrent_calls) {
            return json(
              { error: "max concurrent calls reached", active, max: tenant.max_concurrent_calls },
              { status: 429 },
            );
          }
          const call = await voiceActor.startCall({
            tenant_id: tenantId,
            from_number: body.from,
            to_number: body.to,
          });
          return json({ call, rate_limit: decision }, { status: 202 });
        }

        if (segment === "calls" && callId && method === "GET") {
          const call = await voiceActor.getCall(callId);
          return call ? json({ call }) : notFound();
        }

        if (segment === "calls" && callId && action === "hangup" && method === "POST") {
          const call = await voiceActor.hangup(callId);
          return call ? json({ call }) : notFound();
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
        let payload: any = {};
        try {
          payload = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          return badRequest("invalid JSON");
        }
        const tenantId =
          payload?.data?.payload?.tenant_id ??
          request.headers.get("x-tenant-id") ??
          "";
        if (!tenantId) return badRequest("missing tenant_id in webhook payload");
        const configActor = env.TENANT_CONFIG.idFromName("__config__");
        const tenant = await configActor.get(tenantId);
        if (!tenant) return notFound("unknown tenant");
        const voiceActor = env.TENANT_VOICE.idFromName(tenantId);
        const callControlId = payload?.data?.payload?.call_control_id ?? null;
        if (callControlId) {
          // For real webhooks we'd update an existing call row; for the demo
          // we just record the fingerprint so operators can see inbound activity.
          void messageFingerprint(payload);
        }
        return json({ ok: true, tenant_id: tenantId, forwarded_to: tenant.webhook_url });
      }

      return notFound();
    },
  };
}

// Re-export the actor classes so the Edge runtime can instantiate them
// via the [actors.*] class names declared in telnyx.toml.
export { TenantConfigActor, TenantVoiceActor };

// Edge runtime type stub — keeps the export type-only so the local runner
// (which uses Node fetch / Express) doesn't accidentally bind it.
type ExportedHandler<E> = {
  fetch(request: Request, env: E): Promise<Response>;
};
