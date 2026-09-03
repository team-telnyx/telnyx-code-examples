import type { Env } from "./types";
import { envVars, html, json } from "./types";
import { getEvent } from "./store";
import { verifyTelnyxSignature } from "./verify";
import * as crypto from "node:crypto";
import { renderMicrosite } from "./pages/microsite";
import { renderVoicePage } from "./pages/voice";
import { handleInboundMessage } from "./routes/concierge";
import {
  handleLeadSubmit,
  handleLeadList,
  handleAttendeeRegister,
  handleBroadcast,
  handleFeedback,
  handleSponsorReport,
  handleEmailReport,
} from "./routes/ops";
import {
  handleConfig,
  handleSetupAssistant,
  handleToolLookup,
} from "./routes/assistant";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── Health (platform probes) ───────────────────────────────────────
    if (path === "/health" || path.startsWith("/health/")) {
      return new Response("ok");
    }

    // ── Microsite (server-rendered from KV) ────────────────────────────
    if (path === "/" && req.method === "GET") {
      return html(renderMicrosite(await getEvent(env.EVENTS)));
    }
    if (path === "/voice" && req.method === "GET") {
      return html(renderVoicePage(await getEvent(env.EVENTS)));
    }

    // ── JSON APIs (read from the same KV as the page) ──────────────────
    if (path === "/api/config" && req.method === "GET") {
      return handleConfig(env);
    }
    if (path === "/api/event" && req.method === "GET") {
      return json(await getEvent(env.EVENTS));
    }
    if (path === "/api/leads" && req.method === "GET") {
      return handleLeadList(env);
    }
    if (path === "/api/sponsor-report" && req.method === "GET") {
      return handleSponsorReport(env);
    }
    if (path === "/api/email-report" && req.method === "POST") {
      return handleEmailReport(env);
    }

    // ── Writes ─────────────────────────────────────────────────────────
    if (path === "/api/leads" && req.method === "POST") {
      return handleLeadSubmit(req, env);
    }
    if (path === "/api/attendees" && req.method === "POST") {
      return handleAttendeeRegister(req, env);
    }
    if (path === "/api/broadcast" && req.method === "POST") {
      return handleBroadcast(req, env);
    }
    if (path === "/api/feedback" && req.method === "POST") {
      return handleFeedback(req, env);
    }

    // ── Assistant provisioning + webhook tool ──────────────────────────
    if (path === "/api/setup-assistant" && req.method === "POST") {
      return handleSetupAssistant(req, env);
    }
    if (path === "/tools/lookup" && req.method === "POST") {
      // Called by the Telnyx assistant platform (signed with Telnyx Ed25519
      // headers automatically). Verify before answering.
      const raw = await req.arrayBuffer();
      const verdict = verifyTelnyxSignature(req.headers, raw);
      if (verdict === 500) {
        return json({ error: "TELNYX_PUBLIC_KEY secret not configured" }, 500);
      }
      if (verdict !== 0) {
        return json({ error: "invalid webhook signature" }, verdict);
      }
      return handleToolLookup(env);
    }

    // ── Inbound SMS / WhatsApp webhooks (Telnyx messaging profile) ─────
    if ((path === "/webhook/sms" || path === "/webhook/whatsapp") && req.method === "POST") {
      const raw = await req.arrayBuffer();

      // Signature verification is cheap (crypto only) — do it inline.
      const verdict = verifyTelnyxSignature(req.headers, raw);
      if (verdict === 500) {
        return json({ error: "TELNYX_PUBLIC_KEY secret not configured" }, 500);
      }
      if (verdict !== 0) {
        return json({ error: "invalid webhook signature" }, verdict);
      }

      let body: { data?: { event_type?: string; payload?: Record<string, unknown> } };
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const payload = body.data?.payload;
      if (!payload) return json({ error: "missing data.payload" }, 400);

      // Only handle genuinely inbound messages. The profile also delivers
      // outbound receipts (message.sent / message.finalized) whose `from` is
      // OUR number — replying to those makes the concierge text itself,
      // which fires another webhook: an infinite self-sustaining loop.
      const eventType = body.data?.event_type ?? "";
      if (eventType && eventType !== "message.received") {
        return new Response("ok");
      }
      const direction = payload.direction as string | undefined;
      if (direction && direction !== "inbound") {
        return new Response("ok");
      }
      const fromSelf =
        payload.from === envVars.TELNYX_SMS_FROM ||
        payload.from === envVars.TELNYX_WHATSAPP_FROM ||
        (typeof payload.from === "object" &&
          (payload.from as { phone_number?: string } | null)?.phone_number ===
            envVars.TELNYX_SMS_FROM);
      if (fromSelf) {
        return new Response("ok");
      }

      // Dedupe: Telnyx redelivers webhooks (e.g. when a handler is slow).
      // Lock on the message id so each message is processed exactly once.
      // (KV keys allow only a-z A-Z 0-9 - _ / = . — hex ids are safe.)
      const msgId =
        (typeof payload.id === "string" && payload.id) ||
        crypto.createHash("sha1").update(Buffer.from(raw)).digest("hex");
      const lockKey = `webhook-seen/${msgId}`;
      const seen = await env.EVENTS.get(lockKey);
      if (seen) return new Response("ok"); // duplicate delivery — no-op
      await env.EVENTS.put(lockKey, "1", { expirationTtl: 600 });

      // Fast-ack: Telnyx retries slow handlers, which previously amplified
      // every inbound message into a flood of replies. Acknowledge instantly,
      // then run the (slow) concierge + lead pipeline in the background.
      const channel = path === "/webhook/sms" ? "sms" : "whatsapp";
      void handleInboundMessage(env, channel, payload).catch((e: unknown) => {
        console.error("background message processing failed:", e);
      });
      return new Response("ok");
    }

    return json({ error: "not found" }, 404);
  },
};
