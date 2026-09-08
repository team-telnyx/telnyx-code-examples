import Telnyx from "telnyx";
export { SIMAgent } from "./simAgent.js";
import type { SIMAgent } from "./simAgent.js";
import type { ActorNamespace, ActorStub, IdFromNameOptions } from "@telnyx/edge-runtime";

// ---------------------------------------------------------------------------
// Worker entry point — routes webhooks, demo requests, and calls to the
// SIMAgent actor named after each SIM.
// ---------------------------------------------------------------------------

type SIMStub = ActorStub &
  Pick<
    SIMAgent,
    | "initialize"
    | "recordUsage"
    | "handleSms"
    | "handleInboundCall"
    | "checkThresholds"
    | "resetBillingCycle"
    | "snapshot"
  >;

interface SIMAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): SIMStub;
}

interface Env {
  SIM_AGENT: SIMAgentNamespace;
  TELNYX_API_KEY: string;
  DEMO_MODE?: string;
  SECRETS?: {
    get(binding: "TELNYX_PUBLIC_KEY"): Promise<string>;
  };
}

const TELNYX_API = "https://api.telnyx.com/v2";
const SIM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const DEMO_PHONE = "+15551234567";
const telnyxClient = new Telnyx({ apiKey: "unused-webhook-verification-only" });

function isLive(env: { DEMO_MODE?: string }): boolean {
  return env.DEMO_MODE === "false";
}

// ── Routes ────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "sim-agent",
        endpoints: [
          "POST /api/sim",
          "POST /api/usage",
          "GET /api/sim",
          "POST /api/demo",
          "POST /webhooks/usage",
          "POST /webhooks/sms",
          "POST /webhooks/call",
        ],
      });
    }
    if (url.pathname === "/health/liveness" || url.pathname === "/health/readiness") return new Response("ok");
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, demo: !isLive(env) });
    }

    try {
      if (req.method === "POST" && url.pathname === "/api/sim") return initializeSim(req, env);
      if (req.method === "POST" && url.pathname === "/api/usage") return recordUsage(req, env);
      if (req.method === "GET" && url.pathname === "/api/sim") return snapshot(url, env);
      if (req.method === "POST" && url.pathname === "/api/demo") return runDemo(req, env);
      if (req.method === "POST" && url.pathname === "/webhooks/usage") return handleUsageWebhook(req, env);
      if (req.method === "POST" && url.pathname === "/webhooks/sms") return handleSmsWebhook(req, env);
      if (req.method === "POST" && url.pathname === "/webhooks/call") return handleCallWebhook(req, env);
    } catch (error: unknown) {
      return errorResponse(error);
    }

    return Response.json({
      name: "sim-agent",
      endpoints: ["POST /api/sim", "POST /api/usage", "GET /api/sim", "POST /api/demo", "POST /webhooks/usage", "POST /webhooks/sms", "POST /webhooks/call"],
    }, { status: 404 });
  },
};

// ── HTTP handlers ─────────────────────────────────────────────────────────

async function initializeSim(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const simId = requiredSimId(stringValue(body.simId));
  const phoneNumber = optionalPhone(body.phoneNumber);
  const plan = stringValue(body.plan);
  const state = await sim(env, simId).initialize({ simId, phoneNumber: phoneNumber || undefined, plan: plan || undefined });
  return Response.json(state, { status: 201 });
}

async function recordUsage(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const simId = requiredSimId(stringValue(body.simId));
  const deltaMB = Number(body.deltaMB);
  if (!Number.isFinite(deltaMB) || deltaMB < 0) throw new Error("deltaMB must be a non-negative number");
  return Response.json(await sim(env, simId).recordUsage({ deltaMB }));
}

async function snapshot(url: URL, env: Env): Promise<Response> {
  const simId = requiredSimId(url.searchParams.get("simId") || "");
  return Response.json(await sim(env, simId).snapshot());
}

/** Full demo flow: usage past the 80% threshold, alert, Q&A, upgrade, snapshot. */
async function runDemo(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const simId = requiredSimId(stringValue(body.simId) || `sim-demo-${Date.now().toString().slice(-6)}`);
  const phoneNumber = optionalPhone(body.phoneNumber) || DEMO_PHONE;
  const stub = sim(env, simId);
  const initial = await stub.initialize({
    simId,
    phoneNumber,
    plan: stringValue(body.plan) || "1GB",
  });
  // Day 1–15: silent usage accumulation under the threshold.
  await stub.recordUsage({ deltaMB: 600, source: "demo_feed" });
  // Day 16: cross 80% — the agent proactively alerts.
  await stub.recordUsage({ deltaMB: 300, source: "demo_feed" });
  // Day 17: customer Q&A and an auto-provisioned upgrade.
  await stub.handleSms({ from: phoneNumber, text: "what are my options?" });
  await stub.handleSms({ from: phoneNumber, text: "upgrade to 10GB" });
  return Response.json({
    status: "complete",
    simId,
    initializedPlan: initial.plan.name,
    snapshot: await stub.snapshot(),
  });
}

// ── Webhooks ──────────────────────────────────────────────────────────────

type WebhookBody = {
  data?: {
    event_type?: string;
    payload?: Record<string, unknown>;
  };
};

async function handleUsageWebhook(req: Request, env: Env): Promise<Response> {
  const body = (await webhookBody(req, env)) as WebhookBody;
  const payload = body.data?.payload ?? {};
  const simId = stringValue(payload.sim_card_id) || normalizePhoneActorName(stringValue(payload.to));
  const usageMb = Number(payload.usage_mb ?? usageBytesToMb(payload.usage_bytes));
  if (!simId) throw new Error("sim_card_id is required");
  if (!Number.isFinite(usageMb) || usageMb < 0) throw new Error("usage_mb must be a non-negative number");
  await sim(env, simId).recordUsage({ deltaMB: usageMb, source: "webhook" });
  return Response.json({ status: "processed", sim_card_id: simId });
}

async function handleSmsWebhook(req: Request, env: Env): Promise<Response> {
  const body = (await webhookBody(req, env)) as WebhookBody;
  if (body.data?.event_type && body.data.event_type !== "message.received") {
    return Response.json({ ignored: true, event_type: body.data.event_type });
  }
  const payload = body.data?.payload ?? {};
  const text = stringValue(payload.text);
  const to = stringValue(payload.to);
  const simId = stringValue(payload.sim_card_id) || normalizePhoneActorName(to);
  if (!simId || !text) throw new Error("sim_card_id (or to) and text are required");
  await sim(env, simId).handleSms({ from: optionalPhone(payload.from) || DEMO_PHONE, text });
  return Response.json({ status: "processed", sim_card_id: simId });
}

async function handleCallWebhook(req: Request, env: Env): Promise<Response> {
  const body = (await webhookBody(req, env)) as WebhookBody;
  if (body.data?.event_type !== "call.initiated") {
    return Response.json({ ignored: true, event_type: body.data?.event_type });
  }
  const payload = body.data?.payload ?? {};
  const callControlId = stringValue(payload.call_control_id);
  const to = stringValue(payload.to);
  const simId = stringValue(payload.sim_card_id) || normalizePhoneActorName(to);
  if (!callControlId) throw new Error("call_control_id is required");
  if (!simId) throw new Error("sim_card_id (or to) is required");
  const context = await sim(env, simId).handleInboundCall();
  if (isLive(env)) {
    if (!env.TELNYX_API_KEY) throw new Error("TELNYX_API_KEY is not configured");
    await telnyxAction(env.TELNYX_API_KEY, callControlId, "answer", {});
    await telnyxAction(env.TELNYX_API_KEY, callControlId, "speak", {
      payload: context.message,
      voice: "Telnyx.KokoroTTS.af",
      language: "en-US",
      command_id: `sim-${simId}-${Date.now()}`,
    });
  }
  return Response.json({ status: "answered", demo: !isLive(env), sim_card_id: simId, message: context.message });
}

// ── Webhook intake (signature-verified in live mode) ──────────────────────

async function webhookBody(req: Request, env: Env): Promise<Record<string, unknown>> {
  if (!isLive(env)) return jsonBody(req);
  // Production: verify the Telnyx Ed25519 signature before trusting the body.
  const raw = await req.text();
  const publicKey = await env.SECRETS?.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) throw new Error("TELNYX_PUBLIC_KEY is required when DEMO_MODE is false");
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return (await telnyxClient.webhooks.unwrap(raw, { headers, key: publicKey })) as unknown as Record<string, unknown>;
}

// ── SIM helpers ───────────────────────────────────────────────────────────

function sim(env: Env, simId: string): SIMStub {
  return env.SIM_AGENT.idFromName(actorName(simId));
}

function actorName(simId: string): string {
  return `sim-${simId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

function normalizePhoneActorName(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `phone-${digits}` : "";
}

function usageBytesToMb(value: unknown): number {
  const bytes = Number(value);
  return Number.isFinite(bytes) ? Math.round((bytes / (1024 * 1024)) * 100) / 100 : NaN;
}

async function telnyxAction(apiKey: string, callControlId: string, action: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telnyx ${action} failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
}

// ── Shared request/response helpers (agent-with-tool-calling style) ───────

function optionalPhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const phone = value.trim();
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : "";
}

function requiredSimId(value: string): string {
  if (!SIM_ID.test(value)) throw new Error("simId must contain 3-64 letters, numbers, underscores, or hyphens");
  return value;
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => ({}));
  return objectValue(parsed);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (/signature|verification failed/i.test(message)) return Response.json({ error: message }, { status: 401 });
  const clientError = /required|invalid|must|unknown plan|not initialized/.test(message);
  return Response.json({ error: message }, { status: clientError ? 400 : 500 });
}
