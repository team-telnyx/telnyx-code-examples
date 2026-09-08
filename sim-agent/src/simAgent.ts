import { Agent } from "@telnyx/edge-runtime";

// ---------------------------------------------------------------------------
// SIMAgent — The actor IS the SIM card.
// A durable entity that tracks data usage, proactively alerts on thresholds,
// and auto-provisions upgrades through the [telnyx] binding.
// ---------------------------------------------------------------------------

export interface UsageEvent {
  date: string;
  usageMB: number;
  event: string;
}

export interface SIMState extends Record<string, unknown> {
  simId: string;
  /** Customer phone number (E.164) this SIM belongs to. */
  phoneNumber: string;
  plan: {
    name: string;
    dataLimitMB: number;
  };
  usageMB: number;
  alerts: { threshold: number; sent: boolean }[];
  billingCycleStart: string; // ISO date string
  history: UsageEvent[];
  liveMode: boolean;
  /** Inference model used for plan Q&A; passed through from env. */
  model: string;
  error: string;
}

/**
 * Bindings visible inside the actor. `[telnyx]` exposes the real Telnyx API
 * client (messaging, inference, SIM cards); the remaining entries come from
 * `[env_vars]` in telnyx.toml.
 */
interface SIMEnv {
  TELNYX: {
    messages: {
      send(message: { from: string; to: string; text: string }): Promise<unknown>;
    };
    simCards: {
      update(
        simId: string,
        params: {
          data_limit?: { amount?: string; unit?: "MB" | "GB" };
          sim_card_group_id?: string;
          tags?: string[];
        },
      ): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(request: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
        };
      };
    };
  };
  TELNYX_SMS_FROM_NUMBER: string;
  DEMO_MODE?: string; // "true" (default) | "false"
  USAGE_CHECK_SECONDS?: string;
  BILLING_CYCLE_SECONDS?: string;
}

export interface PlanPreset {
  name: string;
  dataLimitMB: number;
}

export const PLAN_PRESETS: Record<string, PlanPreset> = {
  "1gb": { name: "1GB Starter", dataLimitMB: 1024 },
  "5gb": { name: "5GB", dataLimitMB: 5120 },
  "10gb": { name: "10GB", dataLimitMB: 10240 },
  "20gb": { name: "20GB", dataLimitMB: 20480 },
  unlimited: { name: "Unlimited", dataLimitMB: 100000 },
};

export const DEFAULT_MODEL = "zai-org/GLM-5.2";
const DATA_THRESHOLD = 0.8; // 80%

export class SIMAgent extends Agent<SIMEnv, SIMState> {
  protected override initialState(): SIMState {
    return {
      simId: "",
      phoneNumber: "",
      plan: { name: "1GB Starter", dataLimitMB: 1024 },
      usageMB: 0,
      alerts: [{ threshold: 80, sent: false }],
      billingCycleStart: new Date().toISOString(),
      history: [],
      liveMode: false,
      model: DEFAULT_MODEL,
      error: "",
    };
  }

  /**
   * First contact: stamp the SIM identity onto durable state and arm the
   * recurring schedules (stable ids make re-arming on every activation an
   * upsert, like edge-cron-scheduler's `initialize`).
   */
  async initialize(params: { simId: string; phoneNumber?: string; plan?: string }): Promise<SIMState> {
    if (!params.simId) throw new Error("simId is required");
    const state = await this.getState();
    const preset = params.plan ? this.preset(params.plan) : state.plan;
    const next = await this.setState({
      simId: params.simId,
      phoneNumber: params.phoneNumber || state.phoneNumber,
      plan: preset,
      liveMode: this.env.DEMO_MODE === "false",
      model: DEFAULT_MODEL,
      billingCycleStart: state.billingCycleStart || new Date().toISOString(),
      error: "",
    });
    await this.ensureSchedules();
    await this.record("sim.initialized", `SIM ${params.simId} initialized on plan ${preset.name}`);
    return next;
  }

  // ------------------------------------------------------------------
  // Usage ingest — data-usage events from Telnyx (webhook or demo feed)
  // ------------------------------------------------------------------
  async recordUsage(params: { deltaMB: number; source?: string }): Promise<SIMState> {
    if (!Number.isFinite(params.deltaMB) || params.deltaMB < 0) throw new Error("deltaMB must be a non-negative number");
    const state = await this.getState();
    if (!state.simId) throw new Error("sim is not initialized");
    const delta = Math.round(params.deltaMB * 100) / 100;
    await this.setState({
      usageMB: state.usageMB + delta,
      history: this.trimHistory([
        ...state.history,
        { date: new Date().toISOString(), usageMB: delta, event: params.source || "usage_update" },
      ]),
    });
    await this.record("usage.recorded", `+${delta} MB recorded on SIM ${state.simId}`);
    await this.checkThresholds();
    return this.getState();
  }

  // ------------------------------------------------------------------
  // Threshold monitoring — proactive SMS when usage crosses 80 %
  // ------------------------------------------------------------------
  async checkThresholds(): Promise<void> {
    const state = await this.getState();
    if (!state.simId || state.alerts[0].sent) return;
    const pct = (state.usageMB / state.plan.dataLimitMB) * 100;
    if (pct >= DATA_THRESHOLD * 100) {
      await this.sendSms(
        this.customerNumber(state),
        `You've used ${Math.round(pct)}% of your data on SIM ${state.simId}. Reply "options" for upgrade plans.`,
      );
      await this.setState({
        alerts: [{ threshold: 80, sent: true }],
      });
      await this.record("threshold.alert", `Usage crossed ${Math.round(pct)}% of the plan limit`);
    }
  }

  // ------------------------------------------------------------------
  // SMS command handler — plan comparison + provisioning over SMS
  // ------------------------------------------------------------------
  async handleSms(params: { from: string; text: string }): Promise<void> {
    const state = await this.getState();
    if (!state.simId) throw new Error("sim is not initialized");
    if (!params.from || !params.text.trim()) throw new Error("from and text are required");
    await this.record("sms.received", params.text);
    await this.messages.add("user", params.text);

    const lower = params.text.toLowerCase().trim();

    if (lower.includes("options") || lower.includes("plans") || lower.includes("what are my")) {
      const reply = await this.planOptionsReply();
      await this.sendSms(params.from, reply);
      return;
    }

    if (lower.includes("upgrade")) {
      const planName = this.extractPlanName(lower);
      if (!planName) {
        await this.sendSms(params.from, 'Please specify a plan: "upgrade to 10GB" or "upgrade to 5GB".');
        return;
      }
      await this.provisionUpgrade(planName);
      const next = await this.getState();
      await this.sendSms(params.from, `Upgrade to ${next.plan.name} complete! New limit: ${next.plan.dataLimitMB}MB.`);
      return;
    }

    if (lower.includes("usage") || lower.includes("history") || lower.includes("summary")) {
      const summary = this.usageSummary(await this.getState());
      await this.sendSms(params.from, summary);
      return;
    }

    // Default: inference-powered natural language response.
    const reply = await this.llmReply(params.text);
    await this.sendSms(params.from, reply);
  }

  // ------------------------------------------------------------------
  // Call Control — the worker speaks this summary to inbound callers
  // ------------------------------------------------------------------
  async handleInboundCall(): Promise<{ message: string; state: SIMState }> {
    const state = await this.getState();
    if (!state.simId) throw new Error("sim is not initialized");
    await this.record("customer.call", "Answered an inbound customer call with current usage history");
    return { message: this.usageSummary(state), state };
  }

  // ------------------------------------------------------------------
  // Auto-provisioning upgrade through the [telnyx] binding
  // ------------------------------------------------------------------
  async provisionUpgrade(planName: string): Promise<SIMState> {
    const preset = this.preset(planName);
    const state = await this.getState();
    if (!state.simId) throw new Error("sim is not initialized");
    if (state.liveMode) {
      // Real provisioning: the individual data limit is configured on the SIM
      // card itself (POST /v2/sim_cards/{id} with data_limit).
      await this.env.TELNYX.simCards.update(state.simId, {
        data_limit: { amount: String(Math.round(preset.dataLimitMB / 1024)), unit: "GB" },
      });
    }
    const next = await this.setState({
      plan: preset,
      alerts: [{ threshold: 80, sent: false }], // reset alert for the new limit
      history: this.trimHistory([
        ...state.history,
        { date: new Date().toISOString(), usageMB: 0, event: `upgrade_to_${planName}` },
      ]),
    });
    await this.record("plan.upgraded", `Plan upgraded to ${preset.name} (${preset.dataLimitMB}MB)`);
    return next;
  }

  // ------------------------------------------------------------------
  // Billing cycle reset — scheduled task
  // ------------------------------------------------------------------
  async resetBillingCycle(): Promise<void> {
    const state = await this.getState();
    if (!state.simId) throw new Error("sim is not initialized");
    await this.sendSms(
      this.customerNumber(state),
      `Billing cycle ended.\n${this.usageSummary(state)}\nCounters reset for the new cycle.`,
    );
    await this.setState({
      usageMB: 0,
      alerts: [{ threshold: 80, sent: false }],
      billingCycleStart: new Date().toISOString(),
      history: this.trimHistory([
        ...state.history,
        { date: new Date().toISOString(), usageMB: 0, event: "billing_cycle_reset" },
      ]),
    });
    await this.record("billing.reset", "Billing cycle counters reset");
  }

  async snapshot(): Promise<{ state: SIMState; schedules: Array<{ id: string; method: string; due: number }> }> {
    const state = await this.getState();
    const schedules = (await this.listSchedules()).map((task) => ({
      id: task.id,
      method: task.name,
      due: task.due,
    }));
    return { state, schedules };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------
  private async ensureSchedules(): Promise<void> {
    const checkSeconds = Number(this.env.USAGE_CHECK_SECONDS || 3600);
    const cycleSeconds = Number(this.env.BILLING_CYCLE_SECONDS || 2592000);
    if (!Number.isFinite(checkSeconds) || checkSeconds < 1) throw new Error("USAGE_CHECK_SECONDS must be a positive number of seconds");
    if (!Number.isFinite(cycleSeconds) || cycleSeconds < 1) throw new Error("BILLING_CYCLE_SECONDS must be a positive number of seconds");
    if (!(await this.listSchedules()).some((task) => task.id === "usage-check")) {
      await this.every(checkSeconds, "checkThresholds", undefined, { id: "usage-check" });
    }
    if (!(await this.listSchedules()).some((task) => task.id === "billing-cycle")) {
      await this.every(cycleSeconds, "resetBillingCycle", undefined, { id: "billing-cycle" });
    }
  }

  private async sendSms(to: string, body: string): Promise<void> {
    if (!to) return;
    await this.messages.add("assistant", body);
    if (this.env.DEMO_MODE !== "false") {
      await this.record("sms.sent.demo", `DEMO SMS to ${this.maskPhone(to)}: ${body}`);
      return;
    }
    await this.env.TELNYX.messages.send({ from: this.env.TELNYX_SMS_FROM_NUMBER, to, text: body });
    await this.record("sms.sent", `SMS delivered to ${this.maskPhone(to)}`);
  }

  private customerNumber(state: SIMState): string {
    return state.phoneNumber || this.env.TELNYX_SMS_FROM_NUMBER;
  }

  private async planOptionsReply(): Promise<string> {
    const plans = Object.values(PLAN_PRESETS)
      .filter((plan) => plan.name !== "1GB Starter")
      .map((plan) => `${plan.name} — ${plan.dataLimitMB}MB`)
      .join("\n");
    const state = await this.getState();
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: state.model,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: "system", content: "You are a helpful SIM card assistant. Summarize these data plans in one friendly sentence, then list them." },
          { role: "user", content: `Current plan: ${state.plan.name}. Available plans:\n${plans}` },
        ],
      });
      const content = response.choices?.[0]?.message?.content;
      return content ? `${content}\n${plans}` : plans;
    } catch {
      return plans;
    }
  }

  private async llmReply(message: string): Promise<string> {
    const state = await this.getState();
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: state.model,
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content: `You are SIMAgent, a SIM card assistant. Current usage: ${Math.round(state.usageMB)}MB of ${state.plan.dataLimitMB}MB on plan ${state.plan.name}.`,
          },
          { role: "user", content: message },
        ],
      });
      return response.choices?.[0]?.message?.content || "I did not understand that.";
    } catch {
      return "I can help with: 'options', 'upgrade to 10GB', 'usage', or 'history'.";
    }
  }

  private preset(planName: string): PlanPreset {
    const preset = PLAN_PRESETS[planName.toLowerCase().trim()];
    if (!preset) throw new Error(`Unknown plan: ${planName}. Options: 1GB, 5GB, 10GB, 20GB, unlimited.`);
    return preset;
  }

  private extractPlanName(msg: string): string | undefined {
    const match = msg.match(/upgrade to (\d+gb|unlimited)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  private usageSummary(state: SIMState): string {
    const pct = Math.round((state.usageMB / state.plan.dataLimitMB) * 100);
    return `SIM ${state.simId} | Plan: ${state.plan.name} | Usage: ${Math.round(state.usageMB)}MB / ${state.plan.dataLimitMB}MB (${pct}%)`;
  }

  private trimHistory(history: UsageEvent[]): UsageEvent[] {
    return history.slice(-100);
  }

  private maskPhone(value: string): string {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? `•••${digits.slice(-4)}` : "••••";
  }

  private async record(type: string, message: string): Promise<void> {
    await this.events.emit(type, { message, at: Date.now() });
  }
}
