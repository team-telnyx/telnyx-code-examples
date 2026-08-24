import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import app from "../src/index.js";
import { buildGraph } from "../src/graph.js";
import { lookupLatestLead, updateLeadDemoField, updateShipmentStatus } from "../src/salesforce.js";
import {
  demoCustomerName,
  demoCustomerSalesforceId,
  demoFromNumber,
  modelId,
  smsTransportEnabled,
} from "../src/types.js";
import type {
  CustomerContext,
  CustomerState,
  Env,
  EventsResponse,
  GraphExecution,
  HistoryEntry,
  Intent,
  ProcessLogEvent,
  ReceiveMessageInput,
  SalesforceUpdateInput,
  LeadUpdateInput,
  HumanEscalationInput,
  HumanReplyInput,
  ScheduleFollowupInput,
  VoiceCallInput,
} from "../src/types.js";

const PORT = Number(process.env.PORT || "8787");
const NUDGE_TEXT = "Just checking in - did that sort things out?";

loadDotEnv();

const env = createLocalEnv();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));

  const url = `http://localhost:${PORT}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value) headers.set(key, value);
  }

  const request = new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });

  try {
    const response = await app.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "local dev error" }));
  }
}).listen(PORT, () => {
  console.log(`CustomerAgent local dev server listening on http://localhost:${PORT}`);
  console.log(`SMS transport: ${smsTransportEnabled(env) ? "production" : "demo"}`);
  console.log(`Demo customer: ${process.env.DEMO_CUSTOMER_NAME || "Anusha"} from ${process.env.DEMO_SENDER_NUMBER || "+14157986793"}`);
});

function createLocalEnv(): Env {
  const actors = new Map<string, LocalCustomer>();
  const localEnv = {
    DEMO_MODE: process.env.DEMO_MODE || "true",
    SMS_TRANSPORT: process.env.SMS_TRANSPORT || "demo",
    DEMO_FROM_NUMBER: process.env.DEMO_FROM_NUMBER || "+16282564467",
    DEMO_SENDER_NUMBER: process.env.DEMO_SENDER_NUMBER || "+14157986793",
    DEMO_CUSTOMER_NAME: process.env.DEMO_CUSTOMER_NAME || "Anusha",
    DEMO_CUSTOMER_SALESFORCE_ID: process.env.DEMO_CUSTOMER_SALESFORCE_ID || "mock-anusha-salesforce-id",
    USE_MOCK_SALESFORCE: process.env.USE_MOCK_SALESFORCE || "true",
    SF_WRITE_MODE: process.env.SF_WRITE_MODE || "mock",
    SF_CLIENT_ID: process.env.SF_CLIENT_ID,
    SF_CLIENT_SECRET: process.env.SF_CLIENT_SECRET,
    SF_DOMAIN: process.env.SF_DOMAIN || "login",
    SF_API_VERSION: process.env.SF_API_VERSION || "v58.0",
    SF_DEMO_LEAD_EMAIL: process.env.SF_DEMO_LEAD_EMAIL,
    MODEL: process.env.MODEL || "zai-org/GLM-5.2",
    CUSTOMERS: {
      idFromName(name: string) {
        let actor = actors.get(name);
        if (!actor) {
          actor = new LocalCustomer(name, localEnv as Env);
          actors.set(name, actor);
        }
        return actor;
      },
    },
    TELNYX: {
      messages: {
        async send(message: { from: string; to: string; text: string }) {
          console.log("[local telnyx.messages.send]", JSON.stringify(message));
          return { data: { id: `local-message-${crypto.randomUUID()}` } };
        },
      },
      ai: {
        openai: {
          chat: {
            async createCompletion(request: { messages: Array<{ role: string; content: string }> }) {
              return { choices: [{ message: { content: localCompletion(request.messages) } }] };
            },
          },
        },
      },
    },
    SECRETS: {
      async get(binding: string) {
        const value = process.env[binding];
        if (!value) throw new Error(`${binding} is not set`);
        return value;
      },
    },
  };
  return localEnv as Env;
}

class LocalCustomer {
  private state: CustomerState;
  private conversation: Array<HistoryEntry & { id: number }> = [];
  private processLog: ProcessLogEvent[] = [];
  private graphExecution: GraphExecution | null = null;
  private webhookEventIds = new Set<string>();

  constructor(private readonly actorName: string, private readonly env: Env) {
    this.state = {
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
    if (this.webhookEventIds.has(eventId)) return;
    this.webhookEventIds.add(eventId);

    const now = Date.now();
    const turn = this.state.turn + 1;
    this.addConversation("user", text, now);
    this.state = {
      ...this.state,
      phone_e164: from,
      to,
      turn,
      queuedTurn: turn,
      history: [...this.state.history, { role: "user", content: text, at: now }],
    };
    this.log(turn, "receive", "unknown", `actor=${this.actorName}; text="${text.slice(0, 80)}"`);
    await this.process();
  }

  async process(): Promise<void> {
    if (!this.state.phone_e164 || !this.state.to) return;
    const targetTurn = this.state.queuedTurn;
    if (targetTurn <= this.state.lastSentTurn) return;

    this.state = { ...this.state, processingTurn: targetTurn };
    this.log(targetTurn, "process_start", "unknown", `target=${targetTurn}`);

    const graph = buildGraph(this.env, modelId(this.env));
    const out = await graph.invoke({
      messages: this.state.history.map((m) =>
        m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
    });
    const reply = String(out.replyText ?? "").trim() || "I'll get back to you shortly.";
    const intent = (out.intentLabel as Intent) || "unknown";
    const path = (out.nodePath ?? []).join("->");
    const now = Date.now();

    this.graphExecution = {
      turn: targetTurn,
      intent,
      path,
      historyCount: Number(out.historyCount ?? 0),
      orderId: String(out.recordId ?? ""),
      actionResult: String(out.actionResult ?? ""),
      reply,
      at: now,
    };
    this.addConversation("assistant", reply, now);

    if (smsTransportEnabled(this.env)) {
      await this.env.TELNYX.messages.send({ from: this.state.to, to: this.state.phone_e164, text: reply });
      this.log(targetTurn, "sms_sent", intent, reply);
    } else {
      this.log(targetTurn, "sms_mocked", intent, reply);
    }

    this.state = {
      ...this.state,
      history: [...this.state.history, { role: "assistant", content: reply, at: now }],
      lastSentTurn: targetTurn,
      processingTurn: 0,
      pendingOutbound: null,
      lastIntent: intent,
      at: now,
      latest_lead: intent === "lead" ? await lookupLatestLead(this.env).catch(() => this.state.latest_lead) : this.state.latest_lead,
    };
  }

  async nudge(): Promise<void> {
    this.log(this.state.turn, "nudge", "unknown", NUDGE_TEXT);
  }

  async ingestSalesforceUpdate(update: SalesforceUpdateInput): Promise<void> {
    await updateShipmentStatus(this.env, {
      salesforce_id: update.salesforce_id,
      status: update.status,
      tracking_number: update.tracking_number,
      estimated_delivery: update.estimated_delivery,
    });
    const now = Date.now();
    const shipment = {
      id: update.order_id,
      salesforce_id: update.salesforce_id,
      status: update.status,
      eta: update.estimated_delivery ?? "unknown",
      carrier: "Telnyx Logistics",
      tracking_number: update.tracking_number,
    };
    const message = `Shipment ${update.order_id} update: ${update.status}${shipment.eta !== "unknown" ? `, ETA ${shipment.eta}` : ""}.`;
    this.state = {
      ...this.state,
      phone_e164: update.phone_e164,
      shipments: [
        ...this.state.shipments.filter((s) => s.salesforce_id !== update.salesforce_id && s.id !== update.order_id),
        shipment,
      ],
      at: now,
    };
    this.addConversation("assistant", message, now);
    this.log(this.state.turn, smsTransportEnabled(this.env) ? "salesforce_sms_sent" : "salesforce_sms_mocked", "order", message);
    if (smsTransportEnabled(this.env)) {
      await this.env.TELNYX.messages.send({ from: this.state.to, to: update.phone_e164, text: message });
    }
  }

  async updateLeadFromAgent(input: LeadUpdateInput): Promise<{ lead_id: string; field: string; value: string }> {
    const now = Date.now();
    const value = input.value?.trim()
      || `Updated by CustomerAgent for ${this.state.name || "Anusha"} at ${new Date(now).toISOString()}`;
    const result = await updateLeadDemoField(this.env, {
      lead_id: input.lead_id,
      field: input.field,
      value,
    });
    const message = `I updated the CustomerAgent Demo record in Salesforce: ${result.value}.`;

    this.state = {
      ...this.state,
      phone_e164: input.phone_e164 || this.state.phone_e164,
      salesforce_id: result.lead.id,
      latest_lead: result.lead,
      history: [...this.state.history, { role: "assistant", content: message, at: now }],
      at: now,
    };
    this.addConversation("assistant", message, now);
    if (input.send_sms !== false) {
      this.log(this.state.turn, smsTransportEnabled(this.env) ? "salesforce_lead_sms_sent" : "salesforce_lead_sms_mocked", "lead", message);
    }
    this.log(this.state.turn, "salesforce_lead_updated", "lead", `lead=${result.lead.id}; field=${result.field}`);
    if (input.send_sms !== false && smsTransportEnabled(this.env) && this.state.to && this.state.phone_e164) {
      await this.env.TELNYX.messages.send({ from: this.state.to, to: this.state.phone_e164, text: message });
    }
    return { lead_id: result.lead.id, field: result.field, value: result.value };
  }

  async requestHumanEscalation(input: HumanEscalationInput): Promise<{ ticket_id: string }> {
    const now = Date.now();
    const ticketId = `hitl-${now}`;
    const message = `I need an internal approval before I can promise the expedited onboarding package. I pulled in a human for: ${input.reason}.`;
    this.state = {
      ...this.state,
      phone_e164: input.phone_e164,
      escalation_pending: { reason: input.reason, started_at: now, ticket_id: ticketId },
      open_tickets: [...this.state.open_tickets, { id: ticketId, subject: input.reason, status: "waiting_for_human" }],
      history: [...this.state.history, { role: "assistant", content: message, at: now }],
      at: now,
    };
    this.addConversation("assistant", message, now);
    this.log(this.state.turn, "human_escalation_wait", "unknown", `ticket=${ticketId}; reason=${input.reason}`);
    return { ticket_id: ticketId };
  }

  async resumeHumanEscalation(input: HumanReplyInput): Promise<void> {
    const now = Date.now();
    const ticketId = this.state.escalation_pending?.ticket_id;
    const message = `Good news, Anusha. A specialist approved the expedited onboarding package. ${input.reply_text}`;
    this.state = {
      ...this.state,
      phone_e164: input.phone_e164,
      escalation_pending: null,
      open_tickets: this.state.open_tickets.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, status: "resolved" } : ticket,
      ),
      history: [...this.state.history, { role: "assistant", content: message, at: now }],
      at: now,
    };
    this.addConversation("assistant", message, now);
    this.log(this.state.turn, smsTransportEnabled(this.env) ? "human_resume_sms_sent" : "human_resume_sms_mocked", "unknown", message);
    this.log(this.state.turn, "human_escalation_resume", "unknown", `ticket=${ticketId ?? "none"}`);
    if (smsTransportEnabled(this.env) && this.state.to && input.phone_e164) {
      await this.env.TELNYX.messages.send({ from: this.state.to, to: input.phone_e164, text: message });
    }
  }

  async scheduleLeadFollowup(input: ScheduleFollowupInput): Promise<{ schedule_id: string; delay_seconds: number }> {
    const delay = Math.max(1, Math.floor(input.delay_seconds ?? 259200));
    const scheduleId = `local-lead-followup-${Date.now()}`;
    this.state = {
      ...this.state,
      phone_e164: input.phone_e164 || this.state.phone_e164,
      active_schedule_ids: [...this.state.active_schedule_ids, scheduleId],
      at: Date.now(),
    };
    this.log(this.state.turn, "schedule_created", "lead", `id=${scheduleId}; delay=${delay}`);
    setTimeout(() => void this.sendScheduledLeadFollowup(input.reason ?? "lead_followup"), Math.min(delay * 1000, 2 ** 31 - 1));
    return { schedule_id: scheduleId, delay_seconds: delay };
  }

  async sendScheduledLeadFollowup(reason = "lead_followup"): Promise<void> {
    const now = Date.now();
    const message = `Anusha, your onboarding package is now ready. ${reason}`;
    this.state = {
      ...this.state,
      active_schedule_ids: [],
      history: [...this.state.history, { role: "assistant", content: message, at: now }],
      at: now,
    };
    this.addConversation("assistant", message, now);
    this.log(this.state.turn, smsTransportEnabled(this.env) ? "scheduled_sms_sent" : "scheduled_sms_mocked", "lead", message);
    if (smsTransportEnabled(this.env) && this.state.to && this.state.phone_e164) {
      await this.env.TELNYX.messages.send({ from: this.state.to, to: this.state.phone_e164, text: message });
    }
  }

  async onCall(input: VoiceCallInput): Promise<{ prompt: string }> {
    const now = Date.now();
    const prompt = `Hi ${this.state.name || "Anusha"}, this is your CustomerAgent. I can see your Salesforce context and your onboarding package status. I will send a follow-up by text so you do not have to stay on the line.`;
    this.state = {
      ...this.state,
      phone_e164: input.from,
      to: input.to,
      preferred_channel: "voice",
      history: [...this.state.history, { role: "user", content: `Inbound call ${input.call_control_id ?? input.call_session_id ?? ""}`.trim(), at: now }],
      at: now,
    };
    this.addConversation("user", "Inbound voice call", now);
    this.log(this.state.turn, "voice_call_started", "unknown", `from=${input.from}; to=${input.to}`);
    return { prompt };
  }

  async onCallEnded(input: VoiceCallInput): Promise<void> {
    const now = Date.now();
    const message = "Thanks for calling, Anusha. I'll keep this thread updated with your onboarding status. You can reply here any time.";
    this.state = {
      ...this.state,
      phone_e164: input.from || this.state.phone_e164,
      to: input.to || this.state.to,
      preferred_channel: "sms",
      history: [...this.state.history, { role: "assistant", content: message, at: now }],
      at: now,
    };
    this.addConversation("assistant", message, now);
    this.log(this.state.turn, smsTransportEnabled(this.env) ? "call_hangup_sms_sent" : "call_hangup_sms_mocked", "unknown", message);
    if (smsTransportEnabled(this.env) && input.from && input.to) {
      await this.env.TELNYX.messages.send({ from: input.to, to: input.from, text: message });
    }
  }

  async getEvents(limit = 50): Promise<EventsResponse> {
    return {
      conversation: this.conversation.slice(-limit).map(({ role, content, at }) => ({ role, content, at })),
      processLog: this.processLog.slice(-limit).reverse(),
      graphExecution: this.graphExecution,
      turnState: {
        turn: this.state.turn,
        queuedTurn: this.state.queuedTurn,
        processingTurn: this.state.processingTurn,
        lastSentTurn: this.state.lastSentTurn,
        pendingOutbound: this.state.pendingOutbound,
      },
    };
  }

  async getContext(): Promise<CustomerContext> {
    return {
      customer: {
        phone_e164: this.state.phone_e164,
        name: this.state.name,
        salesforce_id: this.state.salesforce_id,
        preferred_channel: this.state.preferred_channel,
        proactive_consent: this.state.proactive_consent,
        open_tickets: this.state.open_tickets,
        shipments: this.state.shipments,
        latest_lead: this.state.latest_lead,
        escalation_pending: this.state.escalation_pending,
        active_schedule_ids: this.state.active_schedule_ids,
        turn: this.state.turn,
        queuedTurn: this.state.queuedTurn,
        processingTurn: this.state.processingTurn,
        lastSentTurn: this.state.lastSentTurn,
        lastIntent: this.state.lastIntent,
        at: this.state.at,
      },
      history: this.state.history,
    };
  }

  private addConversation(role: HistoryEntry["role"], content: string, at: number): void {
    this.conversation.push({ id: this.conversation.length + 1, role, content, at });
  }

  private log(turn: number, phase: string, intent: string, note: string): void {
    this.processLog.push({ id: this.processLog.length + 1, turn, phase, intent, note, at: Date.now() });
  }
}

function localCompletion(messages: Array<{ role: string; content: string }>): string {
  const system = messages.find((m) => m.role === "system")?.content.toLowerCase() ?? "";
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (system.includes("classify")) {
    return /\b(lead|salesforce|crm|prospect|mql|latest record|onboarding|package|status update|status)\b/i.test(lastUser) ? "lead" : "smalltalk";
  }
  if (/\b(lead|salesforce|crm|prospect|mql|latest record|onboarding|package|status update|status)\b/i.test(lastUser)) {
    return "I still have the context from your call. Your Salesforce record shows onboarding is in progress, and I can check whether this can be expedited.";
  }
  return "Hi Anusha - I can help with your onboarding context, Salesforce status, or escalation.";
}

function loadDotEnv(): void {
  const path = ".env";
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] ??= value;
  }
}
