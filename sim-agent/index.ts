import { Agent, Schedule, KVNamespace, WebSocket } from '@telnyx/edge-sdk';
import telnyx from 'telnyx';

// ---------------------------------------------------------------------------
// SIMAgent — The actor IS the SIM card.
// A durable entity that tracks data usage, proactively alerts on thresholds,
// and auto-provisions upgrades via the Telnyx API.
// ---------------------------------------------------------------------------

export interface SIMState {
  simId: string;
  phoneNumber?: string;
  plan: {
    name: string;
    dataLimitMB: number;
  };
  usageMB: number;
  alerts: { threshold: number; sent: boolean }[];
  billingCycleStart: string; // ISO date string
  history: { date: string; usageMB: number; event: string }[];
}

export interface Env {
  TELNYX_API_KEY: string;
  TELNYX_PHONE_NUMBER: string;
  KV: KVNamespace;
  OPENAI_API_KEY?: string;
  DEMO_MODE?: string; // "true" | "false"
}

const DATA_THRESHOLD = 0.8; // 80 %

export class SIMAgent extends Agent<Env> {
  // ------------------------------------------------------------------
  // Lifecycle: load persistent state from KV on wake / first contact
  // ------------------------------------------------------------------
  async init(): Promise<void> {
    const stored = await this.kv.get<SIMState>(`sim:${this.entityId}`);
    if (!stored) {
      // First-time provisioning — create default state
      const initialState: SIMState = {
        simId: this.entityId,
        plan: { name: '1GB Starter', dataLimitMB: 1024 },
        usageMB: 0,
        alerts: [{ threshold: 80, sent: false }],
        billingCycleStart: new Date().toISOString(),
        history: [],
      };
      await this.kv.put(`sim:${this.entityId}`, initialState);
      this.state = initialState;
    } else {
      this.state = stored;
    }

    // Schedule recurring threshold check (every hour)
    this.schedule('every-hour', () => this.checkThresholds());

    // Schedule billing-cycle reset (every 30 days)
    this.schedule('billing-reset', () => this.resetBillingCycle());
  }

  // ------------------------------------------------------------------
  // Threshold monitoring — proactive SMS when usage crosses 80 %
  // ------------------------------------------------------------------
  async checkThresholds(): Promise<void> {
    const pct = (this.state.usageMB / this.state.plan.dataLimitMB) * 100;
    if (pct >= DATA_THRESHOLD * 100 && !this.state.alerts[0].sent) {
      await this.sendSMS(
        this.state.phoneNumber || this.env.TELNYX_PHONE_NUMBER,
        `You've used ${Math.round(pct)}% of your data on SIM ${this.state.simId}. Reply "options" for upgrade plans.`
      );
      this.state.alerts[0].sent = true;
      await this.persist();
    }
  }

  // ------------------------------------------------------------------
  // Webhook handler — incoming data-usage updates from Telnyx
  // ------------------------------------------------------------------
  async onWebhook(event: string, payload: any): Promise<void> {
    if (event === 'usage.data') {
      const deltaMB = payload.data?.usage_mb || 0;
      this.state.usageMB += deltaMB;
      this.state.history.push({
        date: new Date().toISOString(),
        usageMB: deltaMB,
        event: 'usage_update',
      });
      await this.persist();
      // Re-evaluate thresholds after update
      await this.checkThresholds();
    }
  }

  // ------------------------------------------------------------------
  // SMS command handler — natural-language plan comparison + provisioning
  // ------------------------------------------------------------------
  async onSMS(from: string, message: string): Promise<void> {
    const lower = message.toLowerCase().trim();

    if (lower.includes('options') || lower.includes('plans') || lower.includes('what are my')) {
      const plans = await this.getPlanOptions();
      await this.sendSMS(from, plans);
      return;
    }

    if (lower.includes('upgrade')) {
      const planName = this.extractPlanName(lower);
      if (planName) {
        await this.provisionUpgrade(planName);
        await this.sendSMS(from, `✅ Upgrade to ${planName} complete! New limit active.`);
      } else {
        await this.sendSMS(from, 'Please specify a plan: "upgrade to 10GB" or "upgrade to 5GB".');
      }
      return;
    }

    if (lower.includes('usage') || lower.includes('history') || lower.includes('summary')) {
      const summary = this.buildUsageSummary();
      await this.sendSMS(from, summary);
      return;
    }

    // Default: LLM-powered natural language response
    const reply = await this.llmReply(message);
    await this.sendSMS(from, reply);
  }

  // ------------------------------------------------------------------
  // Call Control — customer calls, agent answers with usage history
  // ------------------------------------------------------------------
  async onCall(callId: string, from: string): Promise<void> {
    const summary = this.buildUsageSummary();
    await this.telnyx.calls.playAudio({
      call_id: callId,
      audio_url: `https://api.telnyx.com/voice/text-to-speech`, // placeholder
      payload: { text: summary },
    });
  }

  // ------------------------------------------------------------------
  // Auto-provisioning upgrade via Telnyx API
  // ------------------------------------------------------------------
  private async provisionUpgrade(planName: string): Promise<void> {
    const planMap: Record<string, number> = {
      '5gb': 5120,
      '10gb': 10240,
      '20gb': 20480,
      'unlimited': 100000,
    };

    const dataLimitMB = planMap[planName.toLowerCase()];
    if (!dataLimitMB) {
      throw new Error(`Unknown plan: ${planName}`);
    }

    // Update SIM via Telnyx API
    const client = telnyx(this.env.TELNYX_API_KEY);
    await client.simCards.update(this.state.simId, {
      data_plan: { name: planName.toUpperCase(), data_limit_mb: dataLimitMB },
    });

    // Update local state
    this.state.plan = { name: planName.toUpperCase(), dataLimitMB };
    this.state.alerts[0].sent = false; // reset alert for new cycle
    this.state.history.push({
      date: new Date().toISOString(),
      usageMB: 0,
      event: `upgrade_to_${planName}`,
    });
    await this.persist();
  }

  // ------------------------------------------------------------------
  // Natural language plan comparison via LLM
  // ------------------------------------------------------------------
  private async getPlanOptions(): Promise<string> {
    const plans = [
      '5GB — $10/month',
      '10GB — $20/month',
      '20GB — $35/month',
      'Unlimited — $50/month',
    ];

    if (this.env.OPENAI_API_KEY) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful SIM card assistant. Summarize these data plans in one friendly sentence.',
              },
              { role: 'user', content: `Plans: ${plans.join(', ')}` },
            ],
            max_tokens: 100,
          }),
        });
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || plans.join('\n');
      } catch {
        return plans.join('\n');
      }
    }

    return plans.join('\n');
  }

  private async llmReply(message: string): Promise<string> {
    if (!this.env.OPENAI_API_KEY) {
      return "I can help with: 'options', 'upgrade to 10GB', 'usage', or 'history'.";
    }
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are SIMAgent, a SIM card assistant. Current usage: ${this.state.usageMB}MB of ${this.state.plan.dataLimitMB}MB. Plan: ${this.state.plan.name}.`,
            },
            { role: 'user', content: message },
          ],
          max_tokens: 150,
        }),
      });
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || 'I did not understand that.';
    } catch {
      return 'Sorry, I am having trouble processing your request right now.';
    }
  }

  // ------------------------------------------------------------------
  // Billing cycle reset — scheduled task
  // ------------------------------------------------------------------
  private async resetBillingCycle(): Promise<void> {
    const summary = this.buildUsageSummary();
    await this.sendSMS(
      this.state.phoneNumber || this.env.TELNYX_PHONE_NUMBER,
      `📊 Billing cycle ended.\n${summary}\nCounters reset for new cycle.`
    );

    this.state.usageMB = 0;
    this.state.alerts[0].sent = false;
    this.state.billingCycleStart = new Date().toISOString();
    this.state.history.push({
      date: new Date().toISOString(),
      usageMB: 0,
      event: 'billing_cycle_reset',
    });
    await this.persist();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  private async sendSMS(to: string, body: string): Promise<void> {
    if (this.env.DEMO_MODE === 'true') {
      console.log(`[DEMO SMS] To: ${to} | Body: ${body}`);
      return;
    }
    const client = telnyx(this.env.TELNYX_API_KEY);
    await client.messages.create({
      from: this.env.TELNYX_PHONE_NUMBER,
      to,
      text: body,
    });
  }

  private async persist(): Promise<void> {
    await this.kv.put(`sim:${this.entityId}`, this.state);
  }

  private extractPlanName(msg: string): string | undefined {
    const match = msg.match(/upgrade to (\d+gb|unlimited)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  private buildUsageSummary(): string {
    const pct = Math.round((this.state.usageMB / this.state.plan.dataLimitMB) * 100);
    return `SIM ${this.state.simId} | Plan: ${this.state.plan.name} | Usage: ${this.state.usageMB}MB / ${this.state.plan.dataLimitMB}MB (${pct}%)`;
  }
}

// ---------------------------------------------------------------------------
// Edge entry point — routes webhooks, SMS, and calls to the correct SIMAgent
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Webhook endpoint — Telnyx sends data usage + SMS + call events
    if (path === '/webhook' && request.method === 'POST') {
      const body = await request.json();
      const eventType = body.event;
      const simId = body.data?.sim_id || body.data?.to;

      if (!simId) {
        return new Response('Bad request', { status: 400 });
      }

      const agent = new SIMAgent(env, simId);
      await agent.init();
      await agent.onWebhook(eventType, body);
      return new Response('OK', { status: 200 });
    }

    // SMS command endpoint
    if (path === '/sms' && request.method === 'POST') {
      const body = await request.json();
      const from = body.data?.from;
      const message = body.data?.text;
      const simId = body.data?.to;

      if (!simId || !from || !message) {
        return new Response('Bad request', { status: 400 });
      }

      const agent = new SIMAgent(env, simId);
      await agent.init();
      await agent.onSMS(from, message);
      return new Response('OK', { status: 200 });
    }

    // Call Control endpoint
    if (path === '/call' && request.method === 'POST') {
      const body = await request.json();
      const callId = body.data?.call_id;
      const from = body.data?.from;
      const simId = body.data?.to;

      if (!simId || !callId || !from) {
        return new Response('Bad request', { status: 400 });
      }

      const agent = new SIMAgent(env, simId);
      await agent.init();
      await agent.onCall(callId, from);
      return new Response('OK', { status: 200 });
    }

    // Health check
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', mode: env.DEMO_MODE || 'demo' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
