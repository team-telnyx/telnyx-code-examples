export { FailoverAgent } from "./failoverAgent.js";
import type { FailoverAgent } from "./failoverAgent.js";
import Telnyx from "telnyx";
import type { ActorNamespace, ActorStub, IdFromNameOptions, KvNamespace } from "@telnyx/edge-runtime";
import {
  breakerStatus,
  readBreaker,
  shouldRouteToBackup,
} from "./breaker.js";
import type { CallControlEvent, CallRoutingMap } from "./failoverAgent.js";

// ---------------------------------------------------------------------------
// Worker entry point — routes Call Control webhooks to the FailoverAgent
// actor ("failover"), serves the routing API that dials over the primary or
// backup SIP connection based on the breaker state in KV, and exposes the
// breaker status/reset endpoints.
// ---------------------------------------------------------------------------

type FailoverStub = ActorStub &
  Pick<FailoverAgent, "recordOutcome" | "handleCallEvent" | "resetBreaker">;

interface FailoverNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): FailoverStub;
}

interface Env {
  FAILOVER_AGENT: FailoverNamespace;
  TELNYX: Pick<Telnyx, "calls" | "messages">;
  FAILOVER_KV: KvNamespace;
  DEMO_MODE?: string;
  TELNYX_PRIMARY_CONNECTION_ID?: string;
  TELNYX_BACKUP_CONNECTION_ID?: string;
  TELNYX_FROM_NUMBER?: string;
  FAILURE_THRESHOLD?: string;
  COOLDOWN_SECONDS?: string;
  DIAL_TIMEOUT_SECS?: string;
  SECRETS?: {
    get(binding: "TELNYX_PUBLIC_KEY"): Promise<string>;
  };
}

/** Hangup causes that count as a primary-connection failure. */
const FAILURE_HANGUP_CAUSES = new Set([
  "NO_ANSWER",
  "USER_BUSY",
  "CALL_REJECTED",
  "DESTINATION_OUT_OF_ORDER",
  "NETWORK_OUT_OF_ORDER",
  "NO_ROUTE_DESTINATION",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
]);

/** Single actor instance owns the breaker; all webhooks dispatch to it. */
const FAILOVER_ACTOR_NAME = "failover";

/** Call routing maps are call-scoped; a day bounds KV growth. */
const CALL_MAP_TTL_SECONDS = 86400;

/**
 * Telnyx SDK client used for webhook signature verification only — unwrap
 * needs no API key. (Live calls/SMS go through the `[telnyx]` binding.)
 */
const telnyxVerifyClient = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY ?? "unused-webhook-verification-only",
});

function isDemoMode(env: Env): boolean {
  return ["true", "1", "yes"].includes((env.DEMO_MODE ?? "true").toLowerCase());
}

function primaryConnectionId(env: Env): string {
  return env.TELNYX_PRIMARY_CONNECTION_ID ?? "";
}

function backupConnectionId(env: Env): string {
  return env.TELNYX_BACKUP_CONNECTION_ID ?? "";
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => ({}));
  return objectValue(parsed);
}

function log(message: string): void {
  console.log(`[failover] ${message}`);
}

function failoverActor(env: Env): FailoverStub {
  return env.FAILOVER_AGENT.idFromName(FAILOVER_ACTOR_NAME);
}

// ── Routes ────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "auto-failover-voice-routing",
        endpoints: [
          "POST /webhooks/call-control",
          "POST /api/route",
          "GET /api/circuit-state",
          "POST /api/circuit-reset",
          "GET /health",
        ],
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "healthy", demo_mode: isDemoMode(env) });
    }

    try {
      if (req.method === "POST" && url.pathname === "/webhooks/call-control") {
        return handleCallControlWebhook(req, env);
      }
      if (req.method === "POST" && url.pathname === "/api/route") {
        return await handleRoute(req, env);
      }
      if (req.method === "GET" && url.pathname === "/api/circuit-state") {
        return await handleCircuitState(env);
      }
      if (req.method === "POST" && url.pathname === "/api/circuit-reset") {
        return await handleCircuitReset(env);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Request failed: ${message}`);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }

    return Response.json({
      name: "auto-failover-voice-routing",
      endpoints: [
        "POST /webhooks/call-control",
        "POST /api/route",
        "GET /api/circuit-state",
        "POST /api/circuit-reset",
        "GET /health",
      ],
    }, { status: 404 });
  },
};

// ── Routing API ───────────────────────────────────────────────────────────

/** Decide primary vs backup from the breaker, then dial over that connection. */
async function handleRoute(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const toNumber = stringValue(body.to);
  if (!toNumber) {
    return Response.json({ error: "Missing 'to' parameter" }, { status: 400 });
  }

  const snapshot = await readBreaker(env.FAILOVER_KV);
  const cooldownSeconds = intEnv(env.COOLDOWN_SECONDS, 300);
  const useBackup = shouldRouteToBackup(snapshot, cooldownSeconds);
  const connectionId = useBackup ? backupConnectionId(env) : primaryConnectionId(env);

  if (isDemoMode(env)) {
    log(
      `[DEMO MODE] Would create call to ${toNumber} via connection ${connectionId} ` +
      `(tripped=${snapshot.tripped}, failures=${snapshot.failures})`,
    );
    return Response.json({
      demo: true,
      to: toNumber,
      connection_id: connectionId,
      circuit_state: snapshot,
      message: "Demo mode: no real call placed.",
    });
  }

  // Live mode: create the call over the chosen SIP connection.
  const call = await env.TELNYX.calls.dial({
    connection_id: connectionId,
    from: env.TELNYX_FROM_NUMBER ?? "",
    to: toNumber,
    timeout_secs: intEnv(env.DIAL_TIMEOUT_SECS, 30),
  });
  const callId = call.data?.call_control_id ?? "";
  if (callId) {
    await env.FAILOVER_KV.put(
      callMapKey(callId),
      JSON.stringify({ connection_id: connectionId, to: toNumber }),
      { expirationTtl: CALL_MAP_TTL_SECONDS },
    );
  }
  return Response.json(
    { call_id: callId, connection_id: connectionId, circuit_state: snapshot },
    { status: 201 },
  );
}

/** Raw breaker state plus the derived closed/open/half-open status. */
async function handleCircuitState(env: Env): Promise<Response> {
  const snapshot = await readBreaker(env.FAILOVER_KV);
  const status = breakerStatus(snapshot, intEnv(env.COOLDOWN_SECONDS, 300));
  return Response.json({ ...snapshot, status });
}

/** Reset goes through the actor — the breaker's single writer. */
async function handleCircuitReset(env: Env): Promise<Response> {
  const snapshot = await failoverActor(env).resetBreaker();
  return Response.json({ status: "reset", circuit_state: snapshot });
}

// ── Call Control webhook ──────────────────────────────────────────────────

async function handleCallControlWebhook(req: Request, env: Env): Promise<Response> {
  let event: CallControlEvent;
  try {
    event = await verifyWebhook(req, env);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Webhook rejected: ${message}`);
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const eventType = stringValue(event.data?.event_type);
  const payload = objectValue(event.data?.payload);
  const callControlId = stringValue(payload.call_control_id);
  const callState =
    eventType === "call.state_changed"
      ? stringValue(payload.state)
      : eventType.replace("call.", "");
  log(`Received webhook event: ${eventType}`);

  if (eventType === "call.hangup") {
    const hangupCause = stringValue(payload.hangup_cause).toUpperCase();
    const callConnection = await getCallConnection(env.FAILOVER_KV, callControlId);
    log(`Call hangup cause: ${hangupCause || "unknown"}`);
    if (FAILURE_HANGUP_CAUSES.has(hangupCause) && callConnection === primaryConnectionId(env)) {
      log(
        `Call failed on primary (hangup_cause=${hangupCause}) — counting toward circuit breaker.`,
      );
      await failoverActor(env).recordOutcome(event);
    }
  } else if (callState === "failed" || callState === "busy" || callState === "no_answer") {
    await failoverActor(env).recordOutcome(event);
  } else if (callState === "answered") {
    await failoverActor(env).handleCallEvent(event);
  } else if (eventType === "call.speak.ended") {
    await failoverActor(env).handleCallEvent(event);
  } else if (eventType === "call.gather.ended") {
    await failoverActor(env).handleCallEvent(event);
  }

  return Response.json({ status: "ok" });
}

/**
 * Verify the Telnyx Ed25519 signature on an inbound webhook and return the
 * parsed event. In demo mode (DEMO_MODE=true) — and in the local smoke via
 * SKIP_WEBHOOK_VERIFY=1 — the signature check is skipped and the body is just
 * parsed. Live deployments always verify against TELNYX_PUBLIC_KEY.
 *
 * The signature is over the exact bytes Telnyx sent — read the raw body with
 * `await request.text()`, never `await request.json()` before verify.
 */
async function verifyWebhook(req: Request, env: Env): Promise<CallControlEvent> {
  const body = await req.text();
  if (isDemoMode(env) || process.env.SKIP_WEBHOOK_VERIFY === "1") {
    return JSON.parse(body) as CallControlEvent;
  }
  const publicKey = await env.SECRETS?.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error(
      "TELNYX_PUBLIC_KEY is required when DEMO_MODE is false — " +
        "run `telnyx-edge secrets add TELNYX_PUBLIC_KEY <base64>`",
    );
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return (await telnyxVerifyClient.webhooks.unwrap(body, {
    headers,
    key: publicKey,
  })) as CallControlEvent;
}

// ── Call routing maps (KV) ────────────────────────────────────────────────

function callMapKey(callControlId: string): string {
  return `call:${callControlId}`;
}

/** Which connection a call leg was dialed over, or null when unknown. */
async function getCallConnection(kv: KvNamespace, callControlId: string): Promise<string> {
  const raw = await kv.get(callMapKey(callControlId));
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    const map = parsed as Partial<CallRoutingMap> | null;
    return typeof map?.connection_id === "string" ? map.connection_id : "";
  } catch {
    return "";
  }
}
