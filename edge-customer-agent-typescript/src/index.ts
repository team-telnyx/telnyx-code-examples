/**
 * Customer Agent — Edge Compute front door.
 *
 * The fetch handler is the per-connection front door: it validates
 * Telnyx webhook signatures, routes by event type, resolves the actor
 * by E.164 phone number, and calls the appropriate method. The actor
 * (the durable entity IS the customer) handles the rest.
 *
 * Routes:
 *   POST /webhooks/voice        — inbound call → handleCall()
 *   POST /webhooks/call-ended   — call ended → onCallEnded() + sendFollowupSMS()
 *   POST /webhooks/messaging    — inbound SMS → handleSMS()
 *   POST /webhooks/salesforce   — SF status change → ingestSalesforceUpdate()
 *   POST /hitl/reply            — human reply → resumeEscalation()
 *   GET  /                      — API descriptor
 *   GET  /health/{liveness,readiness} — health checks
 */

import { CustomerAgent } from "./customer-agent";
import type { Env } from "./customer-agent";

export { CustomerAgent };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health/liveness") return json({ status: "ok" });
    if (url.pathname === "/health/readiness") return json({ status: "ok" });
    if (url.pathname === "/" && req.method === "GET") return json(API_DESCRIPTOR);

    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    if (url.pathname === "/webhooks/voice") return handleVoiceWebhook(req, env);
    if (url.pathname === "/webhooks/call-ended") return handleCallEndedWebhook(req, env);
    if (url.pathname === "/webhooks/messaging") return handleMessagingWebhook(req, env);
    if (url.pathname === "/webhooks/salesforce") return handleSalesforceWebhook(req, env);
    if (url.pathname === "/hitl/reply") return handleHITLReply(req, env);

    return json({ error: "not found" }, 404);
  },
};

// ── Voice webhook → handleCall ──────────────────────────────────────────

async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  const event = (await req.json()) as VoiceWebhookEvent;
  const customerPhone = event.data?.payload?.from ?? "";
  if (!customerPhone) return json({ error: "missing 'from' in webhook" }, 400);

  const stub = env.AGENT.idFromName(actorNameFromPhone(customerPhone));
  const result = await stub.handleCall(
    event.data?.payload?.call_control_id ?? "",
    customerPhone,
    event.data?.payload?.to ?? "",
  );

  return new Response(result.texml, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}

// ── Call ended webhook → onCallEnded ────────────────────────────────────

async function handleCallEndedWebhook(req: Request, env: Env): Promise<Response> {
  const event = (await req.json()) as CallEndedWebhookEvent;
  const customerPhone = event.data?.payload?.from ?? "";
  if (!customerPhone) return json({ error: "missing 'from' in webhook" }, 400);

  const stub = env.AGENT.idFromName(actorNameFromPhone(customerPhone));
  await stub.onCallEnded(
    event.data?.payload?.call_control_id ?? "",
    event.data?.payload?.duration ?? 0,
  );

  return json({ ok: true });
}

// ── Messaging webhook → handleSMS ───────────────────────────────────────

async function handleMessagingWebhook(req: Request, env: Env): Promise<Response> {
  const event = (await req.json()) as MessagingWebhookEvent;
  const payload = event.data?.payload;
  if (!payload) return json({ error: "missing payload" }, 400);

  const from = payload["from"] ?? "";
  const to = payload["to"] ?? "";
  const text = payload["text"] ?? "";
  if (!from || !text) return json({ error: "missing 'from' or 'text'" }, 400);

  const stub = env.AGENT.idFromName(actorNameFromPhone(from));
  await stub.handleSMS(from, to, text);

  return json({ ok: true });
}

// ── Salesforce webhook → ingestSalesforceUpdate ────────────────────────

async function handleSalesforceWebhook(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as SalesforceWebhookBody;
  const customerPhone = body.customer_phone_e164 ?? "";
  if (!customerPhone) return json({ error: "missing customer_phone_e164" }, 400);

  const stub = env.AGENT.idFromName(actorNameFromPhone(customerPhone));
  await stub.ingestSalesforceUpdate({
    salesforce_id: body.salesforce_id ?? "",
    status: body.status ?? "",
    tracking_number: body.tracking_number,
    estimated_delivery: body.estimated_delivery,
  });

  return json({ ok: true });
}

// ── HITL reply → resumeEscalation ───────────────────────────────────────

async function handleHITLReply(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as HITLReplyBody;
  const customerPhone = body.phone_e164 ?? "";
  const replyText = body.reply_text ?? "";
  if (!customerPhone || !replyText) return json({ error: "missing phone_e164 or reply_text" }, 400);

  const stub = env.AGENT.idFromName(actorNameFromPhone(customerPhone));
  await stub.resumeEscalation(replyText);

  return json({ ok: true });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Sanitize an E.164 phone number for use as a Dapr actor name.
 * Dapr requires lowercase alphanumeric, hyphens, and dots (RFC 1123).
 * The leading "+" in E.164 is invalid — strip it.
 */
function actorNameFromPhone(phone: string): string {
  return phone.replace(/^\+/, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const API_DESCRIPTOR = {
  name: "customer-agent",
  description: "Entity Agent — the actor IS the customer. Durable across days, channels, and interactions.",
  endpoints: {
    "POST /webhooks/voice": "Telnyx voice webhook — inbound call → TeXML response",
    "POST /webhooks/call-ended": "Telnyx call-ended webhook — triggers follow-up SMS",
    "POST /webhooks/messaging": "Telnyx messaging webhook — inbound SMS → AI reply",
    "POST /webhooks/salesforce": "Salesforce status change → proactive customer outreach",
    "POST /hitl/reply": "Human-in-the-loop reply → resume agent",
    "GET /health/liveness": "Liveness probe",
    "GET /health/readiness": "Readiness probe",
  },
};

// ── Webhook event types (Telnyx API shapes, narrowed) ──────────────────

interface VoiceWebhookEvent {
  data?: {
    payload?: {
      call_control_id?: string;
      from?: string;
      to?: string;
      event_type?: string;
    };
  };
}

interface CallEndedWebhookEvent {
  data?: {
    payload?: {
      call_control_id?: string;
      from?: string;
      to?: string;
      duration?: number;
    };
  };
}

interface MessagingWebhookEvent {
  data?: {
    payload?: {
      from?: string;
      to?: string;
      text?: string;
      message_type?: string;
    };
  };
}

interface SalesforceWebhookBody {
  customer_phone_e164?: string;
  salesforce_id?: string;
  status?: string;
  tracking_number?: string;
  estimated_delivery?: string;
}

interface HITLReplyBody {
  phone_e164?: string;
  reply_text?: string;
}
