export { FailoverAgent } from "./failoverAgent.js";
import type { FailoverAgent } from "./failoverAgent.js";
import Telnyx from "telnyx";
import type { ActorNamespace, ActorStub, IdFromNameOptions, KvNamespace } from "@telnyx/edge-runtime";
import {
  breakerStatus,
  readBreaker,
  shouldRouteToBackup,
  type BreakerSnapshot,
} from "./breaker.js";
import { listEvents, recordEvent, kvSafeId, demoModeEnabled } from "./events.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import type { CallControlEvent, CallRoutingMap } from "./failoverAgent.js";

// ---------------------------------------------------------------------------
// Worker entry point — routes Call Control webhooks to the FailoverAgent
// actor ("failover"), serves the routing API that dials over the primary or
// backup SIP connection based on the breaker state in KV, and exposes the
// breaker status/reset endpoints.
// ---------------------------------------------------------------------------

type FailoverStub = ActorStub &
  Pick<
    FailoverAgent,
    "recordOutcome" | "handleCallEvent" | "resetBreaker" | "snapshot" | "noteCall" | "connectionFor"
  >;

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
  DEBUG_ERRORS?: string;
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

/**
 * Worker-process config. On Telnyx Edge, `[env_vars]` from telnyx.toml surface
 * through `process.env` in the worker (the merged samples' convention); the
 * fetch `env` object is kept as a secondary source for local runtimes that
 * inject there instead.
 */
function envConfig(env: Env, key: keyof Env | "TELNYX_OPS_ALERT_NUMBER" | "SMS_FROM_NUMBER"): string | undefined {
  return process.env[key] ?? (env as unknown as Record<string, string>)[key];
}

async function isDemoMode(env: Env): Promise<boolean> {
  return demoModeEnabled(env.FAILOVER_KV, envConfig(env, "DEMO_MODE"));
}

function primaryConnectionId(env: Env): string {
  return envConfig(env, "TELNYX_PRIMARY_CONNECTION_ID") ?? "";
}

function backupConnectionId(env: Env): string {
  return envConfig(env, "TELNYX_BACKUP_CONNECTION_ID") ?? "";
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
      return new Response(DASHBOARD_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "healthy", demo_mode: await isDemoMode(env) });
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
      if (req.method === "GET" && url.pathname === "/api/events") {
        const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 30, 100);
        return Response.json({ events: env.FAILOVER_KV ? await listEvents(env.FAILOVER_KV, limit) : [] });
      }
      if (req.method === "POST" && url.pathname === "/api/circuit-reset") {
        return await handleCircuitReset(env);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Request failed: ${message}`);
      if (process.env.DEBUG_ERRORS === "1" || env.DEBUG_ERRORS === "1") {
        return Response.json({ error: "Internal server error", detail: message }, { status: 500 });
      }
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }

    return Response.json({
      name: "auto-failover-voice-routing",
      endpoints: [
        "POST /webhooks/call-control",
        "POST /api/route",
        "GET /api/circuit-state",
        "GET /api/events",
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

  const snapshot = await currentBreaker(env);
  const cooldownSeconds = intEnv(envConfig(env, "COOLDOWN_SECONDS"), 300);
  const useBackup = shouldRouteToBackup(snapshot, cooldownSeconds);
  const connectionId = useBackup ? backupConnectionId(env) : primaryConnectionId(env);
  await recordEvent(
    env.FAILOVER_KV,
    "route_decision",
    `routed via ${useBackup ? "backup" : "primary"} connection`,
    useBackup ? "backup" : "primary",
  );

  if (await isDemoMode(env)) {
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
    from: envConfig(env, "TELNYX_FROM_NUMBER") ?? "",
    to: toNumber,
  });
  const callId = call.data?.call_control_id ?? "";
  if (callId) {
    await putCallMap(env, callId, { connection_id: connectionId, to: toNumber });
  }
  return Response.json(
    { call_id: callId, connection_id: connectionId, circuit_state: snapshot },
    { status: 201 },
  );
}

/** Raw breaker state plus the derived closed/open/half-open status. */
async function handleCircuitState(env: Env): Promise<Response> {
  const snapshot = await currentBreaker(env);
  const status = breakerStatus(snapshot, intEnv(envConfig(env, "COOLDOWN_SECONDS"), 300));
  const payload: Record<string, unknown> = { ...snapshot, status };
  const threshold = envConfig(env, "FAILURE_THRESHOLD");
  if (threshold) payload.threshold = intEnv(threshold, 3);
  if (primaryConnectionId(env)) payload.primary_connection_id = primaryConnectionId(env);
  if (backupConnectionId(env)) payload.backup_connection_id = backupConnectionId(env);
  return Response.json(payload);
}

/**
 * Breaker reads in the worker. Edge injects the `[storage.kv]` binding into
 * the fetch `env`; runtimes that don't fall back to the FailoverAgent, which
 * mirrors the breaker in KV (or its durable storage).
 */
async function currentBreaker(env: Env): Promise<BreakerSnapshot> {
  return env.FAILOVER_KV ? readBreaker(env.FAILOVER_KV) : failoverActor(env).snapshot();
}

async function putCallMap(env: Env, callControlId: string, map: CallRoutingMap): Promise<void> {
  if (env.FAILOVER_KV) {
    await env.FAILOVER_KV.put(
      callMapKey(callControlId),
      JSON.stringify(map),
      { expirationTtl: CALL_MAP_TTL_SECONDS },
    );
    return;
  }
  await failoverActor(env).noteCall(callControlId, map.connection_id, map.to);
}

async function getCallConnection(env: Env, callControlId: string): Promise<string> {
  if (env.FAILOVER_KV) {
    const raw = await env.FAILOVER_KV.get(callMapKey(callControlId));
    return raw ? (JSON.parse(raw) as CallRoutingMap).connection_id : "";
  }
  return failoverActor(env).connectionFor(callControlId);
}

/** Reset goes through the actor — the breaker's single writer. */
async function handleCircuitReset(env: Env): Promise<Response> {
  const snapshot = await failoverActor(env).resetBreaker();
  return Response.json({ status: "reset", circuit_state: snapshot });
}

// ── Call Control webhook ──────────────────────────────────────────────────

async function handleCallControlWebhook(req: Request, env: Env): Promise<Response> {
  await recordEvent(env.FAILOVER_KV, "webhook", "webhook received — verifying signature");
  let event: CallControlEvent;
  try {
    event = await verifyWebhook(req, env);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Webhook rejected: ${message}`);
    await recordEvent(env.FAILOVER_KV, "webhook", `verification FAILED: ${message}`);
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
  await recordEvent(env.FAILOVER_KV, "webhook", `event: ${eventType}`);
  if (eventType === "call.speak.failed" || eventType === "call.speak.started") {
    await recordEvent(
      env.FAILOVER_KV,
      "webhook",
      `${eventType}: ${stringValue(payload.reason) || stringValue(payload.voice) || "no detail"}`,
    );
  }

  // ── Inbound fraud line: the caller dialed +18337483087 themselves ──────
  if (eventType === "call.initiated" && stringValue(payload.direction) === "incoming") {
    const callControlId = stringValue(payload.call_control_id);
    const caller = stringValue(payload.from);
    // Respond instantly; the answer + caller mapping run in the background so
    // the greeting starts a full round-trip sooner.
    void (async () => {
      await putCallMap(env, callControlId, {
        connection_id: primaryConnectionId(env),
        to: caller,
      });
      await env.TELNYX.calls.actions.answer(callControlId, {});
      log(`Inbound fraud line answered for caller ${caller.slice(0, 6)}...`);
      await recordEvent(env.FAILOVER_KV, "call_answered", `inbound fraud line call from ${caller.slice(0, 6)}...`, "primary");
    })().catch((error: unknown) => log(`Inbound answer failed: ${error instanceof Error ? error.message : String(error)}`));
    return Response.json({ status: "ok", action: "answering" });
  }

  if (eventType === "call.hangup") {
    const hangupCause = stringValue(payload.hangup_cause).toUpperCase();
    const callConnection = await getCallConnection(env, callControlId);
    log(`Call hangup cause: ${hangupCause || "unknown"}`);
    if (FAILURE_HANGUP_CAUSES.has(hangupCause) && callConnection === primaryConnectionId(env)) {
      log(
        `Call failed on primary (hangup_cause=${hangupCause}) — counting toward circuit breaker.`,
      );
      const outcome = await failoverActor(env).recordOutcome(event);
      await recordEvent(
        env.FAILOVER_KV,
        "failure_counted",
        `hangup_cause=${hangupCause} — failures: ${outcome.snapshot.failures}`,
        "primary",
      );
      if (outcome.trippedNow) {
        await recordEvent(
          env.FAILOVER_KV,
          "breaker_tripped",
          `failures: ${outcome.snapshot.failures} — auto-failover to backup connection`,
          "primary",
        );
        await recordEvent(env.FAILOVER_KV, "sms_sent", "ops alert SMS sent", "primary");
      }
    }
  } else if (callState === "failed" || callState === "busy" || callState === "no_answer") {
    const outcome = await failoverActor(env).recordOutcome(event);
    await recordEvent(
      env.FAILOVER_KV,
      "failure_counted",
      `call ${callState} on primary — failures: ${outcome.snapshot.failures}`,
      "primary",
    );
    if (outcome.trippedNow) {
      await recordEvent(
        env.FAILOVER_KV,
        "breaker_tripped",
        `failures: ${outcome.snapshot.failures} — auto-failover to backup connection`,
        "primary",
      );
      await recordEvent(env.FAILOVER_KV, "sms_sent", "ops alert SMS sent", "primary");
    }
  } else if (callState === "answered") {
    // Announce is slow (TTS API) — respond immediately; the actor dispatch is
    // fire-and-forget and idempotent, so webhook redeliveries cannot double-speak.
    void failoverActor(env)
      .handleCallEvent(event)
      .then(() => recordEvent(env.FAILOVER_KV, "call_answered", "fraud alert announced"))
      .catch((error: unknown) => log(`Announce dispatch failed: ${error instanceof Error ? error.message : String(error)}`));
  } else if (eventType === "call.speak.ended") {
    await failoverActor(env).handleCallEvent(event);
  } else if (eventType === "call.gather.ended") {
    await failoverActor(env).handleCallEvent(event);
    await recordEvent(
      env.FAILOVER_KV,
      "caller_response",
      `pressed ${stringValue(payload.digits) || "(nothing)"}`,
    );
    if (stringValue(payload.digits)) {
      await recordEvent(env.FAILOVER_KV, "sms_sent", "customer receipt SMS sent");
    }
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
  if (await isDemoMode(env) || process.env.SKIP_WEBHOOK_VERIFY === "1") {
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
  return `call/${kvSafeId(callControlId)}`;
}

