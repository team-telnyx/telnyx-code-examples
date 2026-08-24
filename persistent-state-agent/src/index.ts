import { BRAND_VERSION, demoHtml } from "./demo-html.js";
import { CustomerAgent, CustomerAgentLangGraphV2 } from "./customer-agent.js";
import { verifyAndParseWebhook, parseWebhookBody } from "./webhook.js";
import { verifyAgentMailWebhook, parseAgentMailInbound } from "./agent-mail.js";
import {
  actorNameForCustomer,
  demoCustomerName,
  demoCustomerSalesforceId,
  demoFromNumber,
  demoSenderNumber,
  demoUiEnabled,
  normalizePhoneE164,
  smsTransportEnabled,
} from "./types.js";
import type { Env, SalesforceUpdateInput, TelnyxMessageWebhook } from "./types.js";
import type {
  HumanEscalationInput,
  HumanReplyInput,
  LeadUpdateInput,
  ScheduleFollowupInput,
  VoiceCallInput,
  SdrConfirmationInput,
  SdrReplyInput,
  CallResultInput,
  SalesforceLeadChangeInput,
  Intent,
} from "./types.js";

export { CustomerAgent };
export { CustomerAgentLangGraphV2 };

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

function customerForPhone(env: Env, phone: string) {
  const normalized = normalizePhoneE164(phone, demoSenderNumber(env));
  const actorName = actorNameForCustomer(normalized);
  if (!actorName) {
    throw new Error(`Cannot derive actor name for phone: ${phone}`);
  }
  return { customer: env.CUSTOMERS.idFromName(actorName), phone_e164: normalized };
}

async function parseJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

async function parseJsonOrForm<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return parseJson<T>(request);

  const form = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    out[key] = typeof value === "string" ? value : value.name;
  }
  return out as T;
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  if (!demoUiEnabled(env)) return new Response("not found", { status: 404 });

  const body = await parseJson<{ text?: string; from?: string }>(request);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const from = normalizePhoneE164(body.from, demoSenderNumber(env));
  const to = demoFromNumber(env);

  if (!text) return badRequest("text is required");
  if (!from) return badRequest("from must be E.164, for example +14155550100");

  const { customer } = customerForPhone(env, from);
  await customer.receive({
    text,
    from,
    to,
    eventId: `demo:${crypto.randomUUID()}`,
  });

  return json({ ok: true });
}

async function handleEvents(request: Request, env: Env): Promise<Response> {
  if (!demoUiEnabled(env)) return new Response("not found", { status: 404 });

  const url = new URL(request.url);
  const from = normalizePhoneE164(url.searchParams.get("from"), demoSenderNumber(env));
  const limit = Number(url.searchParams.get("limit") || "50");
  const { customer } = customerForPhone(env, from);
  const events = await customer.getEvents(limit);

  return json(events);
}

async function handleContext(request: Request, env: Env): Promise<Response> {
  if (!demoUiEnabled(env)) return new Response("not found", { status: 404 });

  const url = new URL(request.url);
  const from = normalizePhoneE164(url.searchParams.get("phone"), demoSenderNumber(env));
  const { customer } = customerForPhone(env, from);
  const ctx = await customer.getContext();

  return json({
    phone_e164: ctx.customer.phone_e164,
    customer: ctx.customer,
    history: ctx.history,
    demo: {
      default_customer_name: demoCustomerName(env),
      default_salesforce_id: demoCustomerSalesforceId(env),
    },
  });
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  let hook: TelnyxMessageWebhook;

  try {
    hook = smsTransportEnabled(env)
      ? await verifyAndParseWebhook(body, request, env)
      : await parseWebhookBody(body);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid webhook" },
      { status: 401 },
    );
  }

  if (hook.data.event_type !== "message.received") {
    return json({ ignored: true, event_type: hook.data.event_type });
  }

  const from = hook.data.payload.from.phone_number;
  const to = hook.data.payload.to[0]?.phone_number || "";
  const text = hook.data.payload.text || "";
  const eventId = hook.data.id;

  if (!from || !to || !text || !eventId) return badRequest("Invalid message.received payload");

  const normalizedFrom = normalizePhoneE164(from, "");
  if (!normalizedFrom) return badRequest("from must be E.164");

  const { customer } = customerForPhone(env, normalizedFrom);
  await customer.receive({ text, from: normalizedFrom, to, eventId });
  return json({ ok: true, actor: actorNameForCustomer(normalizedFrom) });
}

async function handleSalesforceWebhook(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<SalesforceUpdateInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, "");
  if (!phone) return badRequest("phone_e164 must be E.164");
  if (!body.order_id || !body.salesforce_id || !body.status) {
    return badRequest("order_id, salesforce_id, and status are required");
  }

  const { customer } = customerForPhone(env, phone);
  await customer.ingestSalesforceUpdate({
    phone_e164: phone,
    order_id: body.order_id,
    salesforce_id: body.salesforce_id,
    status: body.status,
    tracking_number: body.tracking_number,
    estimated_delivery: body.estimated_delivery,
  });

  return json({ ok: true, actor: actorNameForCustomer(phone) });
}

async function handleSalesforceLeadUpdate(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<LeadUpdateInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, demoSenderNumber(env));
  if (!phone) return badRequest("phone_e164 must be E.164");

  const { customer } = customerForPhone(env, phone);
  const result = await customer.updateLeadFromAgent({
    phone_e164: phone,
    lead_id: typeof body.lead_id === "string" ? body.lead_id : undefined,
    field: typeof body.field === "string" ? body.field : undefined,
    value: typeof body.value === "string" ? body.value : undefined,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    send_sms: typeof body.send_sms === "boolean" ? body.send_sms : undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

async function handleHumanEscalation(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<HumanEscalationInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, demoSenderNumber(env));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!phone) return badRequest("phone_e164 must be E.164");
  if (!reason) return badRequest("reason is required");

  const { customer } = customerForPhone(env, phone);
  const result = await customer.requestHumanEscalation({ phone_e164: phone, reason });
  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

async function handleHumanReply(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<HumanReplyInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, demoSenderNumber(env));
  const replyText = typeof body.reply_text === "string" ? body.reply_text.trim() : "";
  if (!phone) return badRequest("phone_e164 must be E.164");
  if (!replyText) return badRequest("reply_text is required");

  const { customer } = customerForPhone(env, phone);
  await customer.resumeHumanEscalation({ phone_e164: phone, reply_text: replyText });
  return json({ ok: true, actor: actorNameForCustomer(phone) });
}

async function handleScheduleFollowup(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<ScheduleFollowupInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, demoSenderNumber(env));
  if (!phone) return badRequest("phone_e164 must be E.164");

  const { customer } = customerForPhone(env, phone);
  const result = await customer.scheduleLeadFollowup({
    phone_e164: phone,
    delay_seconds: typeof body.delay_seconds === "number" ? body.delay_seconds : undefined,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  });
  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

async function handleAgentMailWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let payload;
  try {
    payload = await verifyAgentMailWebhook(rawBody, headers, env);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid AgentMail webhook signature" },
      { status: 401 },
    );
  }

  if (payload.event_type !== "message.received") {
    return json({ ignored: true, event_type: payload.event_type });
  }

  let parsed;
  try {
    parsed = parseAgentMailInbound(payload);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Failed to parse AgentMail inbound" },
      { status: 400 },
    );
  }

  const phone = normalizePhoneE164(
    typeof request.headers.get("x-customer-phone") === "string"
      ? request.headers.get("x-customer-phone")
      : "",
    demoSenderNumber(env),
  );
  const { customer } = customerForPhone(env, phone);
  const result = await customer.ingestSdrReply({
    phone_e164: phone,
    from: parsed.from,
    reply_text: parsed.text,
    thread_id: parsed.thread_id,
    message_id: parsed.message_id,
    in_reply_to: parsed.in_reply_to ?? undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

async function handleSdrEmail(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<SdrConfirmationInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, demoSenderNumber(env));
  if (!phone) return badRequest("phone_e164 must be E.164");

  const { customer } = customerForPhone(env, phone);
  const result = await customer.emailSdrForConfirmation({
    phone_e164: phone,
    lead_id: typeof body.lead_id === "string" ? body.lead_id : undefined,
    requested_time: typeof body.requested_time === "string" ? body.requested_time : undefined,
    customer_name: typeof body.customer_name === "string" ? body.customer_name : undefined,
    customer_context: typeof body.customer_context === "string" ? body.customer_context : undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

async function handleCallResult(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<CallResultInput>>(request);
  const from = normalizePhoneE164(body.from, "");
  if (!from) return badRequest("from must be E.164");
  if (!body.intent) return badRequest("intent is required");

  const { customer } = customerForPhone(env, from);
  const result = await customer.ingestCallResult({
    from,
    to: typeof body.to === "string" ? body.to : undefined,
    call_control_id: typeof body.call_control_id === "string" ? body.call_control_id : undefined,
    call_session_id: typeof body.call_session_id === "string" ? body.call_session_id : undefined,
    intent: body.intent as Intent,
    requested_meeting_time: typeof body.requested_meeting_time === "string" ? body.requested_meeting_time : undefined,
    customer_name: typeof body.customer_name === "string" ? body.customer_name : undefined,
    customer_email: typeof body.customer_email === "string" ? body.customer_email : undefined,
    customer_phone: typeof body.customer_phone === "string" ? body.customer_phone : undefined,
    customer_context: typeof body.customer_context === "string" ? body.customer_context : undefined,
    customer_approved: typeof body.customer_approved === "boolean" ? body.customer_approved : undefined,
    meeting_time: typeof body.meeting_time === "string" ? body.meeting_time : undefined,
    transcript_summary: typeof body.transcript_summary === "string" ? body.transcript_summary : undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(from), result });
}

async function handleCallContext(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const from = normalizePhoneE164(url.searchParams.get("from"), "");
  if (!from) return badRequest("from must be E.164");

  const { customer } = customerForPhone(env, from);
  const context = await customer.getCallContext(from);

  return json(context);
}

async function handleSalesforceLeadChange(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Partial<SalesforceLeadChangeInput>>(request);
  const phone = normalizePhoneE164(body.phone_e164, "");
  if (!phone) return badRequest("phone_e164 must be E.164");
  if (!body.lead_id) return badRequest("lead_id is required");

  const { customer } = customerForPhone(env, phone);
  const result = await customer.ingestSalesforceLeadChange({
    phone_e164: phone,
    lead_id: body.lead_id,
    meeting_time: typeof body.meeting_time === "string" ? body.meeting_time : body.meeting_time ?? undefined,
    meeting_status: typeof body.meeting_status === "string" ? body.meeting_status : undefined,
    assigned_sdr: typeof body.assigned_sdr === "string" ? body.assigned_sdr : undefined,
    requested_meeting_time: typeof body.requested_meeting_time === "string" ? body.requested_meeting_time : body.requested_meeting_time ?? undefined,
    customer_context: typeof body.customer_context === "string" ? body.customer_context : undefined,
    shipment: typeof body.shipment === "string" ? body.shipment : undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(phone), result });
}

interface AssistantInitPayload {
  data?: {
    event_type?: string;
    payload?: {
      telnyx_end_user_target?: string;
      telnyx_agent_target?: string;
      call_control_id?: string;
    };
  };
}

async function handleAiAssistant(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<Record<string, unknown>>(request);

  if (body.data && typeof body.data === "object") {
    const eventData = body.data as { event_type?: string; payload?: Record<string, unknown> };
    if (eventData.event_type === "assistant.initialization") {
      return handleAssistantInitialization(eventData.payload ?? {}, env);
    }
  }

  return handleAssistantToolCall(body, env);
}

async function handleAssistantInitialization(
  payload: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const callerPhone = normalizePhoneE164(
    payload.telnyx_end_user_target,
    demoSenderNumber(env),
  );
  if (!callerPhone) {
    return json({ dynamic_variables: { caller_phone: "", is_returning_caller: false } });
  }

  const { customer } = customerForPhone(env, callerPhone);
  const ctx = await customer.getCallContext(callerPhone);

  let greetingText: string;
  if (ctx.salesforce_manually_changed && ctx.new_meeting_time) {
    greetingText = `Hi ${ctx.name || "there"}, I see your sales meeting with Steve was rescheduled to ${ctx.new_meeting_time}. Is that what you're calling about?`;
  } else if (ctx.is_returning_caller && ctx.assigned_sdr) {
    greetingText = `Hi ${ctx.name || "there"}, thanks for calling Telnyx again. How can I help you with your meeting with ${ctx.assigned_sdr}?`;
  } else {
    greetingText = `Hi! Thanks for calling Telnyx. We are an AI communications infrastructure platform with telephony, voice AI, and messaging. You can even build your own voice agents. What would you like to learn more about?`;
  }

  return json({
    dynamic_variables: {
      caller_phone: ctx.phone_e164 || callerPhone,
      customer_name: ctx.name || "there",
      is_returning_caller: ctx.is_returning_caller,
      assigned_sdr: ctx.assigned_sdr ?? "",
      meeting_status: ctx.meeting_status ?? "",
      original_meeting_time: ctx.original_confirmed_meeting_time ?? ctx.original_requested_meeting_time ?? "",
      new_meeting_time: ctx.new_meeting_time ?? "",
      salesforce_manually_changed: ctx.salesforce_manually_changed,
      proactive_sms_sent: ctx.proactive_sms_sent,
      sdr_confirmation: ctx.sdr_confirmation ?? "",
      narrative_summary: ctx.narrative_summary,
      likely_reason_for_call: ctx.likely_reason_for_call,
      greeting_text: greetingText,
    },
  });
}

async function handleAssistantToolCall(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const from = normalizePhoneE164(body.caller_phone ?? body.from, "");
  if (!from) return badRequest("caller_phone or from must be E.164");
  if (!body.intent) return badRequest("intent is required");

  const { customer } = customerForPhone(env, from);
  const result = await customer.ingestCallResult({
    from,
    intent: body.intent as Intent,
    requested_meeting_time: typeof body.requested_meeting_time === "string" ? body.requested_meeting_time : undefined,
    customer_name: typeof body.customer_name === "string" ? body.customer_name : undefined,
    customer_email: typeof body.customer_email === "string" ? body.customer_email : undefined,
    customer_phone: typeof body.customer_phone === "string" ? body.customer_phone : undefined,
    customer_context: typeof body.customer_context === "string" ? body.customer_context : undefined,
    customer_approved: typeof body.customer_approved === "boolean" ? body.customer_approved : undefined,
    meeting_time: typeof body.meeting_time === "string" ? body.meeting_time : undefined,
    transcript_summary: typeof body.transcript_summary === "string" ? body.transcript_summary : undefined,
  });

  return json({ ok: true, actor: actorNameForCustomer(from), result });
}

async function handleVoiceCall(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonOrForm<Record<string, unknown>>(request);
  const voice = voiceInputFromBody(body, env);
  const from = voice.from;
  const to = voice.to;
  if (!from) return badRequest("from must be E.164");
  if (!to) return badRequest("to must be E.164");

  const input: VoiceCallInput = {
    from,
    to,
    call_control_id: voice.call_control_id,
    call_session_id: voice.call_session_id,
  };
  const { customer } = customerForPhone(env, from);
  const result = await customer.onCall(input);

  const wantsJson = request.headers.get("accept")?.includes("application/json")
    || request.headers.get("content-type")?.includes("application/json");
  if (wantsJson) return json({ ok: true, actor: actorNameForCustomer(from), result });

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(result.prompt)}</Say></Response>`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
}

async function handleCallEnded(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonOrForm<Record<string, unknown>>(request);
  const eventType = typeof body.event_type === "string"
    ? body.event_type
    : typeof (body.data as { event_type?: unknown } | undefined)?.event_type === "string"
      ? String((body.data as { event_type?: unknown }).event_type)
      : "";
  if (eventType && !/call\\.(hangup|completed|ended|finalized)/i.test(eventType)) {
    return json({ ignored: true, event_type: eventType });
  }

  const voice = voiceInputFromBody(body, env);
  const from = voice.from;
  const to = voice.to;
  if (!from) return badRequest("from must be E.164");
  if (!to) return badRequest("to must be E.164");

  const { customer } = customerForPhone(env, from);
  await customer.onCallEnded({
    from,
    to,
    call_control_id: voice.call_control_id,
    call_session_id: voice.call_session_id,
  });
  return json({ ok: true, actor: actorNameForCustomer(from) });
}

function voiceInputFromBody(body: Record<string, unknown>, env: Env): VoiceCallInput {
  const data = body.data as { payload?: Record<string, unknown> } | undefined;
  const payload = data?.payload ?? body;
  const fromObject = payload.from as { phone_number?: unknown } | undefined;
  const toObject = payload.to as { phone_number?: unknown } | undefined;
  const toArray = Array.isArray(payload.to) ? payload.to[0] as { phone_number?: unknown } | undefined : undefined;

  return {
    from: normalizePhoneE164(
      fromObject?.phone_number
        ?? payload.from
        ?? body.From
        ?? payload.From
        ?? payload.caller_id_number,
      demoSenderNumber(env),
    ),
    to: normalizePhoneE164(
      toObject?.phone_number
        ?? toArray?.phone_number
        ?? payload.to
        ?? body.To
        ?? payload.To
        ?? payload.to_number,
      demoFromNumber(env),
    ),
    call_control_id: typeof payload.call_control_id === "string" ? payload.call_control_id : undefined,
    call_session_id: typeof payload.call_session_id === "string" ? payload.call_session_id : undefined,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        demo: demoUiEnabled(env),
        smsTransport: smsTransportEnabled(env) ? "production" : "demo",
        brand: BRAND_VERSION,
      });
    }

    if (request.method === "GET" && url.pathname === "/version") {
      return json({ brand: BRAND_VERSION });
    }

    if (request.method === "HEAD" && url.pathname === "/" && demoUiEnabled(env)) {
      return new Response(null, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-brand-version": BRAND_VERSION,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/" && demoUiEnabled(env)) {
      return new Response(demoHtml(env), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-brand-version": BRAND_VERSION,
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }

    if (request.method === "GET" && url.pathname === "/events") {
      return handleEvents(request, env);
    }

    if (request.method === "GET" && url.pathname === "/context") {
      return handleContext(request, env);
    }

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/webhooks/messaging")) {
      return handleWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/salesforce") {
      return handleSalesforceWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/salesforce/lead/update") {
      return handleSalesforceLeadUpdate(request, env);
    }

    if (request.method === "POST" && url.pathname === "/hitl/escalate") {
      return handleHumanEscalation(request, env);
    }

    if (request.method === "POST" && url.pathname === "/hitl/reply") {
      return handleHumanReply(request, env);
    }

    if (request.method === "POST" && url.pathname === "/schedule/followup") {
      return handleScheduleFollowup(request, env);
    }

    if (request.method === "POST" && url.pathname === "/call/result") {
      return handleCallResult(request, env);
    }

    if (request.method === "GET" && url.pathname === "/call/context") {
      return handleCallContext(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/salesforce-lead-change") {
      return handleSalesforceLeadChange(request, env);
    }

    if (request.method === "POST" && url.pathname === "/ai-assistant") {
      return handleAiAssistant(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/voice") {
      return handleVoiceCall(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/call-ended") {
      return handleCallEnded(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/email") {
      return handleAgentMailWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/agent-mail/send") {
      return handleSdrEmail(request, env);
    }

    return new Response("not found", { status: 404 });
  },
};
