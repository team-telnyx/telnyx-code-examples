import { Agent } from "@telnyx/edge-runtime";
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { buildGraph } from "./graph.js";
import { lookupLatestLead, updateLeadDemoField, updateShipmentStatus } from "./salesforce.js";
import { sendAgentMail } from "./agent-mail.js";
import {
  demoCustomerName,
  demoCustomerSalesforceId,
  demoFromNumber,
  modelId,
  smsTransportEnabled,
} from "./types.js";
import type {
  CustomerState,
  Env,
  EventsResponse,
  HistoryEntry,
  ProcessLogRow,
  ProcessLogEvent,
  GraphExecutionRow,
  GraphExecution,
  ReceiveMessageInput,
  TelnyxEdgeClient,
  Intent,
  CustomerContext,
  SalesforceUpdateInput,
  SalesforceLeadChangeInput,
  LeadUpdateInput,
  HumanEscalationInput,
  HumanReplyInput,
  ScheduleFollowupInput,
  VoiceCallInput,
  SdrConfirmationInput,
  SdrReplyInput,
  AgentMailSendResult,
} from "./types.js";

const NUDGE_TEXT = "Just checking in — did that sort things out?";
const NUDGE_DELAY_SECONDS = 86_400;
const LEAD_FOLLOWUP_DELAY_SECONDS = 3 * 24 * 60 * 60;

const SDR_NAME_DEFAULT = "Steve";
const SDR_EMAIL_DEFAULT = "steve@example.com";

function telnyx(env: Env): TelnyxEdgeClient {
  return env.TELNYX as unknown as TelnyxEdgeClient;
}

function toBaseMessages(history: HistoryEntry[]): BaseMessage[] {
  return history.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    return new AIMessage(m.content);
  });
}

export class CustomerAgentLangGraphV2 extends Agent<Env, CustomerState> {
  protected override initialState(): CustomerState {
    const env = this.env;
    return {
      phone_e164: "",
      to: demoFromNumber(env),
      name: demoCustomerName(env),
      salesforce_id: demoCustomerSalesforceId(env),
      preferred_channel: "sms",
      proactive_consent: true,
      open_tickets: [],
      shipments: [],
      latest_lead: null,
      escalation_pending: null,
      active_schedule_ids: [],
      history: [],
      turn: 0,
      queuedTurn: 0,
      processingTurn: 0,
      lastSentTurn: 0,
      pendingOutbound: null,
      lastIntent: "unknown",
      at: 0,
    };
  }

  async receive({ text, from, to, eventId }: ReceiveMessageInput): Promise<void> {
    this.ensureTables();

    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO webhook_events(event_id, at) VALUES (?, ?)",
        eventId,
        Date.now(),
      );
    } catch {
      return;
    }

    const state = await this.getState();
    const turn = state.turn + 1;
    const now = Date.now();

    if (state.phone_e164 && state.phone_e164 !== from) {
      this.logProcess(
        turn,
        "phone_mismatch",
        "unknown",
        `actor=${state.phone_e164} inbound=${from}; routing as separate actor`,
      );
    }

    await this.messages.add("user", text);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "user",
      text,
      now,
    );

    const history = state.history ?? [];
    const nextHistory: HistoryEntry[] = [
      ...history,
      { role: "user", content: text, at: now },
    ];

    await this.setState({
      phone_e164: from,
      to,
      turn,
      queuedTurn: turn,
      history: nextHistory,
    });

    this.logProcess(
      turn,
      "receive",
      "unknown",
      `phone=${from}; queued; text="${text.slice(0, 80)}"`,
    );
    await this.queue("process");
  }

  async process(): Promise<void> {
    this.ensureTables();

    const state = await this.getState();
    if (!state.phone_e164 || !state.to) return;

    const targetTurn = state.queuedTurn;

    if (targetTurn <= state.lastSentTurn) {
      this.logProcess(
        targetTurn,
        "stale_noop",
        "unknown",
        `target=${targetTurn} <= lastSent=${state.lastSentTurn}`,
      );
      return;
    }

    await this.setState({ processingTurn: targetTurn });
    this.logProcess(
      targetTurn,
      "process_start",
      "unknown",
      `target=${targetTurn}; lastSent=${state.lastSentTurn}`,
    );

    const history = await this.messages.toLangChain();
    const baseMessages = toBaseMessages(state.history ?? []);
    const systemContent = this.systemPrompt(state);
    const messages = [new SystemMessage(systemContent), ...baseMessages];

    const graph = buildGraph(this.env, modelId(this.env));
    const out = await graph.invoke({ messages });

    const reply = String(out.replyText ?? "").trim() || "I'll get back to you shortly.";
    const intent = (out.intentLabel as Intent) || "unknown";
    const nodePath = (out.nodePath ?? []).join("\u2192");
    const historyCount = (out.historyCount as number) ?? 0;
    const recordId = (out.recordId as string) ?? "";
    const actionResult = (out.actionResult as string) ?? "";
    const latestLead = intent === "lead"
      ? await lookupLatestLead(this.env).catch(() => state.latest_lead ?? null)
      : state.latest_lead ?? null;

    this.logGraphExecution(targetTurn, intent, nodePath, historyCount, recordId, actionResult, reply);
    this.logProcess(
      targetTurn,
      "graph_done",
      intent,
      `path=${nodePath} history=${historyCount}${recordId ? ` recordId=${recordId}` : ""} reply="${reply.slice(0, 80)}"`,
    );

    const clientRef = `turn-${targetTurn}`;
    const now = Date.now();
    await this.setState({
      pendingOutbound: { turn: targetTurn, reply, clientRef },
    });

    await this.messages.add("assistant", reply);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      reply,
      now,
    );

    const nextHistory: HistoryEntry[] = [
      ...(state.history ?? []),
      { role: "assistant", content: reply, at: now },
    ];

    const from = state.phone_e164;
    const to = state.to;

    if (smsTransportEnabled(this.env) && from && to) {
      await telnyx(this.env).messages.send({ from: to, to: from, text: reply });
      this.logProcess(targetTurn, "sms_sent", intent, `clientRef=${clientRef}`);
    } else {
      this.logProcess(
        targetTurn,
        "sms_mocked",
        intent,
        `clientRef=${clientRef}; text="${reply.slice(0, 80)}"`,
      );
    }

    await this.setState({
      lastSentTurn: targetTurn,
      processingTurn: 0,
      pendingOutbound: null,
      at: now,
      lastIntent: intent,
      history: nextHistory,
      latest_lead: latestLead,
    });

    this.logProcess(targetTurn, "commit", intent, `lastSentTurn=${targetTurn}`);

    const s2 = await this.getState();
    if (s2.queuedTurn > targetTurn) {
      this.logProcess(
        targetTurn,
        "requeue",
        intent,
        `queuedTurn=${s2.queuedTurn} > target=${targetTurn}`,
      );
      await this.queue("process");
    }

    await this.schedule(NUDGE_DELAY_SECONDS, "nudge", null, { id: "nudge" });
  }

  async nudge(): Promise<void> {
    const state = await this.getState();
    if (!state.phone_e164 || !state.to) return;

    const last = await this.messages.last();
    if (last?.role === "assistant") return;

    if (smsTransportEnabled(this.env)) {
      try {
        await telnyx(this.env).messages.send({
          from: state.to,
          to: state.phone_e164,
          text: NUDGE_TEXT,
        });
      } catch {
        return;
      }
    }

    this.logProcess(state.turn, "nudge", "unknown", "sent nudge");
  }

  async ingestSalesforceUpdate(update: SalesforceUpdateInput): Promise<void> {
    this.ensureTables();

    await updateShipmentStatus(this.env, {
      salesforce_id: update.salesforce_id,
      status: update.status,
      tracking_number: update.tracking_number,
      estimated_delivery: update.estimated_delivery,
    });

    const state = await this.getState();
    const now = Date.now();
    const shipment = {
      id: update.order_id,
      salesforce_id: update.salesforce_id,
      status: update.status,
      eta: update.estimated_delivery ?? "unknown",
      carrier: "Telnyx Logistics",
      tracking_number: update.tracking_number,
    };
    const shipments = [
      ...state.shipments.filter((s) => s.salesforce_id !== update.salesforce_id && s.id !== update.order_id),
      shipment,
    ];

    await this.setState({
      phone_e164: update.phone_e164,
      shipments,
      at: now,
    });

    const message = `Shipment ${update.order_id} update: ${update.status}${shipment.eta !== "unknown" ? `, ETA ${shipment.eta}` : ""}.`;
    if (state.proactive_consent && state.to && update.phone_e164) {
      if (smsTransportEnabled(this.env)) {
        await telnyx(this.env).messages.send({ from: state.to, to: update.phone_e164, text: message });
        this.logProcess(state.turn, "salesforce_sms_sent", "order", message);
      } else {
        this.logProcess(state.turn, "salesforce_sms_mocked", "order", message);
      }
    }

    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );
  }

  /**
   * Ingest a Salesforce Lead change webhook — spec steps 17-19. Salesforce
   * record changed (e.g. Steve rescheduled the meeting); LangGraph detects
   * the diff, updates durable state, and proactively SMSes the customer.
   *
   * Compares the inbound meeting_time against the actor's stored
   * previous_meeting_time on latest_lead. If they differ, flags a reschedule
   * and sends a proactive SMS notifying the customer of the new time.
   */
  async ingestSalesforceLeadChange(input: SalesforceLeadChangeInput): Promise<{ reschedule_detected: boolean; proactive_sms_sent: boolean }> {
    console.log("[actor] ingestSalesforceLeadChange START", { phone: input.phone_e164, lead_id: input.lead_id, meeting_time: input.meeting_time, meeting_status: input.meeting_status });
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();

    const previousMeetingTime = state.latest_lead?.meeting_time ?? null;
    const newMeetingTime = input.meeting_time ?? null;
    const rescheduleDetected =
      previousMeetingTime !== null &&
      newMeetingTime !== null &&
      previousMeetingTime !== newMeetingTime;
    console.log("[actor] ingestSalesforceLeadChange diff", { previousMeetingTime, newMeetingTime, rescheduleDetected });

    const updatedLead = state.latest_lead
      ? {
          ...state.latest_lead,
          meeting_time: newMeetingTime,
          meeting_status: input.meeting_status ?? state.latest_lead.meeting_status,
          assigned_sdr: input.assigned_sdr ?? state.latest_lead.assigned_sdr,
          requested_meeting_time: input.requested_meeting_time ?? state.latest_lead.requested_meeting_time,
          customer_context: input.customer_context ?? state.latest_lead.customer_context,
          shipment: input.shipment ?? state.latest_lead.shipment,
          previous_meeting_time: rescheduleDetected ? previousMeetingTime : state.latest_lead.previous_meeting_time,
        }
      : null;

    await this.setState({
      phone_e164: input.phone_e164 || state.phone_e164,
      latest_lead: updatedLead,
      at: now,
    });

    let proactiveSmsSent = false;
    if (rescheduleDetected && state.proactive_consent && state.to && (input.phone_e164 || state.phone_e164)) {
      const customerPhone = input.phone_e164 || state.phone_e164;
      const smsText = `Hi ${state.name || "Anusha"} — your Telnyx onboarding meeting has been moved to ${newMeetingTime}.`;
      if (smsTransportEnabled(this.env)) {
        try {
          await telnyx(this.env).messages.send({ from: state.to, to: customerPhone, text: smsText });
          proactiveSmsSent = true;
          this.logProcess(state.turn, "salesforce_reschedule_sms_sent", "lead", smsText);
        } catch {
          this.logProcess(state.turn, "salesforce_reschedule_sms_failed", "lead", smsText);
        }
      } else {
        this.logProcess(state.turn, "salesforce_reschedule_sms_mocked", "lead", smsText);
      }

      await this.messages.add("assistant", smsText);
      this.ctx.storage.sql.exec(
        "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
        "assistant",
        smsText,
        now,
      );
    }

    this.logProcess(
      state.turn,
      "salesforce_lead_change_ingested",
      "lead",
      `lead_id=${input.lead_id}; reschedule=${rescheduleDetected}; prev=${previousMeetingTime}; new=${newMeetingTime}`,
    );

    console.log("[actor] ingestSalesforceLeadChange OK", { reschedule_detected: rescheduleDetected, proactive_sms_sent: proactiveSmsSent });
    return { reschedule_detected: rescheduleDetected, proactive_sms_sent: proactiveSmsSent };
  }

  async updateLeadFromAgent(input: LeadUpdateInput): Promise<{ lead_id: string; field: string; value: string }> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const value = input.value?.trim()
      || `Updated by CustomerAgent for ${state.name || "Anusha"} at ${new Date(now).toISOString()}`;

    const result = await updateLeadDemoField(this.env, {
      lead_id: input.lead_id,
      field: input.field,
      value,
    });

    const phone = input.phone_e164 || state.phone_e164;
    const message = `I updated the CustomerAgent Demo record in Salesforce: ${result.value}.`;

    await this.setState({
      phone_e164: phone,
      salesforce_id: result.lead.id,
      latest_lead: result.lead,
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });

    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );

    if (input.send_sms !== false && state.proactive_consent && state.to && phone) {
      if (smsTransportEnabled(this.env)) {
        await telnyx(this.env).messages.send({ from: state.to, to: phone, text: message });
        this.logProcess(state.turn, "salesforce_lead_sms_sent", "lead", message);
      } else {
        this.logProcess(state.turn, "salesforce_lead_sms_mocked", "lead", message);
      }
    }

    this.logProcess(state.turn, "salesforce_lead_updated", "lead", `lead=${result.lead.id}; field=${result.field}`);
    return { lead_id: result.lead.id, field: result.field, value: result.value };
  }

  async requestHumanEscalation(input: HumanEscalationInput): Promise<{ ticket_id: string }> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const ticketId = `hitl-${now}`;
    const ticket = {
      id: ticketId,
      subject: input.reason,
      status: "waiting_for_human",
    };
    const message = `I need an internal approval before I can promise the expedited onboarding package. I pulled in a human for: ${input.reason}.`;

    await this.setState({
      phone_e164: input.phone_e164,
      escalation_pending: {
        reason: input.reason,
        started_at: now,
        ticket_id: ticketId,
      },
      open_tickets: [...(state.open_tickets ?? []), ticket],
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });

    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );
    this.logProcess(state.turn, "human_escalation_wait", "unknown", `ticket=${ticketId}; reason=${input.reason}`);
    return { ticket_id: ticketId };
  }

  async resumeHumanEscalation(input: HumanReplyInput): Promise<void> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const ticketId = state.escalation_pending?.ticket_id;
    const message = `Good news, Anusha. A specialist approved the expedited onboarding package. ${input.reply_text}`;

    await this.setState({
      phone_e164: input.phone_e164,
      escalation_pending: null,
      open_tickets: (state.open_tickets ?? []).map((ticket) =>
        ticket.id === ticketId ? { ...ticket, status: "resolved" } : ticket,
      ),
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });

    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );

    if (state.proactive_consent && state.to && input.phone_e164) {
      if (smsTransportEnabled(this.env)) {
        await telnyx(this.env).messages.send({ from: state.to, to: input.phone_e164, text: message });
        this.logProcess(state.turn, "human_resume_sms_sent", "unknown", message);
      } else {
        this.logProcess(state.turn, "human_resume_sms_mocked", "unknown", message);
      }
    }

    this.logProcess(state.turn, "human_escalation_resume", "unknown", `ticket=${ticketId ?? "none"}`);
  }

  async scheduleLeadFollowup(input: ScheduleFollowupInput): Promise<{ schedule_id: string; delay_seconds: number }> {
    this.ensureTables();
    const state = await this.getState();
    const delay = Math.max(1, Math.floor(input.delay_seconds ?? LEAD_FOLLOWUP_DELAY_SECONDS));
    const scheduleId = `lead-followup-${Date.now()}`;
    const scheduled = await this.schedule(delay, "sendScheduledLeadFollowup", input.reason ?? "lead_followup", { id: scheduleId });
    const id = String(scheduled || scheduleId);

    await this.setState({
      phone_e164: input.phone_e164 || state.phone_e164,
      active_schedule_ids: [...(state.active_schedule_ids ?? []), id],
      at: Date.now(),
    });
    this.logProcess(state.turn, "schedule_created", "lead", `id=${id}; delay=${delay}`);
    return { schedule_id: id, delay_seconds: delay };
  }

  async sendScheduledLeadFollowup(reason = "lead_followup"): Promise<void> {
    this.ensureTables();
    const state = await this.getState();
    if (!state.phone_e164 || !state.to) return;

    const message = `Anusha, your onboarding package is now ready. ${reason}`;
    const now = Date.now();

    await this.setState({
      active_schedule_ids: [],
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });
    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );

    if (smsTransportEnabled(this.env)) {
      await telnyx(this.env).messages.send({ from: state.to, to: state.phone_e164, text: message });
      this.logProcess(state.turn, "scheduled_sms_sent", "lead", message);
    } else {
      this.logProcess(state.turn, "scheduled_sms_mocked", "lead", message);
    }
  }

  async onCall(input: VoiceCallInput): Promise<{ prompt: string }> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const prompt = `Hi ${state.name || "Anusha"}, this is your CustomerAgent. I can see your Salesforce context and your onboarding package status. I will send a follow-up by text so you do not have to stay on the line.`;

    await this.setState({
      phone_e164: input.from,
      to: input.to,
      preferred_channel: "voice",
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "user", content: `Inbound call ${input.call_control_id ?? input.call_session_id ?? ""}`.trim(), at: now },
      ],
    });
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "user",
      "Inbound voice call",
      now,
    );
    this.logProcess(state.turn, "voice_call_started", "unknown", `from=${input.from}; to=${input.to}`);
    return { prompt };
  }

  async onCallEnded(input: VoiceCallInput): Promise<void> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const message = "Thanks for calling, Anusha. I'll keep this thread updated with your onboarding status. You can reply here any time.";

    await this.setState({
      phone_e164: input.from || state.phone_e164,
      to: input.to || state.to,
      preferred_channel: "sms",
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });
    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );

    if (smsTransportEnabled(this.env) && input.from && input.to) {
      await telnyx(this.env).messages.send({ from: input.to, to: input.from, text: message });
      this.logProcess(state.turn, "call_hangup_sms_sent", "unknown", message);
    } else {
      this.logProcess(state.turn, "call_hangup_sms_mocked", "unknown", message);
    }
  }

  /**
   * Email the assigned SDR (Steve) via Agent Mail to confirm a meeting time
   * the customer requested. Spec step 9.
   *
   * Records the outbound email in durable state so the orchestrator can
   * match Steve's reply back to this lead/request later.
   */
  async emailSdrForConfirmation(input: SdrConfirmationInput): Promise<AgentMailSendResult> {
    console.log("[actor] emailSdrForConfirmation START", { phone: input.phone_e164, lead_id: input.lead_id, requested_time: input.requested_time });
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();

    const sdrName = this.env.SDR_NAME?.trim() || SDR_NAME_DEFAULT;
    const sdrEmail = this.env.SDR_EMAIL?.trim() || SDR_EMAIL_DEFAULT;
    const customerName = input.customer_name || state.name || "the customer";
    const requestedTime = input.requested_time || "the requested time";
    const customerContext = input.customer_context || "Telnyx onboarding";
    console.log("[actor] emailSdrForConfirmation resolved", { sdrName, sdrEmail, customerName, requestedTime });

    const subject = `New Telnyx onboarding lead: ${customerName}`;
    const text =
      `Hi ${sdrName},\n\n` +
      `New Telnyx onboarding lead: ${customerName}.\n\n` +
      `Salesforce assigned you to this lead.\n\n` +
      `Requested meeting: ${requestedTime}\n\n` +
      `Customer context: ${customerContext}\n\n` +
      `Can you confirm that this meeting time works?\n\n` +
      `Reply with "Yes" to confirm, or suggest a new time.\n\n` +
      `— CustomerAgent (Telnyx Edge)`;

    const result = await sendAgentMail(this.env, { to: sdrEmail, subject, text });

    await this.setState({
      phone_e164: input.phone_e164 || state.phone_e164,
      at: now,
      history: [
        ...(state.history ?? []),
        {
          role: "assistant",
          content: `Emailed ${sdrName} (${sdrEmail}) via Agent Mail to confirm ${requestedTime}. thread=${result.thread_id}`,
          at: now,
        },
      ],
    });

    await this.messages.add(
      "assistant",
      `Emailed ${sdrName} via Agent Mail to confirm ${requestedTime}.`,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      `Emailed ${sdrName} via Agent Mail to confirm ${requestedTime}.`,
      now,
    );
    this.logProcess(
      state.turn,
      "agent_mail_sent",
      "lead",
      `to=${sdrEmail}; subject="${subject.slice(0, 60)}"; thread=${result.thread_id}`,
    );

    console.log("[actor] emailSdrForConfirmation OK", { message_id: result.message_id.slice(0, 20), thread_id: result.thread_id.slice(0, 20), sdrEmail });
    return result;
  }

  /**
   * Ingest a reply from the SDR (Steve) that arrived via Agent Mail. Spec
   * step 10: LangGraph interprets Steve's "Yes" / "No" / suggested new time
   * and updates durable state accordingly.
   *
   * Returns the parsed reply text and the customer's phone so the webhook
   * route can decide whether to trigger a downstream graph run.
   */
  async ingestSdrReply(input: SdrReplyInput): Promise<{ reply_text: string; confirmed: boolean }> {
    console.log("[actor] ingestSdrReply START", { from: input.from, phone: input.phone_e164, thread_id: input.thread_id?.slice(0, 20) });
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();

    const replyText = input.reply_text.trim();
    const confirmed = /\b(yes|yep|yeah|confirm|confirmed|works|good|sounds good|that works)\b/i.test(
      replyText,
    );
    console.log("[actor] ingestSdrReply parsed", { replyText: replyText.slice(0, 80), confirmed });

    const sdrName = this.env.SDR_NAME?.trim() || SDR_NAME_DEFAULT;
    const message = confirmed
      ? `${sdrName} confirmed the meeting via Agent Mail. Reply: "${replyText}".`
      : `${sdrName} replied via Agent Mail (not yet a clear yes). Reply: "${replyText}".`;
    console.log("[actor] ingestSdrReply message", { message: message.slice(0, 80), confirmed });

    await this.setState({
      phone_e164: input.phone_e164 || state.phone_e164,
      at: now,
      history: [
        ...(state.history ?? []),
        { role: "assistant", content: message, at: now },
      ],
    });

    await this.messages.add("assistant", message);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      message,
      now,
    );

    this.logProcess(
      state.turn,
      confirmed ? "sdr_confirmed" : "sdr_replied",
      "lead",
      `from=${input.from}; thread=${input.thread_id ?? "unknown"}; reply="${replyText.slice(0, 80)}"`,
    );

    console.log("[actor] ingestSdrReply OK", { confirmed, reply_text: replyText.slice(0, 80) });
    return { reply_text: replyText, confirmed };
  }

  async getEvents(limit = 50): Promise<EventsResponse> {
    this.ensureTables();
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const conversation = this.ctx.storage.sql
      .exec(
        `SELECT id, role, content, at FROM conversation ORDER BY id DESC LIMIT ?`,
        boundedLimit,
      )
      .toArray() as unknown as Array<HistoryEntry & { id: number }>;

    const processRows = this.ctx.storage.sql
      .exec<ProcessLogRow>(
        `SELECT id, turn, phase, intent, note, at FROM process_log ORDER BY id DESC LIMIT ?`,
        boundedLimit,
      )
      .toArray();

    const graphRows = this.ctx.storage.sql
      .exec<GraphExecutionRow>(
        `SELECT id, turn, intent, path, history_count, order_id, action_result, reply, at FROM graph_executions ORDER BY id DESC LIMIT 1`,
      )
      .toArray();

    const state = await this.getState();

    const graphExecution: GraphExecution | null = graphRows.length > 0
      ? {
          turn: graphRows[0].turn,
          intent: graphRows[0].intent,
          path: graphRows[0].path,
          historyCount: graphRows[0].history_count,
          orderId: graphRows[0].order_id,
          actionResult: graphRows[0].action_result,
          reply: graphRows[0].reply,
          at: graphRows[0].at,
        }
      : null;

    return {
      conversation,
      processLog: processRows.map((row): ProcessLogEvent => ({
        id: row.id,
        turn: row.turn,
        phase: row.phase,
        intent: row.intent,
        note: row.note,
        at: row.at,
      })),
      graphExecution,
      turnState: {
        turn: state.turn,
        queuedTurn: state.queuedTurn,
        processingTurn: state.processingTurn,
        lastSentTurn: state.lastSentTurn,
        pendingOutbound: state.pendingOutbound,
      },
    };
  }

  async getContext(): Promise<CustomerContext> {
    const state = await this.getState();
    return {
      customer: {
        phone_e164: state.phone_e164,
        name: state.name,
        salesforce_id: state.salesforce_id,
        preferred_channel: state.preferred_channel,
        proactive_consent: state.proactive_consent,
        open_tickets: state.open_tickets,
        shipments: state.shipments,
        latest_lead: state.latest_lead ?? null,
        escalation_pending: state.escalation_pending,
        active_schedule_ids: state.active_schedule_ids,
        turn: state.turn,
        queuedTurn: state.queuedTurn,
        processingTurn: state.processingTurn,
        lastSentTurn: state.lastSentTurn,
        lastIntent: state.lastIntent,
        at: state.at,
      },
      history: state.history,
    };
  }

  private systemPrompt(state: CustomerState): string {
    const customerLine = state.name
      ? `You are replying to ${state.name} (${state.phone_e164}). `
      : `You are replying to a Telnyx customer at ${state.phone_e164}. `;
    return (
      customerLine +
      "Answer in one or two sentences. If the user asks about a Salesforce lead, the action node will look it up."
    );
  }

  private ensureTables(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS webhook_events(event_id TEXT PRIMARY KEY, at INTEGER)`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS conversation(id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL)`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS process_log(id INTEGER PRIMARY KEY AUTOINCREMENT, turn INTEGER, phase TEXT, intent TEXT, note TEXT, at INTEGER)`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS graph_executions(id INTEGER PRIMARY KEY AUTOINCREMENT, turn INTEGER, intent TEXT, path TEXT, history_count INTEGER, order_id TEXT, action_result TEXT, reply TEXT, at INTEGER)`,
    );
  }

  private logProcess(turn: number, phase: string, intent: string, note: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO process_log(turn, phase, intent, note, at) VALUES (?, ?, ?, ?, ?)",
      turn,
      phase,
      intent,
      note,
      Date.now(),
    );
  }

  private logGraphExecution(
    turn: number,
    intent: string,
    path: string,
    historyCount: number,
    orderId: string,
    actionResult: string,
    reply: string,
  ): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO graph_executions(turn, intent, path, history_count, order_id, action_result, reply, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      turn,
      intent,
      path,
      historyCount,
      orderId,
      actionResult,
      reply,
      Date.now(),
    );
  }
}

export { CustomerAgentLangGraphV2 as CustomerAgent };
