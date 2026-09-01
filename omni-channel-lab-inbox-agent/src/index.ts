export { InboxAgent } from "./inboxAgent";
import type { InboxAgent } from "./inboxAgent";
import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import Telnyx from "telnyx";
import {
  type Channel,
  type ConversationFilter,
  type ConversationView,
  type DocumentRow,
  type FaxReceivedPayload,
  type MessageView,
  ChannelDisabledError,
  customerIdForChannel,
} from "./types";
import { ADMIN_HTML } from "./adminHtml";
import { DB_HTML } from "./dbHtml";
import { SAMPLE_LAB_PDF_B64 } from "./samplePdf";

/**
 * Stub typing for the actor's RPC surface. Only methods the fetch handler
 * actually calls are listed here; the Agent SDK narrows the rest at runtime.
 */
type InboxAgentStub = ActorStub &
  Pick<
    InboxAgent,
    | "bindVoiceCall"
    | "receiveInbound"
    | "draftReply"
    | "editDraft"
    | "approveDraft"
    | "markSent"
    | "markFailed"
    | "recordHumanReply"
    | "takeOverVoice"
    | "releaseVoice"
    | "listConversations"
    | "listMessages"
    | "dumpTable"
    | "registerCustomer"
    | "listRegisteredCustomers"
    | "receiveFaxDocument"
    | "listDocuments"
    | "getDocumentByReference"
    | "findDocumentByReferenceSuffix"
    | "setPatientEmailByDocument"
    | "getPatientEmailByConversation"
    | "getPatientEmailByDocument"
    | "markResultsEmailed"
    | "markResultsOpened"
    | "bookAppointment"
    | "getLatestAppointment"
    | "completeAppointment"
    | "listAppointments"
    | "resetDemoState"
    | "getPatientRecord"
    | "markDocumentReviewed"
    | "acceptDocument"
    | "rejectDocument"
    | "markFaxDeleted"
    | "draftConfirmationEmail"
    | "documentStatusForReference"
    | "attachEmailTrackingId"
    | "getEmailTrackingId"
    | "setConversationStatus"
    | "assignAgent"
    | "assignOperator"
    | "getDebugState"
  >;

interface InboxAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): InboxAgentStub;
}

interface Env {
  INBOX: InboxAgentNamespace;
}

const TELNYX_API = "https://api.telnyx.com/v2";

/** Telnyx SDK client used for webhook signature verification only — no API key needed. */
const telnyxVerifyClient = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY ?? "unused-webhook-verification-only",
});

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

function getPublicKey(): string | null {
  const key = process.env.TELNYX_PUBLIC_KEY ?? "";
  return key || null;
}

function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true").toLowerCase() === "true";
}

/**
 * Verify the Telnyx Ed25519 signature on an inbound webhook and return the
 * parsed event. In demo mode (DEMO_MODE=true), skips verification and just
 * parses the JSON — useful for local testing without the public key set.
 *
 * ⚠️ The signature is over the exact bytes Telnyx sent — read the raw body
 * with `await request.text()`, never `await request.json()` before verify.
 */
async function verifyWebhook<T = unknown>(req: Request): Promise<T> {
  const body = await req.text();
  if (isDemoMode()) {
    return JSON.parse(body) as T;
  }
  const publicKey = getPublicKey();
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
  })) as T;
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function encodeClientState(state: Record<string, string>): string {
  return btoa(JSON.stringify(state));
}

function decodeClientState(clientState: unknown): Record<string, string> {
  if (typeof clientState !== "string" || !clientState) return {};
  try {
    const decoded = JSON.parse(atob(clientState));
    return decoded && typeof decoded === "object" ? decoded : {};
  } catch {
    return {};
  }
}

function actorNameForCustomer(raw: string): string {
  return (raw ?? "").replace(/[^0-9a-zA-Z]/g, "");
}

/** Parse "Display Name <addr@host>" or bare "addr@host" → "addr@host". */
function extractMailbox(from: string | { email?: string } | undefined): string {
  if (!from) return "unknown";
  if (typeof from === "string") {
    const m = from.match(/<([^>]+)>/);
    return (m?.[1] ?? from).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return (from.email ?? "unknown").toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface TelnyxEmailWebhookPayload {
  data?: {
    event_type?: string;
    id?: string;
    payload?: {
      id?: string;
      from?: string | { email?: string; name?: string | null };
      subject?: string | null;
      text_body?: string | null;
      html_body?: string | null;
      text_body_url?: string | null;
      html_body_url?: string | null;
      headers?: Record<string, string> | null;
      in_reply_to?: string | null;
      references?: string[] | string | null;
    };
  };
}

async function answerCall(
  apiKey: string,
  callControlId: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

async function speakText(
  apiKey: string,
  callControlId: string,
  text: string,
  voice: string,
  stage: "greeting" | "reply" | "human",
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      payload: text,
      voice,
      language: "en-US",
      client_state: encodeClientState({ speak_stage: stage }),
      command_id: `inbox-${stage}-${Date.now()}`,
    }),
  });
}

async function startTranscription(
  apiKey: string,
  callControlId: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transcription_start`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      transcription_tracks: "inbound",
      transcription_engine: "Telnyx",
      command_id: `inbox-transcription-${Date.now()}`,
    }),
  });
}

async function stopTranscription(
  apiKey: string,
  callControlId: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transcription_stop`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ command_id: `inbox-transcription-stop-${Date.now()}` }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        channels: ["voice", "email"],
        from_number: process.env.FROM_NUMBER ?? null,
        voice_assistant_id: process.env.VOICE_ASSISTANT_ID ?? null,
        email_inbox: process.env.TELNYX_EMAIL_INBOX_ID ? "set" : null,
        email_address: process.env.TELNYX_EMAIL_INBOX_ADDRESS ?? null,
      });
    }

    // ── AI Assistant webhook tool (lab document lookup) ────────────────
    if (url.pathname === "/ai-assistant/lookup" && req.method === "POST") {
      return handleAssistantLookup(req, env);
    }

    if (url.pathname === "/sample-lab-report.pdf" && req.method === "GET") {
      const bytes = Uint8Array.from(atob(SAMPLE_LAB_PDF_B64), (c) =>
        c.charCodeAt(0),
      );
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline; filename=sample-lab-report.pdf",
        },
      });
    }

    // ── Webhooks ────────────────────────────────────────────────────────
    if (url.pathname === "/webhooks/voice" && req.method === "POST") {
      return handleVoiceWebhook(req, env);
    }
    if (url.pathname === "/webhooks/email" && req.method === "POST") {
      return handleEmailWebhook(req, env);
    }
    if (url.pathname === "/webhooks/fax" && req.method === "POST") {
      return handleFaxWebhook(req, env);
    }
    if (url.pathname === "/webhooks/messaging" && req.method === "POST") {
      return handleMessagingWebhook(req, env);
    }

    // ── Admin UI ────────────────────────────────────────────────────────
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(ADMIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/admin" && req.method === "GET") {
      return Response.redirect(new URL("/", req.url).toString(), 302);
    }
    if (url.pathname === "/db" && req.method === "GET") {
      return new Response(DB_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname.startsWith("/api/")) {

    if (url.pathname === "/api/conversations" && req.method === "GET") {
      const filter: ConversationFilter = {
        channel: (url.searchParams.get("channel") as Channel | null) ?? undefined,
        status:
          (url.searchParams.get("status") as ConversationFilter["status"]) ??
          undefined,
        limit: url.searchParams.get("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined,
        offset: url.searchParams.get("offset")
          ? Number(url.searchParams.get("offset"))
          : undefined,
      };
      const registryStub = env.INBOX.idFromName("operator-default");
      const customers = await registryStub.listRegisteredCustomers();
      const allConversations: ConversationView[] = [];
      for (const c of customers) {
        const cStub = env.INBOX.idFromName(c.customer_id);
        const rows = await cStub.listConversations(filter);
        allConversations.push(...rows);
      }
      allConversations.sort((a, b) => {
        const at = a.last_message_at ?? a.conversation.created_at;
        const bt = b.last_message_at ?? b.conversation.created_at;
        return bt - at;
      });
      return Response.json({ conversations: allConversations });
    }

    if (url.pathname === "/api/conversations" && req.method === "POST") {
      // Open or switch to a specific customer's inbox (creates the actor).
      const body = (await req.json().catch(() => ({}))) as {
        customer_id?: string;
      };
      if (!body.customer_id) {
        return Response.json({ error: "customer_id is required" }, { status: 400 });
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const rows = await stub.listConversations({});
      return Response.json({ conversations: rows });
    }

    if (url.pathname === "/api/messages" && req.method === "GET") {
      const conversationId = url.searchParams.get("conversation_id");
      if (!conversationId) {
        return Response.json(
          { error: "conversation_id is required" },
          { status: 400 },
        );
      }
      // We don't yet have a customer-id-from-conversation lookup; in v1 the UI
      // opens a specific customer inbox via /api/conversations POST, then asks
      // for messages by conversation id on that same actor. For the cross-customer
      // admin view in v1, we accept the operator-default actor and look up the
      // conversation's customer_id from the row first. For now, the UI passes
      // customer_id as a query param to disambiguate.
      const customerId = url.searchParams.get("customer_id");
      const actorName = customerId
        ? actorNameForCustomer(customerId)
        : "operator-default";
      const stub = env.INBOX.idFromName(actorName);
      const rows: MessageView[] = await stub.listMessages(conversationId);
      return Response.json({ messages: rows });
    }

    if (url.pathname === "/api/draft/edit" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        message_id?: string;
        body?: string;
        customer_id?: string;
      };
      if (!body.message_id || !body.body) {
        return Response.json(
          { error: "message_id and body are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(
        actorNameForCustomer(body.customer_id ?? "operator-default"),
      );
      const updated = await stub.editDraft(body.message_id, body.body);
      if (!updated) {
        return Response.json(
          { error: "message is not a draft" },
          { status: 400 },
        );
      }
      return Response.json({ message: updated });
    }

    if (url.pathname === "/api/draft/approve" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        message_id?: string;
        customer_id?: string;
        to?: string;
        subject?: string;
      };
      if (!body.message_id) {
        return Response.json({ error: "message_id is required" }, { status: 400 });
      }
      let apiKey: string;
      try {
        apiKey = getApiKey();
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "no api key" },
          { status: 500 },
        );
      }
      const stub = env.INBOX.idFromName(
        actorNameForCustomer(body.customer_id ?? "operator-default"),
      );
      const approved = await stub.approveDraft(body.message_id);
      if (!approved) {
        return Response.json(
          { error: "message is not a draft" },
          { status: 400 },
        );
      }
      try {
        await sendApprovedMessage(
          apiKey,
          env,
          {
            ...approved,
            to: body.to ?? null,
            subject: body.subject ?? null,
          },
          stub,
        );
      } catch (e) {
        await stub.markFailed(body.message_id);
        return Response.json(
          {
            error: e instanceof Error ? e.message : "send failed",
            channel: approved.channel,
          },
          { status: 502 },
        );
      }
      await stub.markSent(body.message_id);
      return Response.json({ message: approved, sent: true });
    }

    if (url.pathname === "/api/reply" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        conversation_id?: string;
        customer_id?: string;
        text?: string;
        operator_id?: string;
      };
      if (!body.conversation_id || !body.text || !body.customer_id) {
        return Response.json(
          { error: "conversation_id, customer_id, text are required" },
          { status: 400 },
        );
      }
      let apiKey: string;
      try {
        apiKey = getApiKey();
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "no api key" },
          { status: 500 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const convs: ConversationView[] = await stub.listConversations({});
      const conv = convs.find(
        (c) => c.conversation.id === body.conversation_id,
      );
      if (!conv) {
        return Response.json({ error: "conversation not found" }, { status: 404 });
      }
      const channel = conv.conversation.channel;
      let parentMessageIdHdr: string | null = null;
      if (channel === "email") {
        const msgs: MessageView[] = await stub.listMessages(body.conversation_id);
        const lastInbound = [...msgs]
          .reverse()
          .find((m) => m.message.direction === "inbound" && m.message.channel === "email");
        parentMessageIdHdr = lastInbound?.message.message_id_hdr ?? null;
      }
      try {
        await sendReplyOnChannel(
          apiKey,
          env,
          {
            channel,
            callControlId: null,
            body: body.text,
            conversationId: body.conversation_id,
            customerId: body.customer_id,
            parentMessageIdHdr,
          },
          stub,
        );
      } catch (e) {
        return Response.json(
          {
            error: e instanceof Error ? e.message : "send failed",
            channel,
          },
          { status: 502 },
        );
      }
      const msg = await stub.recordHumanReply({
        conversationId: body.conversation_id,
        channel,
        body: body.text,
        operatorId: body.operator_id ?? "operator-default",
      });
      return Response.json({ message: msg, sent: true });
    }

    if (url.pathname === "/api/takeover" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        conversation_id?: string;
        customer_id?: string;
        operator_id?: string;
        call_control_id?: string;
      };
      if (!body.conversation_id || !body.customer_id) {
        return Response.json(
          { error: "conversation_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      await stub.takeOverVoice(
        body.conversation_id,
        body.operator_id ?? "operator-default",
      );
      // Stop transcription on the live leg if we have the call_control_id.
      if (body.call_control_id) {
        let apiKey: string;
        try {
          apiKey = getApiKey();
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "no api key" },
            { status: 500 },
          );
        }
        try {
          await stopTranscription(apiKey, body.call_control_id);
        } catch {
          // best-effort
        }
      }
      return Response.json({ taken_over: true });
    }

    if (url.pathname === "/api/release" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        conversation_id?: string;
        customer_id?: string;
        call_control_id?: string;
      };
      if (!body.conversation_id || !body.customer_id) {
        return Response.json(
          { error: "conversation_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      await stub.releaseVoice(body.conversation_id);
      if (body.call_control_id) {
        let apiKey: string;
        try {
          apiKey = getApiKey();
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "no api key" },
            { status: 500 },
          );
        }
        try {
          await startTranscription(apiKey, body.call_control_id);
        } catch {
          // best-effort
        }
      }
      return Response.json({ released: true });
    }

    if (url.pathname === "/api/assign-agent" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        conversation_id?: string;
        customer_id?: string;
        agent_id?: string;
      };
      if (!body.conversation_id || !body.customer_id || !body.agent_id) {
        return Response.json(
          { error: "conversation_id, customer_id, agent_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      await stub.assignAgent(body.conversation_id, body.agent_id);
      return Response.json({ assigned: true });
    }

    if (url.pathname === "/api/close" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        conversation_id?: string;
        customer_id?: string;
      };
      if (!body.conversation_id || !body.customer_id) {
        return Response.json(
          { error: "conversation_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      await stub.setConversationStatus(body.conversation_id, "closed");
      return Response.json({ closed: true });
    }

    if (url.pathname === "/api/documents" && req.method === "GET") {
      const all: DocumentRow[] = [];
      const registryStub = env.INBOX.idFromName("operator-default");
      const customers = await registryStub.listRegisteredCustomers();
      for (const c of customers) {
        const cStub = env.INBOX.idFromName(c.customer_id);
        const docs = await cStub.listDocuments();
        all.push(...docs);
      }
      all.sort((a, b) => b.received_at - a.received_at);
      return Response.json({ documents: all });
    }

    if (url.pathname === "/api/document/accept" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        document_id?: string;
        customer_id?: string;
      };
      if (!body.document_id || !body.customer_id) {
        return Response.json(
          { error: "document_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const doc = await stub.acceptDocument(body.document_id);
      if (!doc) {
        return Response.json({ error: "document not found" }, { status: 404 });
      }
      if (doc.fax_id && !doc.fax_id.startsWith("sim-")) {
        const apiKey = getApiKey();
        const delResp = await fetch(`${TELNYX_API}/faxes/${doc.fax_id}`, {
          method: "DELETE",
          headers: authHeaders(apiKey),
        });
        if (!delResp.ok && delResp.status !== 404) {
          const errBody = await delResp.text();
          return Response.json(
            { error: `fax delete failed: ${delResp.status} ${errBody.slice(0, 200)}` },
            { status: 502 },
          );
        }
      }
      const updated = await stub.markFaxDeleted(body.document_id);
      return Response.json({ document: updated });
    }

    if (url.pathname === "/api/document/reject" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        document_id?: string;
        customer_id?: string;
      };
      if (!body.document_id || !body.customer_id) {
        return Response.json(
          { error: "document_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const doc = await stub.rejectDocument(body.document_id);
      if (!doc) {
        return Response.json({ error: "document not found" }, { status: 404 });
      }
      if (doc.fax_id && !doc.fax_id.startsWith("sim-")) {
        const apiKey = getApiKey();
        const delResp = await fetch(`${TELNYX_API}/faxes/${doc.fax_id}`, {
          method: "DELETE",
          headers: authHeaders(apiKey),
        });
        if (!delResp.ok && delResp.status !== 404) {
          const errBody = await delResp.text();
          return Response.json(
            { error: `fax delete failed: ${delResp.status} ${errBody.slice(0, 200)}` },
            { status: 502 },
          );
        }
      }
      const updated = await stub.markFaxDeleted(body.document_id);
      return Response.json({ document: updated });
    }

    if (url.pathname === "/api/document/mark-opened" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        document_id?: string;
        customer_id?: string;
      };
      if (!body.document_id || !body.customer_id) {
        return Response.json(
          { error: "document_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const updated = await stub.markResultsOpened(body.document_id);
      return Response.json({ document: updated });
    }

    if (url.pathname === "/api/appointment/book" && req.method === "POST") {
      const demoPhone = process.env.DEMO_PATIENT_PHONE ?? "";
      const demoName = process.env.DEMO_PATIENT_NAME ?? "there";
      const demoEmail = process.env.DEMO_PATIENT_EMAIL ?? "";
      const body = (await req.json().catch(() => ({}))) as {
        patient_phone?: string;
        patient_name?: string;
        patient_email?: string;
        appointment_time?: string;
        location?: string;
        floor?: string;
        send_sms?: boolean;
      };
      const patientPhone = body.patient_phone ?? demoPhone;
      const patientName = body.patient_name ?? demoName;
      const patientEmail = body.patient_email ?? demoEmail;
      const appointmentTime = body.appointment_time ?? "Friday, Sep 5 at 10:00 AM";
      const location = body.location ?? "500 University Ave, San Francisco";
      const floor = body.floor ?? "Floor 2";

      const actorName = customerIdForChannel("sms", patientPhone);
      const stub = env.INBOX.idFromName(actorName);
      const appt = await stub.bookAppointment({
        patientPhone,
        patientName,
        patientEmail,
        appointmentTime,
        location: `${location}, ${floor}`,
      });
      const registryStub = env.INBOX.idFromName("operator-default");
      await registryStub.registerCustomer(actorName, "sms");

      let smsSent = false;
      let smsError: string | null = null;
      if (body.send_sms !== false) {
        try {
          const apiKey = getApiKey();
          await sendSms(
            apiKey,
            process.env.FROM_NUMBER ?? "",
            patientPhone,
            `Hi ${patientName}! You're booked for ${appointmentTime} — ${floor}, ${location}. Reply with any questions.`,
          );
          smsSent = true;
        } catch (e) {
          smsError = e instanceof Error ? e.message : "sms failed";
        }
      }
      return Response.json({ appointment: appt, sms_sent: smsSent, sms_error: smsError });
    }

    if (url.pathname === "/api/appointment/complete" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        patient_phone?: string;
        appointment_id?: string;
      };
      const patientPhone = body.patient_phone ?? process.env.DEMO_PATIENT_PHONE;
      if (!patientPhone) {
        return Response.json({ error: "patient_phone is required" }, { status: 400 });
      }
      const actorName = customerIdForChannel("sms", patientPhone);
      const stub = env.INBOX.idFromName(actorName);
      const latest = await stub.getLatestAppointment();
      const appointmentId = body.appointment_id ?? latest?.id as string | undefined;
      if (!appointmentId) {
        return Response.json({ error: "no appointment on file" }, { status: 404 });
      }
      const appt = await stub.completeAppointment(appointmentId);

      let smsSent = false;
      let smsError: string | null = null;
      try {
        const apiKey = getApiKey();
        const patientName = (appt?.patient_name as string) ?? "there";
        await sendSms(
          apiKey,
          process.env.FROM_NUMBER ?? "",
          patientPhone,
          `Thanks for coming in today, ${patientName}! Your visit is all set — lab results will land in your email within 1–3 business days.`,
        );
        smsSent = true;
      } catch (e) {
        smsError = e instanceof Error ? e.message : "sms failed";
      }
      return Response.json({ appointment: appt, sms_sent: smsSent, sms_error: smsError });
    }

    if (url.pathname === "/api/demo/reset" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { patient_phone?: string };
      const patientPhone = body.patient_phone ?? process.env.DEMO_PATIENT_PHONE;
      if (!patientPhone) {
        return Response.json({ error: "patient_phone is required" }, { status: 400 });
      }
      const actorName = customerIdForChannel("sms", patientPhone);
      const stub = env.INBOX.idFromName(actorName);
      await stub.resetDemoState();
      return Response.json({ reset: true, actor: actorName });
    }

    if (url.pathname === "/api/appointments" && req.method === "GET") {
      const patientPhone = url.searchParams.get("patient_phone");
      if (patientPhone) {
        const actorName = customerIdForChannel("sms", patientPhone);
        const stub = env.INBOX.idFromName(actorName);
        const appts = await stub.listAppointments();
        return Response.json({ appointments: appts });
      }
      return Response.json({ error: "patient_phone is required" }, { status: 400 });
    }

    if (url.pathname === "/api/patient-record" && req.method === "GET") {
      const patientPhone = url.searchParams.get("patient_phone");
      if (!patientPhone) {
        return Response.json({ error: "patient_phone is required" }, { status: 400 });
      }
      const actorName = customerIdForChannel("sms", patientPhone);
      const stub = env.INBOX.idFromName(actorName);
      const record = await stub.getPatientRecord();
      return Response.json({ record });
    }

    if (url.pathname === "/api/demo/simulate-fax" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { from_number?: string };
      const faxNumber = process.env.FAX_NUMBER ?? "";
      if (!faxNumber) {
        return Response.json({ error: "FAX_NUMBER not configured" }, { status: 500 });
      }
      const fromNumber = body.from_number ?? "";
      const reference = `LAB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
        Math.floor(Math.random() * 900) + 100,
      )}`;
      const actorName = actorNameForCustomer(faxNumber);
      const stub = env.INBOX.idFromName(actorName);
      const state = await stub.getDebugState();
      if (!state.customer_id) {
        await stub.bindVoiceCall({
          callerNumber: faxNumber,
          callerLabel: "Hospital Intake",
          callControlId: `sim-fax-${Date.now()}`,
        });
      }
      const { document } = await stub.receiveFaxDocument({
        faxId: `sim-${Date.now()}`,
        reference,
        faxUrl: `${new URL(req.url).origin}/sample-lab-report.pdf`,
        fileName: "sample-lab-report.pdf",
        fromNumber,
        toNumber: faxNumber,
        pages: 1,
      });
      const demoPatientEmail = process.env.DEMO_PATIENT_EMAIL;
      if (demoPatientEmail) {
        await stub.setPatientEmailByDocument(document.id, demoPatientEmail);
      }
      const registryStub = env.INBOX.idFromName("operator-default");
      await registryStub.registerCustomer(actorName, "fax");
      return Response.json({
        action: "fax_simulated",
        document_id: document.id,
        reference: document.reference,
        patient_email_on_file: demoPatientEmail ?? null,
      });
    }

    if (url.pathname === "/api/email-events" && req.method === "GET") {
      const messageId = url.searchParams.get("message_id");
      if (!messageId) {
        return Response.json({ error: "message_id is required" }, { status: 400 });
      }
      const apiKey = getApiKey();
      const resp = await fetch(
        `${TELNYX_API}/email_messages/${messageId}/events`,
        { headers: authHeaders(apiKey) },
      );
      if (!resp.ok) {
        return Response.json(
          { error: `events fetch failed: ${resp.status}` },
          { status: 502 },
        );
      }
      const data = await resp.json();
      const events = (data.data ?? []).map((e: Record<string, unknown>) => ({
        type: e.type ?? (e as { event_type?: string }).event_type ?? "unknown",
        occurred_at: e.occurred_at ?? null,
        payload: e.payload ?? null,
      }));
      return Response.json({ events });
    }

    if (url.pathname === "/api/document/download" && req.method === "GET") {
      const documentId = url.searchParams.get("document_id");
      const customerId = url.searchParams.get("customer_id");
      if (!documentId || !customerId) {
        return Response.json(
          { error: "document_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(customerId));
      const docs = await stub.listDocuments();
      const doc = docs.find((d) => d.id === documentId);
      if (!doc) {
        return Response.json({ error: "document not found" }, { status: 404 });
      }
      if (doc.status !== "received" && doc.status !== "reviewed") {
        return Response.json(
          {
            error:
              "document no longer available — it has been accepted or rejected and the original fax deleted",
          },
          { status: 410 },
        );
      }
      // First download marks the document reviewed; from then on the operator has
      // seen it and the inbox reflects that state.
      if (doc.status === "received") {
        await stub.markDocumentReviewed(documentId);
      }
      if (!doc.fax_id) {
        return Response.json(
          { error: "fax already deleted — original document no longer available" },
          { status: 410 },
        );
      }
      // Simulated docs have no real Telnyx fax behind them — serve the hosted sample PDF.
      if (doc.fax_id.startsWith("sim-")) {
        const origin = new URL(req.url).origin;
        return Response.redirect(`${origin}/sample-lab-report.pdf`, 302);
      }
      // Real faxes: S3 media URLs expire after 1 hour — mint a fresh one at download
      // time via the refresh action, then fetch the Fax object for the new signed URL.
      const apiKey = getApiKey();
      await fetch(`${TELNYX_API}/faxes/${doc.fax_id}/actions/refresh`, {
        method: "POST",
        headers: authHeaders(apiKey),
      });
      const faxResp = await fetch(`${TELNYX_API}/faxes/${doc.fax_id}`, {
        headers: authHeaders(apiKey),
      });
      if (!faxResp.ok) {
        return Response.json(
          { error: `failed to fetch fax: ${faxResp.status}` },
          { status: 502 },
        );
      }
      const faxObj = (await faxResp.json()).data as Record<string, unknown>;
      const freshUrl = (faxObj.media_url as string) ?? null;
      if (!freshUrl) {
        return Response.json(
          { error: "fax has no media available" },
          { status: 404 },
        );
      }
      return Response.redirect(freshUrl, 302);
    }

    if (url.pathname === "/api/document/patient-email" && req.method === "GET") {
      const conversationId = url.searchParams.get("conversation_id");
      const customerId = url.searchParams.get("customer_id");
      if (!conversationId || !customerId) {
        return Response.json(
          { error: "conversation_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(customerId));
      const email = await stub.getPatientEmailByConversation(conversationId);
      return Response.json({
        email,
        demo_default: process.env.DEMO_PATIENT_EMAIL ?? null,
      });
    }

    if (url.pathname === "/api/document/set-patient-email" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        document_id?: string;
        customer_id?: string;
        email?: string;
      };
      if (!body.document_id || !body.customer_id || !body.email) {
        return Response.json(
          { error: "document_id, customer_id, email are required" },
          { status: 400 },
        );
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
        return Response.json({ error: "invalid email" }, { status: 400 });
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const updated = await stub.setPatientEmailByDocument(body.document_id, body.email);
      return Response.json({ document: updated });
    }

    if (url.pathname === "/api/document/draft-email" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        document_id?: string;
        customer_id?: string;
      };
      if (!body.document_id || !body.customer_id) {
        return Response.json(
          { error: "document_id and customer_id are required" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(body.customer_id));
      const doc = await stub.getDocumentByReference(body.document_id) ??
        (await stub.listDocuments()).find((d) => d.id === body.document_id) ??
        null;
      if (!doc) {
        return Response.json({ error: "document not found" }, { status: 404 });
      }
      const draftBody =
        `Hello,\n\nYour lab document was received and processed successfully.\n\n` +
        `Reference number: ${doc.reference}\n` +
        `Received: ${new Date(doc.received_at).toLocaleString("en-US")}\n\n` +
        `If you have any questions about your case, please reply to this email or call us and mention your reference number.\n\n` +
        `Thank you.`;
      const draft = await stub.draftConfirmationEmail(body.document_id, draftBody);
      return Response.json({ draft });
    }

    if (url.pathname === "/api/db" && req.method === "GET") {
      const customerId = url.searchParams.get("customer_id");
      const table = url.searchParams.get("table") as "conversations" | "messages" | null;
      const conversationId = url.searchParams.get("conversation_id") ?? undefined;
      const limit = url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined;
      const offset = url.searchParams.get("offset")
        ? Number(url.searchParams.get("offset"))
        : undefined;
      if (!customerId) {
        return Response.json(
          { error: "customer_id is required (the actor name to dump)" },
          { status: 400 },
        );
      }
      if (!table || (table !== "conversations" && table !== "messages")) {
        return Response.json(
          { error: "table must be 'conversations' or 'messages'" },
          { status: 400 },
        );
      }
      const stub = env.INBOX.idFromName(actorNameForCustomer(customerId));
      const result = await stub.dumpTable({
        table,
        limit,
        offset,
        conversationId,
      });
      return Response.json(result);
    }

    }

    return new Response("not found", { status: 404 });
  },
};

// ── Voice webhook handler ────────────────────────────────────────────────
async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await verifyWebhook(req);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "webhook verification failed" },
      { status: 401 },
    );
  }
  const event = (body as { data?: Record<string, unknown> })?.data;
  const eventType = event?.event_type as string | undefined;
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  if (!eventType) {
    return Response.json({ error: "no event_type in payload" }, { status: 400 });
  }
  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "secrets not configured" },
      { status: 500 },
    );
  }

  const callControlId = payload.call_control_id as string;
  const callerNumber = (payload.from as string) ?? "unknown";
  const actorName = actorNameForCustomer(callerNumber);
  const stub = env.INBOX.idFromName(actorName);

  // ── call.initiated ──────────────────────────────────────────────────
  if (eventType === "call.initiated") {
    const conv = await stub.bindVoiceCall({
      callerNumber,
      callerLabel: (payload.from as string) ?? null,
      callControlId,
    });
    const registryStub = env.INBOX.idFromName("operator-default");
    await registryStub.registerCustomer(actorName, "voice");
    const answerResp = await answerCall(apiKey, callControlId);
    if (!answerResp.ok) {
      return Response.json(
        { error: "answer_failed", status: answerResp.status },
        { status: 502 },
      );
    }
    return Response.json({ action: "answering", conversation_id: conv.id });
  }

  // ── call.answered ───────────────────────────────────────────────────
  if (eventType === "call.answered") {
    // Greet via TTS. The actor's draftReply path produces the actual first reply
    // after the caller speaks — the greeting is a fixed opener per PRD Section 5.
    const greeting =
      "Hi, this is the Telnyx inbox assistant. How can I help you today?";
    const speakResp = await speakText(
      apiKey,
      callControlId,
      greeting,
      process.env.TTS_VOICE || "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02",
      "greeting",
    );
    if (!speakResp.ok) {
      return Response.json(
        { error: "greeting_speak_failed", status: speakResp.status },
        { status: 502 },
      );
    }
    return Response.json({ action: "greeting" });
  }

  // ── call.speak.ended ───────────────────────────────────────────────
  if (eventType === "call.speak.ended") {
    const stage = decodeClientState(payload.client_state).speak_stage as
      | "greeting"
      | "reply"
      | "human"
      | undefined;
    if (stage === "greeting" || stage === "reply") {
      // Start listening for the caller's next utterance.
      try {
        await stopTranscription(apiKey, callControlId);
        await sleep(300);
      } catch {
        // best-effort
      }
      const transResp = await startTranscription(apiKey, callControlId);
      if (!transResp.ok) {
        return Response.json(
          { error: "transcription_start_failed", status: transResp.status },
          { status: 502 },
        );
      }
      return Response.json({ action: "listening", stage });
    }
    if (stage === "human") {
      // Operator typed reply just finished speaking; resume listening for caller.
      try {
        const transResp = await startTranscription(apiKey, callControlId);
        if (!transResp.ok) {
          return Response.json(
            { error: "transcription_start_failed", status: transResp.status },
            { status: 502 },
          );
        }
      } catch {
        // best-effort
      }
      return Response.json({ action: "listening", stage: "human" });
    }
    return Response.json({ action: "noop", stage });
  }

  // ── call.transcription ─────────────────────────────────────────────
  if (eventType === "call.transcription") {
    const transcriptionData = (payload.transcription_data ?? {}) as {
      transcript?: string;
      is_final?: boolean;
    };
    const fragment = String(transcriptionData.transcript ?? "").trim();
    if (!fragment || transcriptionData.is_final === false || fragment.length < 2) {
      return Response.json({ action: "transcription_accumulated" });
    }
    // Final transcript — record inbound + draft reply.
    // If the caller mentioned a LAB- reference, look up the document status
    // and inject it into the conversation context so the AI can answer.
    const refMatch = fragment.match(LAB_REFERENCE_RE);
    if (refMatch) {
      const reference = refMatch[0].toUpperCase();
      const registryStub = env.INBOX.idFromName("operator-default");
      const customers = await registryStub.listRegisteredCustomers();
      for (const c of customers) {
        const cStub = env.INBOX.idFromName(c.customer_id);
        const status = await cStub.documentStatusForReference(reference);
        if (status) {
          await stub.receiveInbound({
            channel: "voice",
            body: `[System note] Caller asked about lab document ${reference}. Lookup result: ${status}`,
            callControlId,
          });
          break;
        }
      }
    }
    const { draft } = await stub.receiveInbound({
      channel: "voice",
      body: fragment,
      callControlId,
    });
    // Stop transcription before speaking (Telnyx drops speak if transcription is active).
    try {
      await stopTranscription(apiKey, callControlId);
      await sleep(800);
    } catch {
      await sleep(800);
    }
    if (draft) {
      const speakResp = await speakText(
        apiKey,
        callControlId,
        draft.body,
        process.env.TTS_VOICE || "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02",
        "reply",
      );
      if (!speakResp.ok) {
        await stub.markFailed(draft.id);
        return Response.json(
          { error: "reply_speak_failed", status: speakResp.status },
          { status: 502 },
        );
      }
      await stub.markSent(draft.id);
    }
    return Response.json({ action: "replying", draft_id: draft?.id ?? null });
  }

  // ── call.hangup ─────────────────────────────────────────────────────
  if (eventType === "call.hangup") {
    // Look up the conversation by the actor (one per customer). In v1 with the
    // bindVoiceCall pattern, the actor has the open_conversation_id in state.
    const state = await stub.getDebugState();
    if (state.open_conversation_id) {
      await stub.setConversationStatus(state.open_conversation_id, "closed");
    }
    return Response.json({ action: "hungup" });
  }

  return Response.json({ action: "noop", event: eventType });
}

// ── Email webhook (native Telnyx Email API — Ed25519-signed) ─────────────
async function handleEmailWebhook(req: Request, env: Env): Promise<Response> {
  let payload: TelnyxEmailWebhookPayload;
  try {
    payload = await verifyWebhook<TelnyxEmailWebhookPayload>(req);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Telnyx webhook verification failed" },
      { status: 401 },
    );
  }

  if (payload.data?.event_type !== "email.received") {
    return Response.json({ action: "ignored", event_type: payload.data?.event_type });
  }

  const m = payload.data.payload ?? {};
  const fromEmail = extractMailbox(m.from);
  const subject = m.subject ?? "(no subject)";
  const bodyText = await resolveTelnyxEmailBody(m);
  const referencesHdr = Array.isArray(m.references)
    ? m.references.join(" ")
    : (m.references ?? m.headers?.references ?? null);

  const customerActorName = customerIdForChannel("email", fromEmail);
  const stub = env.INBOX.idFromName(customerActorName);
  try {
    await stub.receiveInbound({
      channel: "email",
      body: bodyText,
      subject,
      customerLabel: fromEmail,
      messageIdHdr: m.id ?? null,
      inReplyTo: m.in_reply_to ?? m.headers?.["in-reply-to"] ?? null,
      referencesHdr,
    });
    const registryStub = env.INBOX.idFromName("operator-default");
    await registryStub.registerCustomer(customerActorName, "email");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "store failed" },
      { status: 500 },
    );
  }
  return Response.json({ action: "stored", event_id: payload.data.id });
}

async function resolveTelnyxEmailBody(
  message: NonNullable<NonNullable<TelnyxEmailWebhookPayload["data"]>["payload"]>,
): Promise<string> {
  if (message.text_body) return message.text_body;
  if (message.text_body_url) {
    const response = await fetch(message.text_body_url);
    if (response.ok) return response.text();
  }
  if (message.html_body) return message.html_body;
  if (message.html_body_url) {
    const response = await fetch(message.html_body_url);
    if (response.ok) return response.text();
  }
  return "(no body)";
}

// ── Fax webhook (lab result intake) ──────────────────────────────────────
interface TelnyxFaxWebhookPayload {
  data?: {
    event_type?: string;
    id?: string;
    payload?: FaxReceivedPayload & { to?: string; from?: string };
  };
}

const LAB_REFERENCE_RE = /LAB-\d{8}-\d{3}/i;

/** Normalize a user-supplied reference into a canonical LAB-YYYYMMDD-NNN, tolerating
 *  spoken variants: missing LAB- prefix, spaces, dashes. Returns null if unusable. */
function normalizeLabReference(raw: string): string | null {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return null;
  const m = cleaned.match(/^LAB(\d{8})(\d{3})$/);
  if (m) return `LAB-${m[1]}-${m[2]}`;
  const digits = cleaned.replace(/^LAB/, "");
  if (/^\d{11}$/.test(digits)) return `LAB-${digits.slice(0, 8)}-${digits.slice(8)}`;
  if (/^\d{3}$/.test(digits)) return `__SUFFIX__${digits}`;
  if (/^\d{3}$/.test(cleaned)) return `__SUFFIX__${cleaned}`;
  return null;
}

/**
 * AI Assistant tool callback: look up a lab document by case reference.
 * Called by the assistant's webhook tool during a live call. Also scans
 * freeform text for a LAB- reference so it works regardless of payload shape.
 */
async function handleAssistantLookup(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const directReference =
    (body.reference as string) ??
    ((body.params as Record<string, unknown> | undefined)?.reference as string) ??
    ((body.data as Record<string, unknown> | undefined)?.reference as string) ??
    "";

  const haystack = JSON.stringify(body);
  const regexMatch = directReference?.match(LAB_REFERENCE_RE) ?? haystack.match(LAB_REFERENCE_RE);
  const normalized = normalizeLabReference(directReference || regexMatch?.[0] || "");
  if (!normalized) {
    return Response.json({
      result: "No case reference found. Please ask the caller for their reference number.",
      found: false,
    });
  }

  const registryStub = env.INBOX.idFromName("operator-default");
  const customers = await registryStub.listRegisteredCustomers();

  let doc: { reference: string; status: string; received_at: number; deleted_at: number | null; email_sent_at: number | null; emailed_to: string | null } | null = null;
  let usedReference = normalized;

  if (normalized.startsWith("__SUFFIX__")) {
    const suffix = normalized.replace("__SUFFIX__", "");
    for (const c of customers) {
      const cStub = env.INBOX.idFromName(c.customer_id);
      const found = await cStub.findDocumentByReferenceSuffix(suffix);
      if (found) {
        doc = found;
        usedReference = found.reference;
        break;
      }
    }
  } else {
    for (const c of customers) {
      const cStub = env.INBOX.idFromName(c.customer_id);
      const found = await cStub.getDocumentByReference(normalized);
      if (found) {
        doc = found;
        break;
      }
    }
  }

  if (doc) {
    const receivedDate = new Date(doc.received_at).toLocaleDateString("en-US");
    let result: string;
    if (doc.emailed_to && doc.email_sent_at) {
      const sentDate = new Date(doc.email_sent_at).toLocaleDateString("en-US");
      result =
        `Reference ${doc.reference}: the lab document was received on ${receivedDate}, processed, and the results were already emailed to the patient on ${sentDate} (to ${doc.emailed_to}). ` +
        `Tell the patient their results were already sent to their email inbox — ask them to check their email, including spam. This line cannot provide the results themselves.`;
    } else {
      result =
        `Reference ${doc.reference}: the lab document was received on ${receivedDate} and is being processed. ` +
        `The results have not been emailed yet — tell the patient staff will email them shortly. This line cannot provide the results themselves.`;
    }
    return Response.json({
      result,
      found: true,
      reference: doc.reference,
      status: doc.status,
      emailed_to: doc.emailed_to,
      email_sent_at: doc.email_sent_at,
    });
  }
  return Response.json({
    result: `No lab document found for ${usedReference}. Apologize to the caller, ask them to double-check the reference number, and if it still cannot be found offer to connect them with staff.`,
    found: false,
    reference: usedReference,
  });
}

async function handleFaxWebhook(req: Request, env: Env): Promise<Response> {
  let payload: TelnyxFaxWebhookPayload;
  try {
    payload = await verifyWebhook<TelnyxFaxWebhookPayload>(req);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "fax webhook verification failed" },
      { status: 401 },
    );
  }

  const eventType = payload.data?.event_type ?? "";
  if (eventType !== "fax.ended") {
    return Response.json({ action: "ignored", event_type: eventType });
  }
  const p = (payload.data?.payload ?? {}) as FaxReceivedPayload & {
    to?: string;
    from?: string;
  };
  const faxStatus = p.status ?? "";
  if (faxStatus !== "received") {
    return Response.json({ action: "ignored", fax_status: faxStatus });
  }

  const faxId = p.id ?? payload.data?.id ?? "";
  const toNumber = p.to ?? process.env.FAX_NUMBER ?? "";
  const fromNumber = p.from ?? "unknown";

  // Inbound fax webhooks do NOT carry the media URL — fetch the Fax object
  // to get the real signed media_url for the PDF.
  let mediaUrl: string | null = null;
  let pageCount: number | null = p.pages ?? null;
  const apiKey = getApiKey();
  const faxResp = await fetch(`${TELNYX_API}/faxes/${faxId}`, {
    headers: authHeaders(apiKey),
  });
  if (faxResp.ok) {
    const faxObj = (await faxResp.json()).data as Record<string, unknown>;
    mediaUrl = (faxObj.media_url as string) ?? null;
    if (faxObj.pages) pageCount = faxObj.pages as number;
  }

  const reference = `LAB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
    Math.floor(Math.random() * 900) + 100,
  )}`;

  const actorName = actorNameForCustomer(toNumber);
  const stub = env.INBOX.idFromName(actorName);
  const state = await stub.getDebugState();
  if (!state.customer_id) {
    await stub.bindVoiceCall({
      callerNumber: toNumber,
      callerLabel: "Hospital Intake",
      callControlId: `fax-${faxId}`,
    });
  }

  const { document } = await stub.receiveFaxDocument({
    faxId,
    reference,
    faxUrl: mediaUrl,
    fileName: `fax-${faxId}.pdf`,
    fromNumber,
    toNumber,
    pages: pageCount,
  });

  const registryStub = env.INBOX.idFromName("operator-default");
  await registryStub.registerCustomer(actorName, "fax");

  return Response.json({
    action: "fax_stored",
    document_id: document.id,
    reference: document.reference,
  });
}

// ── Messaging webhook stub (v2) ──────────────────────────────────────────
async function handleMessagingWebhook(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await verifyWebhook(req);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "webhook verification failed" },
      { status: 401 },
    );
  }
  const event = (body as { data?: Record<string, unknown> })?.data;
  const eventType = (event?.event_type as string) ?? "";
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  const fromNumber = (payload.from as string) ?? "unknown";
  const toNumber = (payload.to as string) ?? "";
  const text = (payload.text as string) ?? "";

  if (eventType !== "message.received") {
    return Response.json({ action: "ignored", event_type: eventType });
  }

  const actorName = customerIdForChannel("sms", fromNumber);
  const stub = env.INBOX.idFromName(actorName);
  try {
    await stub.receiveInbound({
      channel: "sms",
      body: text,
      customerLabel: fromNumber,
    });
    const registryStub = env.INBOX.idFromName("operator-default");
    await registryStub.registerCustomer(actorName, "sms");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "store failed" },
      { status: 500 },
    );
  }

  // Auto-answer inbound SMS — short, conversational, specific to the patient's
  // own record. Clinical questions escalate per the assistant's rules.
  const apiKey = getApiKey();
  const record = await stub.getPatientRecord();
  const lower = text.toLowerCase();
  const appt = record.appointment as Record<string, unknown> | null;
  const location = (appt?.location as string) ?? "500 University Ave";
  const floorMatch = location.match(/Floor \d/i);
  const floor = floorMatch ? floorMatch[0] : "Floor 2";
  let reply: string;

  if (/floor|which floor|what floor/.test(lower)) {
    reply = `Floor 2 — elevator's just past the main entrance. See you Friday!`;
  } else if (/where|located|location|address|directions|parking/.test(lower)) {
    reply = `We're at ${location} — you're on ${floor}. Parking's in the garage downstairs.`;
  } else if (/received|status|results|lab|reference|LAB-\d/i.test(text)) {
    const emailedDoc = record.lab_documents.find((d) => d.email_sent_at);
    if (emailedDoc) {
      const sentDate = new Date(emailedDoc.email_sent_at as number).toLocaleDateString("en-US");
      reply = `Good news — your results went to your email on ${sentDate}! Check spam if they're not in your inbox. Can't share them over text, but staff can help.`;
    } else {
      reply = "Nothing sent yet — results usually land in your email 1–3 business days after your visit. I'll flag it if there's a delay.";
    }
  } else if (/appointment|reschedule|cancel|time|when/.test(lower)) {
    if (appt) {
      reply = `You're all set for ${appt.appointment_time} — ${floor}, ${location}. Need to change anything?`;
    } else {
      reply = "I don't see an appointment on file yet — staff will reach out to get one booked for you.";
    }
  } else if (/thank|thanks|thx/.test(lower)) {
    reply = "Anytime! 👋";
  } else if (/hi|hello|hey/.test(lower) && lower.length < 12) {
    reply = "Hey! What can I help you with — appointment, directions, or lab results?";
  } else {
    reply = "I can help with appointment info, directions, or lab result status — medical questions go to our staff, they'll follow up!";
  }

  await sendSms(apiKey, toNumber || (process.env.FROM_NUMBER ?? ""), fromNumber, reply);

  // Mirror the outbound reply into the conversation.
  try {
    const convs = await stub.listConversations({ channel: "sms", limit: 1 });
    const convId = convs[0]?.conversation.id;
    if (convId) {
      await stub.recordHumanReply({
        conversationId: convId,
        channel: "sms",
        body: reply,
        operatorId: "ai-agent",
      });
    }
  } catch {
    // conversation may not exist yet on first contact — inbound was already stored
  }

  return Response.json({ action: "sms_replied", reply });
}

async function sendSms(
  apiKey: string,
  from: string,
  to: string,
  text: string,
): Promise<void> {
  const resp = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ from, to, text }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`SMS send failed: ${resp.status} ${err.slice(0, 200)}`);
  }
}

// ── Channel send dispatch ─────────────────────────────────────────────────
async function sendApprovedMessage(
  apiKey: string,
  env: Env,
  msg: {
    id: string;
    channel: Channel;
    body: string;
    call_control_id: string | null;
    conversation_id: string;
    message_id_hdr: string | null;
    to?: string | null;
    subject?: string | null;
  },
  stub: InboxAgentStub,
): Promise<void> {
  if (msg.channel === "voice") {
    if (!msg.call_control_id) {
      throw new Error(
        "voice send requires call_control_id — pass it via the conversation's last inbound message",
      );
    }
    const resp = await speakText(
      apiKey,
      msg.call_control_id,
      msg.body,
      process.env.TTS_VOICE || "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02",
      "reply",
    );
    if (!resp.ok) {
      throw new Error(`tts failed: ${resp.status}`);
    }
    return;
  }
  if (msg.channel === "email") {
    await telnyxEmailSendReply(apiKey, {
      id: msg.id,
      body: msg.body,
      conversation_id: msg.conversation_id,
      message_id_hdr: msg.message_id_hdr,
      subject: msg.subject ?? null,
      to: msg.to ?? null,
    }, stub);
    if (msg.to && msg.conversation_id) {
      const docs = await stub.listDocuments();
      const linkedDoc = docs.find((d) => d.conversation_id === msg.conversation_id);
      if (linkedDoc) {
        await stub.markResultsEmailed(linkedDoc.id, msg.to);
      }
    }
    return;
  }
  throw new ChannelDisabledError(msg.channel, "v1");
}

async function sendReplyOnChannel(
  apiKey: string,
  env: Env,
  args: {
    channel: Channel;
    callControlId: string | null;
    body: string;
    conversationId?: string;
    customerId?: string;
    parentMessageIdHdr?: string | null;
  },
  stub?: InboxAgentStub,
): Promise<void> {
  if (args.channel === "voice") {
    if (!args.callControlId) {
      throw new Error(
        "voice reply requires call_control_id — use /api/takeover with the live call id",
      );
    }
    const resp = await speakText(
      apiKey,
      args.callControlId,
      args.body,
      process.env.TTS_VOICE || "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02",
      "human",
    );
    if (!resp.ok) {
      throw new Error(`tts failed: ${resp.status}`);
    }
    return;
  }
  if (args.channel === "email") {
    await telnyxEmailSendReply(
      apiKey,
      {
        id: "",
        body: args.body,
        conversation_id: args.conversationId ?? "",
        message_id_hdr: args.parentMessageIdHdr ?? null,
      },
      stub,
    );
    return;
  }
  throw new ChannelDisabledError(args.channel, "v1");
}

/**
 * Reply through the native Telnyx Email Inbox API. The inbound Telnyx message
 * resource id is persisted in message_id_hdr so the API can thread the reply.
 */
async function telnyxEmailSendReply(
  apiKey: string,
  msg: {
    id: string;
    body: string;
    conversation_id: string;
    message_id_hdr: string | null;
    subject?: string | null;
    to?: string | null;
  },
  stub?: InboxAgentStub,
): Promise<void> {
  const fromEmail = process.env.EMAIL_FROM || process.env.AGENTMAIL_INBOX;
  if (!fromEmail) throw new Error("EMAIL_FROM not configured");

  const parentMessageId = msg.message_id_hdr;

  if (parentMessageId) {
    const inbox = process.env.TELNYX_EMAIL_INBOX_ID;
    if (!inbox) throw new Error("TELNYX_EMAIL_INBOX_ID not configured");
    const resp = await fetch(
      `${TELNYX_API}/email_inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(parentMessageId)}/actions/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ text: msg.body }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Telnyx Email reply ${resp.status}: ${await resp.text()}`);
    }
    return;
  }

  const to = msg.to;
  if (!to) throw new Error("email send requires a recipient (to)");

  const resp = await fetch(`${TELNYX_API}/email_messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: msg.subject ?? "Update on your lab document",
      text_body: msg.body,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Telnyx Email send ${resp.status}: ${await resp.text()}`);
  }
  const sentData = await resp.json();
  const telnyxEmailId =
    (sentData as { data?: { id?: string } }).data?.id ?? null;
  if (telnyxEmailId && stub && msg.id) {
    await stub.attachEmailTrackingId(msg.id, telnyxEmailId);
  }
}
