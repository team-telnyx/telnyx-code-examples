/**
 * CustomerAgent — THE Entity Agent.
 *
 * The actor IS the customer. Not a conversation. Not a session. A durable
 * entity that lives across channels (voice/SMS/WhatsApp), across days,
 * across interactions. No external state machine. No queue infrastructure.
 * No context reconstruction.
 *
 * Key insight (Ian Reither, Aug 10): "The Assistant isn't the durable
 * object. Ian is." The AI Assistant is the reasoning/voice harness INSIDE
 * the agent; the agent owns the durable state.
 *
 * Addressing: one actor per customer, keyed by E.164 phone number via
 * `idFromName("+13125550100")`. The actor survives across days, calls,
 * SMS messages, and actor evictions. When Ian calls again tomorrow, the
 * same actor wakes up with full context — no reconstruction needed.
 */

import { Agent, type ActorContext, type ActorNamespace, type ActorStub, type Secrets } from "@telnyx/edge-runtime";
import { type TelnyxBinding } from "./messaging";
import { createLLMClient, type LLMClient } from "./llm";
import { SalesforceClient } from "./salesforce";
import { buildInboundTeXml } from "./voice";
import {
  type CustomerState,
  type InteractionRecord,
  type ShipmentRecord,
  initialCustomerState,
  recordInteraction,
} from "./state";

const THREE_DAYS_SECONDS = 3 * 24 * 3600;
const MAX_HISTORY_ENTRIES = 50;

export class CustomerAgent extends Agent<Env, CustomerState> {
  private llm: LLMClient | null = null;
  private sf: SalesforceClient | null = null;

  constructor(ctx: ActorContext, env: Env) {
    super(ctx, env);
  }

  protected initialState(): CustomerState {
    const id = this.ctx.id.toString();
    const phoneE164 = id.startsWith("+") ? id : `+${id}`;
    return initialCustomerState(phoneE164, "Ian");
  }

  // ── Lazy resource builders ───────────────────────────────────────────

  private async getLLM(): Promise<LLMClient> {
    if (!this.llm) {
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
      this.llm = createLLMClient(apiKey || undefined);
    }
    return this.llm;
  }

  private async getSalesforce(): Promise<SalesforceClient> {
    if (!this.sf) {
      const useMock = (await this.env.SECRETS.get("USE_MOCK_SALESFORCE")) !== "false";
      this.sf = new SalesforceClient({
        useMock,
        clientId: await this.env.SECRETS.get("SALESFORCE_CLIENT_ID").catch(() => undefined),
        clientSecret: await this.env.SECRETS.get("SALESFORCE_CLIENT_SECRET").catch(() => undefined),
        username: await this.env.SECRETS.get("SALESFORCE_USERNAME").catch(() => undefined),
        password: await this.env.SECRETS.get("SALESFORCE_PASSWORD").catch(() => undefined),
        token: await this.env.SECRETS.get("SALESFORCE_TOKEN").catch(() => undefined),
      });
    }
    return this.sf;
  }

  // ── Inbound call (AC2: Inbound call → Agent answers via AI Assistant) ─

  async handleCall(callControlId: string, from: string, to: string): Promise<{ texml: string }> {
    const state = await this.getState();
    const assistantId = await this.env.SECRETS.get("TELNYX_AI_ASSISTANT_ID").catch(() => undefined);
    const texml = buildInboundTeXml(state.name, assistantId || undefined);

    await this.appendInteraction("voice", `Inbound call from ${from}`, "inbound");
    await this.setState({
      last_interaction_at: new Date().toISOString(),
      interaction_count: state.interaction_count + 1,
    });

    return { texml };
  }

  // ── Call ended (AC3: Hangup → Agent sends SMS follow-up) ──────────────

  async onCallEnded(callControlId: string, duration: number): Promise<void> {
    await this.appendInteraction("voice", `Call ended (${duration}s)`, "outbound");
    await this.queue("sendFollowupSMS");
  }

  async sendFollowupSMS(): Promise<void> {
    const state = await this.getState();
    if (!state.proactive_consent) return;

    const lastInteraction = state.history[state.history.length - 1];
    const llm = await this.getLLM();
    const message = await llm.draftFollowup(state.name, lastInteraction?.summary ?? "recent call");

    const from = (await this.env.SECRETS.get("TELNYX_FROM_NUMBER").catch(() => "")) || "+13125550100";
    await this.env.TELNYX.messages.send({ to: this.normalizePhone(state.phone_e164), from, text: message });

    await this.appendInteraction("sms", `Follow-up SMS sent: "${message.slice(0, 80)}..."`, "proactive");
  }

  // ── Inbound SMS (AC4: SMS response next day → same agent, full context) ─

  async handleSMS(from: string, to: string, text: string): Promise<void> {
    const state = await this.getState();
    const llm = await this.getLLM();

    const intent = await llm.classifyIntent(text);
    if (intent === "escalation") {
      await this.escalateToHuman(`Customer SMS: "${text}"`);
      return;
    }

    await this.messages.add("user", text);

    const history = await this.messages.all();
    const reply = await llm.draftReply(history, state.name, text);
    await this.messages.add("assistant", reply);

    const fromNumber = (await this.env.SECRETS.get("TELNYX_FROM_NUMBER").catch(() => "")) || to;
    await this.env.TELNYX.messages.send({ to: from, from: fromNumber, text: reply });

    await this.appendInteraction("sms", `SMS: "${text.slice(0, 80)}..." → "${reply.slice(0, 80)}..."`, "inbound");
    await this.setState({
      last_interaction_at: new Date().toISOString(),
      interaction_count: state.interaction_count + 1,
    });
  }

  // ── Human-in-the-loop (AC5: escalation with wait + resume) ───────────

  async escalateToHuman(reason: string): Promise<{ escalated: true }> {
    const now = new Date().toISOString();
    await this.setState({
      escalation_pending: true,
      escalation_started_at: now,
      escalation_reason: reason,
    });

    await this.appendInteraction("human-escalation", `Escalated: ${reason}`, "inbound");

    return { escalated: true };
  }

  async resumeEscalation(replyText: string): Promise<void> {
    const state = await this.getState();
    if (!state.escalation_pending) return;

    await this.setState({
      escalation_pending: false,
      escalation_started_at: null,
      escalation_reason: null,
    });

    await this.messages.add("assistant", `[Human agent] ${replyText}`);

    if (state.preferred_channel === "sms") {
      const from = (await this.env.SECRETS.get("TELNYX_FROM_NUMBER").catch(() => "")) || "+13125550100";
      await this.env.TELNYX.messages.send({ to: state.phone_e164, from, text: replyText });
    }

    await this.appendInteraction("human-escalation", `Human replied: "${replyText.slice(0, 80)}..."`, "outbound");
  }

  // ── Self-waking (AC6: 3-day timer → agent wakes itself) ──────────────

  async watchShipment(salesforceId: string): Promise<{ scheduled: true }> {
    const id = await this.schedule(THREE_DAYS_SECONDS, "checkShipmentStatus", { salesforce_id: salesforceId });
    const state = await this.getState();
    await this.setState({ active_schedule_ids: [...state.active_schedule_ids, id] });
    return { scheduled: true };
  }

  async checkShipmentStatus(payload: unknown): Promise<void> {
    const state = await this.getState();
    if (!state.proactive_consent) return;

    const p = payload as { salesforce_id?: string };
    if (!p?.salesforce_id) return;

    const sf = await this.getSalesforce();
    const shipments = await sf.getShipments(state.salesforce_id || p.salesforce_id);

    for (const shipment of shipments) {
      const existing = state.shipments.find((s) => s.salesforce_id === shipment.salesforce_id);
      if (!existing || existing.status !== shipment.status) {
        const llm = await this.getLLM();
        const message = await llm.draftProactive(state.name, shipment.status, shipment.tracking_number);

        const from = (await this.env.SECRETS.get("TELNYX_FROM_NUMBER").catch(() => "")) || "+13125550100";
        await this.env.TELNYX.messages.send({ to: this.normalizePhone(state.phone_e164), from, text: message });

        await this.appendInteraction("sms", `Proactive SMS: shipment "${shipment.salesforce_id}" → "${shipment.status}"`, "proactive");
      }
    }

    await this.setState({ shipments });

    await this.schedule(THREE_DAYS_SECONDS, "checkShipmentStatus", payload);
  }

  // ── Salesforce webhook (AC7: status change → agent updates) ──────────

  async ingestSalesforceUpdate(update: {
    salesforce_id: string;
    status: string;
    tracking_number?: string;
    estimated_delivery?: string;
  }): Promise<void> {
    const sf = await this.getSalesforce();
    await sf.updateShipmentStatus(update);

    const state = await this.getState();
    const shipments = state.shipments.map((s) =>
      s.salesforce_id === update.salesforce_id
        ? { ...s, status: update.status, tracking_number: update.tracking_number ?? s.tracking_number, estimated_delivery: update.estimated_delivery ?? s.estimated_delivery, last_updated: new Date().toISOString() }
        : s,
    );

    await this.setState({ shipments });

    if (state.proactive_consent) {
      const llm = await this.getLLM();
      const message = await llm.draftProactive(state.name, update.status, update.tracking_number);
      const from = (await this.env.SECRETS.get("TELNYX_FROM_NUMBER").catch(() => "")) || "+13125550100";
      await this.env.TELNYX.messages.send({ to: this.normalizePhone(state.phone_e164), from, text: message });
      await this.appendInteraction("sms", `Salesforce update → proactive SMS: "${update.status}"`, "proactive");
    }
  }

  // ── Second call from Ian (AC8: no context reconstruction) ───────────

  async getCustomerContext(): Promise<CustomerState> {
    return this.getState();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private normalizePhone(phone: string): string {
    return phone.startsWith("+") ? phone : `+${phone}`;
  }

  private async appendInteraction(
    channel: InteractionRecord["channel"],
    summary: string,
    direction: InteractionRecord["direction"] = "inbound",
  ): Promise<void> {
    const state = await this.getState();
    const interaction = recordInteraction(channel, summary, direction);
    const history = [...state.history, interaction].slice(-MAX_HISTORY_ENTRIES);
    await this.setState({ history });
  }
}

// ── Type narrowing (real deploys get this from `telnyx types`) ─────────

type CustomerStub = ActorStub &
  Pick<
    CustomerAgent,
    | "handleCall"
    | "onCallEnded"
    | "sendFollowupSMS"
    | "handleSMS"
    | "escalateToHuman"
    | "resumeEscalation"
    | "watchShipment"
    | "checkShipmentStatus"
    | "ingestSalesforceUpdate"
    | "getCustomerContext"
  >;

export interface CustomerNamespace extends ActorNamespace {
  idFromName(name: string): CustomerStub;
}

export interface Env {
  AGENT: CustomerNamespace;
  TELNYX: TelnyxBinding;
  SECRETS: Secrets;
}
