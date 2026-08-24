import { Webhook } from "svix";
import type {
  AgentMailInboundPayload,
  AgentMailReplyParsed,
  AgentMailSendInput,
  AgentMailSendResult,
  Env,
} from "./types.js";

const AGENTMAIL_API_BASE = "https://api.agentmail.to";
const AGENTMAIL_INBOX_DEFAULT = "sfdc-agent-telnyx@agentmail.to";

/**
 * Resolve the AgentMail API key from env or secrets binding.
 * Throws if unset — the agent cannot send without it.
 */
export async function agentMailApiKey(env: Env): Promise<string> {
  const direct = env.AGENTMAIL_API_KEY;
  if (direct && direct.trim()) return direct.trim();
  const secret = await env.SECRETS?.get("AGENTMAIL_API_KEY");
  if (!secret || !secret.trim()) {
    throw new Error("AGENTMAIL_API_KEY is required to send Agent Mail");
  }
  return secret.trim();
}

/**
 * Resolve the agent's mailbox address. Used as the `from` for outbound and
 * the routing identity for inbound replies.
 */
export async function agentMailInbox(env: Env): Promise<string> {
  const direct = env.AGENTMAIL_INBOX;
  if (direct && direct.trim()) return direct.trim();
  const secret = await env.SECRETS?.get("AGENTMAIL_INBOX");
  return (secret && secret.trim()) || AGENTMAIL_INBOX_DEFAULT;
}

/**
 * Resolve the Svix webhook secret used to verify inbound AgentMail webhooks.
 * Returns null if no secret is configured — callers should reject unsigned
 * inbound traffic in production but allow it for local demo mode.
 */
export async function agentMailWebhookSecret(env: Env): Promise<string | null> {
  const direct = env.AGENTMAIL_WEBHOOK_SECRET;
  if (direct && direct.trim()) return direct.trim();
  const secret = await env.SECRETS?.get("AGENTMAIL_WEBHOOK_SECRET");
  return (secret && secret.trim()) || null;
}

/**
 * Send an outbound email via AgentMail. Returns the message_id and thread_id
 * from the AgentMail API. The from: address is always the agent's inbox.
 *
 * Spec role: Step 9 — LangGraph emails Steve (the human SDR) through Agent
 * Mail to confirm a meeting time.
 */
export async function sendAgentMail(
  env: Env,
  input: AgentMailSendInput,
): Promise<AgentMailSendResult> {
  console.log("[agent-mail] sendAgentMail START", { to: input.to, subject: input.subject.slice(0, 80) });

  console.log("[agent-mail] resolving API key + inbox");
  const apiKey = await agentMailApiKey(env);
  const inbox = await agentMailInbox(env);
  console.log("[agent-mail] creds resolved", { inbox });

  const url = `${AGENTMAIL_API_BASE}/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`;
  const body = JSON.stringify({
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    reply_to: input.reply_to,
  });

  console.log("[agent-mail] POST send", { url, bodyLength: body.length });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  console.log("[agent-mail] POST response", { status: res.status, ok: res.ok });

  if (!res.ok) {
    const text = await safeResponseText(res);
    console.error("[agent-mail] send FAILED", { status: res.status, body: text });
    throw new Error(`AgentMail send failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { message_id?: string; thread_id?: string };
  console.log("[agent-mail] response parsed", {
    message_id: data.message_id?.slice(0, 20),
    thread_id: data.thread_id?.slice(0, 20),
  });

  if (!data.message_id || !data.thread_id) {
    console.error("[agent-mail] missing message_id or thread_id in response", data);
    throw new Error("AgentMail send response missing message_id or thread_id");
  }

  console.log("[agent-mail] sendAgentMail OK", { message_id: data.message_id.slice(0, 20), thread_id: data.thread_id.slice(0, 20) });
  return {
    message_id: data.message_id,
    thread_id: data.thread_id,
  };
}

/**
 * Verify an inbound AgentMail webhook's Svix signature.
 *
 * AgentMail signs webhooks with standard Svix headers:
 *   svix-id, svix-timestamp, svix-signature
 *
 * The signature is HMAC-SHA256 of `${svix-id}.${svix-timestamp}.${rawBody}`
 * keyed with the webhook secret (`whsec_...`). The signature header may
 * contain a space-separated list of `v1,<base64>` entries; any match passes.
 *
 * Throws on missing headers, unknown secret, expired timestamp, or
 * signature mismatch. Returns the parsed payload on success.
 */
export async function verifyAgentMailWebhook(
  rawBody: string,
  headers: Record<string, string>,
  env: Env,
): Promise<AgentMailInboundPayload> {
  console.log("[agent-mail] verifyAgentMailWebhook START", { bodyLength: rawBody.length, hasSvixId: !!headers["svix-id"] });

  console.log("[agent-mail] resolving webhook secret");
  const secret = await agentMailWebhookSecret(env);
  if (!secret) {
    console.error("[agent-mail] no webhook secret configured");
    throw new Error(
      "AGENTMAIL_WEBHOOK_SECRET is required to verify inbound Agent Mail webhooks",
    );
  }
  console.log("[agent-mail] secret resolved", { secretLength: secret.length });

  const svixId = headers["svix-id"];
  const svixTimestamp = headers["svix-timestamp"];
  const svixSignature = headers["svix-signature"];

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error("[agent-mail] missing Svix headers", { hasId: !!svixId, hasTs: !!svixTimestamp, hasSig: !!svixSignature });
    throw new Error("Missing Svix signature headers (svix-id, svix-timestamp, svix-signature)");
  }

  console.log("[agent-mail] verifying Svix signature", { svixId, svixTimestamp, sigPrefix: svixSignature.slice(0, 12) });
  const wh = new Webhook(secret);
  const verified = await wh.verify(rawBody, {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": svixSignature,
  });
  console.log("[agent-mail] Svix verify OK");

  return verified as AgentMailInboundPayload;
}

/**
 * Parse an AgentMail inbound webhook payload into the fields the orchestrator
 * needs to interpret a Steve reply.
 *
 * Prefers `extracted_text` (AgentMail's Talon-cleaned reply body that strips
 * quoted history) and falls back to raw `text` if absent.
 */
export function parseAgentMailInbound(
  payload: AgentMailInboundPayload,
): AgentMailReplyParsed {
  console.log("[agent-mail] parseAgentMailInbound START", { event_type: payload.event_type, event_id: payload.event_id });

  const msg = payload.message;
  if (!msg) {
    console.error("[agent-mail] inbound payload missing message field");
    throw new Error("AgentMail inbound payload missing message");
  }

  const text = (msg.extracted_text || msg.text || "").trim();
  if (!text) {
    console.error("[agent-mail] inbound message has no text body", { message_id: msg.message_id });
    throw new Error("AgentMail inbound message has no text body");
  }

  const parsed = {
    from: msg.from,
    subject: msg.subject || "",
    text,
    thread_id: msg.thread_id,
    message_id: msg.message_id,
    in_reply_to: msg.in_reply_to ?? null,
  };

  console.log("[agent-mail] parseAgentMailInbound OK", {
    from: parsed.from,
    subject: parsed.subject.slice(0, 60),
    textLength: parsed.text.length,
    thread_id: parsed.thread_id?.slice(0, 20),
  });

  return parsed;
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "unable to read response body";
  }
}
