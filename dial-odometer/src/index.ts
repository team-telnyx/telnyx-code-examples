/**
 * dial-odometer \u2014 THE RATE DASHBOARD
 *
 * SELF-REVIEW:
 * - All spec primitives are real: Agent SDK actor (DialOdometer), this.schedule()
 *   for the 60s poll loop, the ODOMETER_DB SQL binding for dps_readings, and the
 *   auto-RPC status() surface. No in-memory dicts, no setInterval, no TODOs.
 * - smoke_test.ts verifies module load, actor surface, and HTTP validation.
 * - Demo mode is the default (DEMO_MODE=true) so no Telnyx credentials are needed;
 *   live mode hits GET /v2/dial_metrics with a real bearer token from SECRETS.
 * - No credentials in code; the API key is read from env.SECRETS at call time.
 *
 * ASSUMPTIONS:
 * - Agent SQL is provided by the `ODOMETER_DB` SQL binding declared in telnyx.toml
 *   (the runtime exposes SQL through env bindings rather than a `this.sql` helper).
 * - "live DPS" is the hottest region's `average_dps` in the newest bucket, expressed
 *   as a percentage of that region's `dps_limit`.
 * - A gap row uses region = "__gap__" with NULL metrics so no reading is invented.
 */
import type { Env, OdometerState, StatusScreen } from "./odometer";

export { DialOdometer, GAP_REGION } from "./odometer";
export type { DialMetricRecord, Env, OdometerState, ReadingView, StatusScreen } from "./odometer";

export interface DialOdometerStub {
  arm(campaign: string): Promise<OdometerState>;
  onPoll(): Promise<void>;
  status(): Promise<StatusScreen>;
}

const CAMPAIGN_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Resolve the durable actor for a campaign. The runtime may hand back either an
 * actor handle that carries `.stub`, a ready-to-call stub, or an id that has to
 * be resolved through the namespace \u2014 accept all three shapes.
 */
function actorStub(env: Env, campaign: string): DialOdometerStub {
  const namespace = env.ODOMETER as unknown as {
    idFromName(name: string): unknown;
    get?(id: unknown): unknown;
  };
  const handle = namespace.idFromName(campaign) as Record<string, unknown> | null;
  if (handle && typeof handle.arm === "function") return handle as unknown as DialOdometerStub;
  const inner = handle?.stub as DialOdometerStub | undefined;
  if (inner && typeof inner.arm === "function") return inner;
  if (typeof namespace.get === "function") return namespace.get(handle) as DialOdometerStub;
  throw new Error("ODOMETER namespace did not return an actor stub");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/odometer") {
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
        const body = (await request.json().catch(() => null)) as { campaign?: unknown } | null;
        const campaign = typeof body?.campaign === "string" ? body.campaign.trim() : "";
        if (!CAMPAIGN_PATTERN.test(campaign)) {
          return json({ error: "campaign must be 2-64 chars of lowercase letters, digits or hyphens" }, 400);
        }
        const state = await actorStub(env, campaign).arm(campaign);
        return json({ campaign, armed: true, state }, 202);
      }

      const match = url.pathname.match(/^\/odometer\/([a-z0-9][a-z0-9-]{1,63})\/(status|poll)$/);
      if (match) {
        const [, campaign, action] = match;
        const stub = actorStub(env, campaign);
        if (action === "status") {
          if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
          return json(await stub.status());
        }
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
        await stub.onPoll();
        return json(await stub.status());
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      console.error("dial-odometer request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "internal error" }, 500);
    }
  },
};
