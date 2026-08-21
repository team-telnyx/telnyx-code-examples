import { Agent } from "@telnyx/edge-runtime";
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { buildGraph } from "./graph.js";
import { lookupLatestLead, updateLeadDemoField, updateShipmentStatus, createOrUpdateLead, assignSdr, checkSdrAvailability, updateLeadMeeting } from "./salesforce.js";
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
  CallResultInput,
  ResponderContext,
  RescheduleEvent,
} from "./types.js";

const NUDGE_TEXT = "Just checking in — did that sort things out?";
const NUDGE_DELAY_SECONDS = 86_400;
const LEAD_FOLLOWUP_DELAY_SECONDS = 3 * 24 * 60 * 60;

const SDR_NAME_DEFAULT = "Steve";
const SDR_EMAIL_DEFAULT = "steve@example.com";

function normalizeMeetingTime(time: string | null): string | null {
  if (!time) return null;
  const trimmed = time.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.replace(/\.000\+0000$/, "Z").slice(0, 16);
  }
  return trimmed.toLowerCase().replace(/\s+/g, " ").trim();
}

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
      reschedule_event: null,
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
    const scheduleMeetingPending = Boolean(out.scheduleMeetingPending);
    const requestedTime = String(out.requestedTime ?? "");
    const graphLeadId = String(out.leadId ?? "");
    const assignedSdr = String(out.assignedSdr ?? "");
    const sdrAvailable = Boolean(out.sdrAvailable);

    const latestLead = (intent === "lead" || intent === "schedule_meeting")
      ? await lookupLatestLead(this.env).catch(() => state.latest_lead ?? null)
      : state.latest_lead ?? null;

    this.logGraphExecution(targetTurn, intent, nodePath, historyCount, recordId, actionResult, reply);
    this.logProcess(
      targetTurn,
      "graph_done",
      intent,
      `path=${nodePath} history=${historyCount}${recordId ? ` recordId=${recordId}` : ""}${scheduleMeetingPending ? ` scheduleMeeting=true sdr=${assignedSdr}` : ""} reply="${reply.slice(0, 80)}"`,
    );

    if (scheduleMeetingPending && sdrAvailable) {
      console.log("[actor] post-graph: schedule_meeting pending, emailing SDR via AgentMail", { leadId: graphLeadId, requestedTime, assignedSdr });
      try {
        const mailResult = await this.emailSdrForConfirmation({
          phone_e164: state.phone_e164,
          lead_id: graphLeadId,
          requested_time: requestedTime,
          customer_name: state.name || "Anusha",
          customer_context: "Telnyx onboarding",
        });
        console.log("[actor] post-graph: AgentMail sent", { thread_id: mailResult.thread_id.slice(0, 20) });
        this.logProcess(targetTurn, "schedule_meeting_email_sent", intent, `thread=${mailResult.thread_id.slice(0, 20)} sdr=${assignedSdr}`);
      } catch (err) {
        console.error("[actor] post-graph: AgentMail send failed", err instanceof Error ? err.message : String(err));
        this.logProcess(targetTurn, "schedule_meeting_email_failed", intent, String(err instanceof Error ? err.message : "unknown error"));
      }
    }

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

    // Normalize both times for comparison. Salesforce sends ISO datetime (e.g.
    // "2026-08-29T20:30:00.000+0000"), actor stores natural language (e.g.
    // "Friday August 29 at 1:30 PM"). Normalize by extracting just the date+time
    // portion from ISO and comparing the ISO-normalized versions.
    const prevNorm = normalizeMeetingTime(previousMeetingTime);
    const newNorm = normalizeMeetingTime(newMeetingTime);
    const rescheduleDetected =
      prevNorm !== null &&
      newNorm !== null &&
      prevNorm !== newNorm;
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

    const rescheduleEvent: RescheduleEvent | null = rescheduleDetected
      ? {
          old_meeting_time: previousMeetingTime,
          new_meeting_time: newMeetingTime,
          detected_at: now,
          proactive_sms_sent: false,
          source: "salesforce_manual",
          status: "pending_customer_ack",
        }
      : state.reschedule_event;

    await this.setState({
      phone_e164: input.phone_e164 || state.phone_e164,
      latest_lead: updatedLead,
      reschedule_event: rescheduleEvent,
      at: now,
    });

    let proactiveSmsSent = false;
    if (rescheduleDetected && state.proactive_consent && state.to && (input.phone_e164 || state.phone_e164)) {
      const customerPhone = input.phone_e164 || state.phone_e164;
      const smsText = `Hi ${state.name || "Anusha"} — your sales meeting with Steve has been moved to ${newMeetingTime}.`;
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

      if (rescheduleEvent) {
        await this.setState({
          reschedule_event: { ...rescheduleEvent, proactive_sms_sent: proactiveSmsSent },
        });
      }
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

  /**
   * Gate 1 + Gate 7: Accept a call result from the Telnyx AI Assistant
   * (Responder) and process it through the durable customer actor.
   *
   * For schedule_meeting: runs the Salesforce workflow (createOrUpdateLead →
   * assignSdr → checkSdrAvailability → emailSdrForConfirmation), persists
   * the lead to durable state, and records the call in history.
   *
   * For confirm_reschedule: updates Salesforce Customer_Approval + Meeting_Status
   * and persists the customer's confirmation to durable state.
   *
   * This is the Orchestrator-side handler. The Responder handles the live voice
   * conversation and sends structured results here after the call.
   */
  async ingestCallResult(input: CallResultInput): Promise<{ lead_id?: string; assigned_sdr?: string; sdr_available?: boolean; sdr_emailed?: boolean; salesforce_updated?: boolean }> {
    this.ensureTables();
    console.log("[actor] ingestCallResult START", { phone: input.from, intent: input.intent, requested_time: input.requested_meeting_time });
    const state = await this.getState();
    const now = Date.now();

    const callSummary = input.transcript_summary || `Call from ${input.from}: intent=${input.intent}`;
    await this.messages.add("user", callSummary);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "user",
      callSummary,
      now,
    );

    const history = state.history ?? [];
    const nextHistory: HistoryEntry[] = [
      ...history,
      { role: "user", content: callSummary, at: now },
    ];

    await this.setState({
      phone_e164: input.from,
      to: input.to || state.to || demoFromNumber(this.env),
      preferred_channel: "voice",
      history: nextHistory,
      at: now,
    });

    this.logProcess(state.turn, "call_result_received", input.intent, `phone=${input.from}; time=${input.requested_meeting_time ?? "none"}`);

    if (input.intent === "schedule_meeting") {
      console.log("[actor] ingestCallResult: schedule_meeting branch");
      return this.handleScheduleMeetingFromCall(input, now);
    }

    if (input.intent === "confirm_reschedule") {
      console.log("[actor] ingestCallResult: confirm_reschedule branch");
      return this.handleConfirmRescheduleFromCall(input, now);
    }

    this.logProcess(state.turn, "call_result_unhandled_intent", input.intent, "no action taken");
    return {};
  }

  private async handleScheduleMeetingFromCall(input: CallResultInput, now: number): Promise<{ lead_id: string; assigned_sdr: string; sdr_available: boolean; sdr_emailed: boolean }> {
    const state = await this.getState();
    const customerName = input.customer_name || state.name || demoCustomerName(this.env);
    const customerEmail = input.customer_email || this.env.SF_DEMO_LEAD_EMAIL || (await this.env.SECRETS?.get("SF_DEMO_LEAD_EMAIL")?.then(v => v?.trim())) || "anusha@telnyx.com";
    const customerPhone = input.customer_phone || input.from || state.phone_e164;
    const requestedTime = input.requested_meeting_time || "a time to be determined";
    const customerContext = input.customer_context || "Interested in learning more about Telnyx. Requested a call with a sales representative.";

    console.log("[actor] createOrUpdateLead", { customerName, customerEmail, customerPhone, requestedTime });
    const leadResult = await createOrUpdateLead(this.env, {
      name: customerName,
      company: "Telnyx",
      email: customerEmail,
      phone: customerPhone,
      shipment: "Telnyx",
      requested_meeting_time: requestedTime,
      customer_context: customerContext,
      meeting_status: "Requested",
    });
    console.log("[actor] lead created/updated", { leadId: leadResult.lead.id, created: leadResult.created, leadFields: {
      id: leadResult.lead.id,
      name: leadResult.lead.name,
      email: leadResult.lead.email,
      phone: leadResult.lead.phone,
      requested_meeting_time: leadResult.lead.requested_meeting_time,
      meeting_time: leadResult.lead.meeting_time,
      meeting_status: leadResult.lead.meeting_status,
      customer_context: leadResult.lead.customer_context?.slice(0, 80),
    }});

    console.log("[actor] assignSdr", { leadId: leadResult.lead.id });
    const sdrResult = await assignSdr(this.env, leadResult.lead.id);
    console.log("[actor] SDR assigned", { assigned_sdr: sdrResult.assigned_sdr });

    console.log("[actor] checkSdrAvailability", { sdr: sdrResult.assigned_sdr, time: requestedTime });
    const availResult = await checkSdrAvailability(this.env, sdrResult.assigned_sdr, requestedTime);
    console.log("[actor] SDR availability", { available: availResult.available });

    let sdrEmailed = false;
    if (availResult.available) {
      console.log("[actor] emailing SDR via AgentMail", { leadId: leadResult.lead.id, requestedTime });
      try {
        const mailResult = await this.emailSdrForConfirmation({
          phone_e164: input.from,
          lead_id: leadResult.lead.id,
          requested_time: requestedTime,
          customer_name: customerName,
          customer_context: customerContext,
        });
        console.log("[actor] AgentMail sent", { thread_id: mailResult.thread_id.slice(0, 20) });
        sdrEmailed = true;
        this.logProcess(state.turn, "schedule_meeting_email_sent", "schedule_meeting", `thread=${mailResult.thread_id.slice(0, 20)} sdr=${sdrResult.assigned_sdr}`);
      } catch (err) {
        console.error("[actor] AgentMail send failed", err instanceof Error ? err.message : String(err));
        this.logProcess(state.turn, "schedule_meeting_email_failed", "schedule_meeting", String(err instanceof Error ? err.message : "unknown error"));
      }
    }

    const updatedLead = {
      ...leadResult.lead,
      assigned_sdr: sdrResult.assigned_sdr,
      requested_meeting_time: requestedTime,
      customer_context: customerContext,
      meeting_status: "Requested",
    };

    const confirmationSms = `Thanks for calling, ${customerName}. Your sales meeting with Telnyx is scheduled for ${requestedTime}. I'll keep you updated here if anything changes.`;

    const nextHistory: HistoryEntry[] = [
      ...(state.history ?? []),
      { role: "assistant", content: confirmationSms, at: now },
    ];

    await this.setState({
      phone_e164: customerPhone,
      name: customerName,
      latest_lead: updatedLead,
      lastIntent: "schedule_meeting",
      history: nextHistory,
      at: now,
    });

    await this.messages.add("assistant", confirmationSms);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      confirmationSms,
      now,
    );

    if (state.proactive_consent && state.to && customerPhone) {
      if (smsTransportEnabled(this.env)) {
        try {
          await telnyx(this.env).messages.send({ from: state.to, to: customerPhone, text: confirmationSms });
          this.logProcess(state.turn, "schedule_meeting_sms_sent", "schedule_meeting", confirmationSms);
        } catch {
          this.logProcess(state.turn, "schedule_meeting_sms_failed", "schedule_meeting", confirmationSms);
        }
      } else {
        this.logProcess(state.turn, "schedule_meeting_sms_mocked", "schedule_meeting", confirmationSms);
      }
    }

    this.logProcess(
      state.turn,
      "schedule_meeting_processed",
      "schedule_meeting",
      `lead=${leadResult.lead.id} sdr=${sdrResult.assigned_sdr} available=${availResult.available} emailed=${sdrEmailed}`,
    );

    return {
      lead_id: leadResult.lead.id,
      assigned_sdr: sdrResult.assigned_sdr,
      sdr_available: availResult.available,
      sdr_emailed: sdrEmailed,
    };
  }

  private async handleConfirmRescheduleFromCall(input: CallResultInput, now: number): Promise<{ salesforce_updated: boolean }> {
    const state = await this.getState();
    const leadId = state.latest_lead?.id ?? "";
    const meetingTime = input.meeting_time || input.requested_meeting_time || state.reschedule_event?.new_meeting_time || "";

    console.log("[actor] confirm_reschedule: updating Salesforce", { leadId, meetingTime });
    let salesforceUpdated = false;
    if (leadId) {
      try {
        const result = await updateLeadMeeting(this.env, {
          lead_id: leadId,
          meeting_status: "customer_confirmed",
          meeting_time: meetingTime,
          customer_confirmation: input.customer_approved ? "confirmed" : "pending",
        });
        salesforceUpdated = true;
        console.log("[actor] Salesforce updated", { fields: result.fields_updated });
        this.logProcess(state.turn, "confirm_reschedule_salesforce_updated", "confirm_reschedule", `lead=${leadId} fields=${result.fields_updated.join(",")}`);
      } catch (err) {
        console.error("[actor] Salesforce update failed", err instanceof Error ? err.message : String(err));
        this.logProcess(state.turn, "confirm_reschedule_salesforce_failed", "confirm_reschedule", String(err instanceof Error ? err.message : "unknown error"));
      }
    }

    const updatedLead = state.latest_lead
      ? {
          ...state.latest_lead,
          meeting_time: meetingTime,
          meeting_status: "customer_confirmed",
          customer_confirmation: input.customer_approved ? "confirmed" : "pending",
        }
      : null;

    const confirmationMessage = input.customer_approved
      ? `Anusha confirmed the new meeting time: ${meetingTime}. Salesforce updated: Customer_Approval=confirmed, Meeting_Status=customer_confirmed.`
      : `Anusha did not confirm the new meeting time (${meetingTime}).`;

    const nextHistory: HistoryEntry[] = [
      ...(state.history ?? []),
      { role: "assistant", content: confirmationMessage, at: now },
    ];

    await this.setState({
      latest_lead: updatedLead,
      lastIntent: "confirm_reschedule",
      history: nextHistory,
      reschedule_event: state.reschedule_event
        ? { ...state.reschedule_event, status: "acknowledged" }
        : null,
      at: now,
    });

    await this.messages.add("assistant", confirmationMessage);
    this.ctx.storage.sql.exec(
      "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
      "assistant",
      confirmationMessage,
      now,
    );

    this.logProcess(state.turn, "confirm_reschedule_done", "confirm_reschedule", `approved=${input.customer_approved} time=${meetingTime}`);

    return { salesforce_updated: salesforceUpdated };
  }

  /**
   * Gate 6: Return existing customer context for the Responder (Telnyx AI
   * Assistant) to use at the start of a voice call.
   *
   * For a new caller: returns minimal context with is_returning_caller=false.
   * For a returning caller: returns full context including original meeting
   * time, SDR confirmation, new meeting time, reschedule flags, and a
   * pre-written narrative summary the AI Assistant can use directly.
   */
  async getCallContext(from: string): Promise<ResponderContext> {
    this.ensureTables();
    const state = await this.getState();
    const lead = state.latest_lead;
    const reschedule = state.reschedule_event;

    const isReturningCaller = Boolean(lead);

    const originalRequestedTime = lead?.requested_meeting_time ?? null;
    const originalConfirmedTime = reschedule?.old_meeting_time ?? lead?.meeting_time ?? null;
    const assignedSdr = lead?.assigned_sdr ?? null;
    const sdrConfirmation = lead?.sdr_confirmation ?? null;
    const newMeetingTime = reschedule?.new_meeting_time ?? null;
    const salesforceManuallyChanged = Boolean(reschedule && reschedule.status === "pending_customer_ack");
    const rescheduleDetectedAt = reschedule?.detected_at ?? null;
    const proactiveSmsSent = reschedule?.proactive_sms_sent ?? false;
    const meetingStatus = lead?.meeting_status ?? null;
    const customerConfirmation = lead?.customer_confirmation ?? null;

    const narrativeSummary = this.buildNarrativeSummary({
      name: state.name || "the customer",
      isReturningCaller,
      assignedSdr,
      originalRequestedTime,
      originalConfirmedTime,
      sdrConfirmation,
      newMeetingTime,
      salesforceManuallyChanged,
      proactiveSmsSent,
      meetingStatus,
      customerConfirmation,
    });

    const likelyReasonForCall = this.buildLikelyReasonForCall({
      name: state.name || "the customer",
      assignedSdr,
      originalConfirmedTime,
      newMeetingTime,
      salesforceManuallyChanged,
      proactiveSmsSent,
    });

    this.logProcess(
      state.turn,
      "get_call_context",
      "unknown",
      `phone=${from} is_returning=${isReturningCaller} has_reschedule=${salesforceManuallyChanged} old_time=${originalConfirmedTime} new_time=${newMeetingTime} sms_sent=${proactiveSmsSent}`,
    );

    return {
      phone_e164: state.phone_e164 || from,
      name: state.name,
      salesforce_id: state.salesforce_id,
      is_returning_caller: isReturningCaller,
      latest_lead: lead,
      original_requested_meeting_time: originalRequestedTime,
      original_confirmed_meeting_time: originalConfirmedTime,
      assigned_sdr: assignedSdr,
      sdr_confirmation: sdrConfirmation,
      new_meeting_time: newMeetingTime,
      salesforce_manually_changed: salesforceManuallyChanged,
      reschedule_detected_at: rescheduleDetectedAt,
      proactive_sms_sent: proactiveSmsSent,
      meeting_status: meetingStatus,
      customer_confirmation: customerConfirmation,
      history: state.history,
      narrative_summary: narrativeSummary,
      likely_reason_for_call: likelyReasonForCall,
    };
  }

  private buildNarrativeSummary(args: {
    name: string;
    isReturningCaller: boolean;
    assignedSdr: string | null;
    originalRequestedTime: string | null;
    originalConfirmedTime: string | null;
    sdrConfirmation: string | null;
    newMeetingTime: string | null;
    salesforceManuallyChanged: boolean;
    proactiveSmsSent: boolean;
    meetingStatus: string | null;
    customerConfirmation: string | null;
  }): string {
    if (!args.isReturningCaller) {
      return "No previous context for this caller.";
    }

    const parts: string[] = [];

    if (args.salesforceManuallyChanged && args.newMeetingTime) {
      parts.push(`${args.name}'s meeting with ${args.assignedSdr ?? "the SDR"} was originally confirmed for ${args.originalConfirmedTime ?? args.originalRequestedTime ?? "a previously agreed time"}.`);
      parts.push(`${args.assignedSdr ?? "The SDR"} later changed the Salesforce meeting time to ${args.newMeetingTime}.`);
      if (args.proactiveSmsSent) {
        parts.push(`${args.name} was just notified by SMS of the change.`);
      }
      parts.push(`Current meeting status: ${args.meetingStatus ?? "unknown"}.`);
      if (args.customerConfirmation) {
        parts.push(`Customer confirmation: ${args.customerConfirmation}.`);
      }
      parts.push(`${args.name} may now be calling because of that change.`);
    } else if (args.assignedSdr && args.originalConfirmedTime) {
      parts.push(`${args.name} has a confirmed meeting with ${args.assignedSdr} for ${args.originalConfirmedTime}.`);
      if (args.sdrConfirmation) {
        parts.push(`SDR confirmation: ${args.sdrConfirmation}.`);
      }
      parts.push(`Meeting status: ${args.meetingStatus ?? "unknown"}.`);
    } else if (args.assignedSdr && args.originalRequestedTime) {
      parts.push(`${args.name} requested a meeting with ${args.assignedSdr} for ${args.originalRequestedTime}.`);
      parts.push(`Meeting status: ${args.meetingStatus ?? "requested"}.`);
    } else if (args.assignedSdr) {
      parts.push(`${args.name} has been assigned to ${args.assignedSdr} for a meeting.`);
      parts.push(`Meeting status: ${args.meetingStatus ?? "requested"}.`);
    }

    return parts.join(" ");
  }

  private buildLikelyReasonForCall(args: {
    name: string;
    assignedSdr: string | null;
    originalConfirmedTime: string | null;
    newMeetingTime: string | null;
    salesforceManuallyChanged: boolean;
    proactiveSmsSent: boolean;
  }): string {
    if (args.salesforceManuallyChanged && args.newMeetingTime) {
      const oldTime = args.originalConfirmedTime ?? "the previously agreed time";
      const sdr = args.assignedSdr ?? "the SDR";
      const parts = [
        `${args.name}'s previously confirmed sales meeting with ${sdr} was just moved from ${oldTime} to ${args.newMeetingTime} in Salesforce.`,
        args.proactiveSmsSent ? `An SMS notifying ${args.name} of the change was sent recently.` : "",
        `${args.name} may be calling about this reschedule.`,
      ].filter(Boolean);
      return parts.join(" ");
    }
    return "";
  }

  async onCall(input: VoiceCallInput): Promise<{ prompt: string }> {
    this.ensureTables();
    const state = await this.getState();
    const now = Date.now();
    const prompt = `Hi ${state.name || "Anusha"}, this is your CustomerAgent. I can see your Salesforce context and your onboarding package status. I will send a follow-up by text so you do not have to stay on the line.`;
    const lifecycleId = this.callLifecycleId("start", input);

    if (lifecycleId && !this.recordCallLifecycleEvent(lifecycleId, "start", now)) {
      this.logProcess(
        state.turn,
        "voice_call_duplicate_ignored",
        "unknown",
        lifecycleId,
      );
      return { prompt };
    }

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
    const lifecycleId = this.callLifecycleId("hangup", input);

    if (lifecycleId && !this.recordCallLifecycleEvent(lifecycleId, "hangup", now)) {
      this.logProcess(
        state.turn,
        "call_hangup_duplicate_ignored",
        "unknown",
        lifecycleId,
      );
      return;
    }

    this.logProcess(state.turn, "call_hangup", "unknown", `from=${input.from}; to=${input.to}`);
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

    const sdrName = this.env.SDR_NAME?.trim() || (await this.env.SECRETS?.get("SDR_NAME")?.then(v => v?.trim())) || SDR_NAME_DEFAULT;
    const sdrEmail = this.env.SDR_EMAIL?.trim() || (await this.env.SECRETS?.get("SDR_EMAIL")?.then(v => v?.trim())) || SDR_EMAIL_DEFAULT;
    const customerName = input.customer_name || state.name || "the customer";
    const requestedTime = input.requested_time || "the requested time";
    const customerContext = input.customer_context || "Interested in learning more about Telnyx. Requested a call with a sales representative.";
    console.log("[actor] emailSdrForConfirmation resolved", { sdrName, sdrEmail, customerName, requestedTime });

    const subject = `New Telnyx sales lead: ${customerName}`;
    const text =
      `Hi ${sdrName},\n\n` +
      `New Telnyx sales lead: ${customerName}.\n\n` +
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

    if (confirmed && state.latest_lead?.id) {
      const meetingTime = state.latest_lead.requested_meeting_time ?? state.latest_lead.meeting_time ?? "the requested time";
      const leadId = state.latest_lead.id;

      console.log("[actor] ingestSdrReply: updating Salesforce on confirm", { leadId, meetingTime, sfTime: meetingTime });
      try {
        const sfResult = await updateLeadMeeting(this.env, {
          lead_id: leadId,
          meeting_status: "confirmed",
          meeting_time: meetingTime,
          sdr_confirmation: "confirmed",
        });
        this.logProcess(state.turn, "sdr_confirm_salesforce_updated", "lead", `lead=${leadId} status=confirmed fields=${sfResult.fields_updated.join(",")} meeting_time_in_actor=${meetingTime}`);
      } catch (err) {
        console.error("[actor] ingestSdrReply: Salesforce update failed", err instanceof Error ? err.message : String(err));
        this.logProcess(state.turn, "sdr_confirm_salesforce_failed", "lead", String(err instanceof Error ? err.message : "unknown error"));
      }

      const updatedLead = state.latest_lead
        ? {
            ...state.latest_lead,
            meeting_time: meetingTime,
            meeting_status: "confirmed",
            sdr_confirmation: "confirmed",
          }
        : null;

      const customerPhone = input.phone_e164 || state.phone_e164;
      const confirmationSms = `Your meeting with ${sdrName} is confirmed for ${meetingTime}.`;

      const nextHistory: HistoryEntry[] = [
        ...(state.history ?? []),
        { role: "assistant", content: confirmationSms, at: now },
      ];

      await this.setState({
        latest_lead: updatedLead,
        history: nextHistory,
        at: now,
      });

      await this.messages.add("assistant", confirmationSms);
      this.ctx.storage.sql.exec(
        "INSERT INTO conversation(role, content, at) VALUES (?, ?, ?)",
        "assistant",
        confirmationSms,
        now,
      );

      if (state.proactive_consent && state.to && customerPhone) {
        if (smsTransportEnabled(this.env)) {
          try {
            await telnyx(this.env).messages.send({ from: state.to, to: customerPhone, text: confirmationSms });
            this.logProcess(state.turn, "sdr_confirm_sms_sent", "lead", confirmationSms);
          } catch {
            this.logProcess(state.turn, "sdr_confirm_sms_failed", "lead", confirmationSms);
          }
        } else {
          this.logProcess(state.turn, "sdr_confirm_sms_mocked", "lead", confirmationSms);
        }
      }
    }

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
      `CREATE TABLE IF NOT EXISTS call_lifecycle_events(event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL)`,
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

  private callLifecycleId(kind: "start" | "hangup", input: VoiceCallInput): string | null {
    const callId = input.call_control_id ?? input.call_session_id;
    return callId ? `${kind}:${callId}` : null;
  }

  private recordCallLifecycleEvent(eventId: string, kind: "start" | "hangup", at: number): boolean {
    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO call_lifecycle_events(event_id, kind, at) VALUES (?, ?, ?)",
        eventId,
        kind,
        at,
      );
      return true;
    } catch {
      return false;
    }
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
