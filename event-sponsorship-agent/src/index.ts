import {
  Agent,
  type ActorContext,
  type ActorNamespace,
  type Env,
  type KvNamespace,
  type Secrets,
  type SqlDatabase,
} from "@telnyx/edge-runtime";
import { verifyTelnyxSignature } from "./verify";
import { micrositeHtml } from "./microsite";
import { PP_FORMULA_WOFF2_B64, TELNYX_LOGO_SVG } from "./assets";
import { encodeAgentName } from "@telnyx/edge-runtime/mount";

// ---------------------------------------------------------------------------
// Environment interface — bindings declared in telnyx.toml
// ---------------------------------------------------------------------------
export interface SponsorEnv extends Env {
  SECRETS: Secrets;
  SPONSOR_AGENT: ActorNamespace<SponsorAgent>;
  LEADS_DB: SqlDatabase;
  RATE_LIMIT_KV: KvNamespace;
  TELNYX: {
    messages: {
      send: (params: { to: string; from: string; text: string }) => Promise<any>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion: (params: {
            model: string;
            messages: Array<{ role: string; content: string }>;
          }) => Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
    calls: {
      create: (params: Record<string, any>) => Promise<any>;
    };
    v2: {
      messages: {
        create: (params: Record<string, any>) => Promise<any>;
      };
    };
  };
}

// ── Config resolution ───────────────────────────────────────────────────
// [env_vars] reach the fetch-handler pod as process.env, but actor pods do
// not — so actor-readable config goes through the SECRETS binding first
// (secrets added via `telnyx-edge secrets add`), falling back to
// process.env locally.
async function cfg(env: SponsorEnv | undefined, name: string, dflt = ""): Promise<string> {
  try {
    const fromSecret = await env?.SECRETS?.get(name);
    if (fromSecret) return fromSecret;
  } catch {
    // secrets not configured — fall through to process.env
  }
  return process.env[name] ?? dflt;
}
async function isDemoMode(env: SponsorEnv | undefined): Promise<boolean> {
  return (await cfg(env, "DEMO_MODE", "true")) === "true";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface LeadRecord {
  id?: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  useCase?: string;
  companySize?: string;
  timeline?: string;
  channel: "sms" | "whatsapp" | "email" | "chat" | "voice";
  qualified: boolean;
  giveawayEntry: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionState extends Record<string, unknown> {
  phone: string;
  name?: string;
  channel: "sms" | "whatsapp" | "chat" | "voice";
  step: string;
  language: string;
  collected: Record<string, string>;
  giveawayEntry: boolean;
  demoRequested: boolean;
  followUpScheduled: boolean;
  lastInteraction: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Rate limiter helper
// ---------------------------------------------------------------------------
export class SimpleRateLimiter {
  constructor(private kv: KvNamespace, private windowSeconds: number, private maxRequests: number) {}

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / this.windowSeconds);
    // Platform KV keys only allow a-z A-Z 0-9 - _ / = . — identifiers like
    // phone numbers ("+1...") or arbitrary session ids must be sanitized.
    const safeId = identifier.replace(/[^a-zA-Z0-9\-_\/=.]/g, "_");
    const key = `rl/${safeId}/${window}`;

    const current = (await this.kv.get(key, { type: "json" }).catch(() => 0)) as number | string | null;
    const count = Number(current ?? 0);

    if (count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: (window + 1) * this.windowSeconds };
    }

    await this.kv.put(key, String(count + 1), {
      expirationTtl: this.windowSeconds,
    });

    return {
      allowed: true,
      remaining: this.maxRequests - count - 1,
      resetAt: (window + 1) * this.windowSeconds,
    };
  }
}

// ---------------------------------------------------------------------------
// SponsorAgent — the main agent handling all attendee interactions.
// One durable actor per attendee, addressed by phone number (or session id
// for in-browser chat) via `idFromName`.
// ---------------------------------------------------------------------------
export class SponsorAgent extends Agent<SponsorEnv, SessionState> {
  constructor(ctx: ActorContext, env: SponsorEnv) {
    super(ctx, env);
  }

  protected initialState(): SessionState {
    return {
      phone: "",
      channel: "sms",
      step: "welcome",
      language: "en",
      collected: {},
      giveawayEntry: false,
      demoRequested: false,
      followUpScheduled: false,
      lastInteraction: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Public RPC-callable methods (invoked via stub from the fetch handler)
  // -----------------------------------------------------------------------

  /**
   * Handle an inbound SMS or WhatsApp message from an attendee.
   */
  async handleInboundMessage(params: {
    from: string;
    to: string;
    text: string;
    channel: "sms" | "whatsapp";
  }): Promise<{ success: boolean; message: string }> {
    const { from, text, channel } = params;

    // Rate limit
    const limiter = new SimpleRateLimiter(this.env.RATE_LIMIT_KV, 60, 10);
    const rl = await limiter.check(from);
    if (!rl.allowed) {
      return { success: false, message: "Rate limit exceeded. Please try again later." };
    }

    // Load or create session
    let state = await this.getState();
    if (!state.phone) {
      state = { ...state, phone: from, channel, lastInteraction: new Date().toISOString() };
    }

    // Adopt a newly detected non-English language; keep the attendee's
    // established language when detection reads plain English.
    const lang = await this.detectLanguage(text);
    if (lang && lang !== "en") state.language = lang;

    // Process the message through the agent flow
    const response = await this.processMessage(text, state, channel);

    // Persist session
    await this.setState({ ...state, lastInteraction: new Date().toISOString() });

    // Send response
    await this.sendResponse(from, response, channel);

    return { success: true, message: response };
  }

  /**
   * Handle an inbound voice call.
   */
  async handleInboundCall(params: {
    callId: string;
    from: string;
    to: string;
  }): Promise<{ success: boolean; message: string }> {
    const { from, callId } = params;

    const limiter = new SimpleRateLimiter(this.env.RATE_LIMIT_KV, 60, 5);
    const rl = await limiter.check(from);
    if (!rl.allowed) {
      return { success: false, message: "Rate limit exceeded." };
    }

    const state = await this.getState();
    const updated = { ...state, phone: from, channel: "voice" as const, lastInteraction: new Date().toISOString() };
    await this.setState(updated);

    // In demo mode, just log; in live mode, use Call Control
    if ((await isDemoMode(this.env))) {
      console.log(`[DEMO] Voice call from ${from}, callId=${callId}. Would connect to agent.`);
    } else {
      // Real Call Control would use telnyx.calls.create or Call Control API
      console.log(`[LIVE] Initiating Call Control for ${from}, callId=${callId}`);
    }

    return { success: true, message: "Call received and queued for agent." };
  }

  /**
   * Handle in-browser chat message.
   */
  async handleChatMessage(params: {
    sessionId: string;
    text: string;
  }): Promise<{ success: boolean; message: string; data?: any }> {
    const { sessionId, text } = params;

    const limiter = new SimpleRateLimiter(this.env.RATE_LIMIT_KV, 60, 20);
    const rl = await limiter.check(sessionId);
    if (!rl.allowed) {
      return { success: false, message: "Rate limit exceeded." };
    }

    const state = await this.getState();
    const updated = { ...state, channel: "chat" as const, lastInteraction: new Date().toISOString() };
    // Chat sessions have no phone — key the lead on the session id so the
    // attribution report still counts web-chat leads.
    if (!updated.phone) updated.phone = sessionId;

    // Adopt a newly detected non-English language; keep the attendee's
    // established language when detection reads plain English.
    const lang = await this.detectLanguage(text);
    if (lang && lang !== "en") updated.language = lang;
    await this.setState(updated);

    const response = await this.processMessage(text, updated, "chat");

    // Persist mutations processMessage made to the session state
    await this.setState(updated);

    return { success: true, message: response };
  }

  /**
   * Handle post-event follow-up scheduling.
   */
  async scheduleFollowUp(params: {
    phone: string;
    channel: "sms" | "whatsapp" | "email" | "voice";
    delaySeconds: number;
  }): Promise<{ success: boolean; scheduledId?: string }> {
    const { phone, channel, delaySeconds } = params;

    const scheduledId = await this.schedule(delaySeconds, "sendFollowUp", { phone, channel });

    return { success: true, scheduledId };
  }

  /**
   * Task handler: send follow-up message after event.
   * Invoked by the Agent task scheduler — do NOT override `alarm()`, which
   * would break the scheduler.
   */
  async sendFollowUp(payload: { phone: string; channel: "sms" | "whatsapp" | "email" | "voice" }): Promise<void> {
    const { phone, channel } = payload;

    // Prefer the SQLDB record; if the DB is unreachable, fall back to this
    // actor's own session state (the task fires on the per-lead actor, which
    // holds the full collected profile).
    const lead = (await this.getLeadByPhone(phone)) ?? (await this.leadFromState(phone));
    if (!lead) {
      console.log(`[FOLLOWUP] No lead found for ${phone}, skipping`);
      return;
    }

    const followUpText = await this.generateFollowUpMessage(lead);
    const eventName = await cfg(this.env, "EVENT_NAME", "our event");
    const demo = await isDemoMode(this.env);

    if (channel === "sms" || channel === "whatsapp") {
      await this.sendResponse(phone, followUpText, channel);
    } else if (channel === "email") {
      // Email is low-risk and always deliverable: in demo mode it goes to the
      // configured demo inbox (EMAIL_TO) so the flow can be watched end-to-end;
      // in live mode it goes to the lead's own address.
      const recipient = !demo && lead.email ? lead.email : (await cfg(this.env, "EMAIL_TO", ""));
      if (!recipient) {
        console.log(`[EMAIL] No recipient for follow-up (lead.email=${lead.email || "none"}), skipping`);
        return;
      }
      const subject = `Following up from ${eventName}`;
      const ok = await this.sendEmailFollowUp(recipient, subject, followUpText);
      if (ok) console.log(`[EMAIL] Sent follow-up to ${recipient} (${demo ? "demo inbox" : "lead"})`);
    } else if (channel === "voice") {
      if (demo) {
        console.log(`[DEMO] Would place voice call to ${phone}: ${followUpText}`);
      } else {
        console.log(`[LIVE] Placing voice call to ${phone}`);
      }
    }
  }

  /**
   * Send a real email via the Telnyx Email API (POST /v2/email_messages).
   * The API key comes from the [[secrets]] binding (process.env injection).
   */
  private async sendEmailFollowUp(to: string, subject: string, textBody: string): Promise<boolean> {
    try {
      const apiKey = process.env.TELNYX_API_KEY ?? (await this.env.SECRETS?.get("TELNYX_API_KEY").catch(() => "")) ?? "";
      if (!apiKey) {
        console.error("[EMAIL] TELNYX_API_KEY not configured — cannot send email");
        return false;
      }
      const from = await cfg(this.env, "EMAIL_FROM", "onboarding@mail.telnyx.com");
      const resp = await fetch("https://api.telnyx.com/v2/email_messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text_body: textBody }),
      });
      if (!resp.ok) {
        console.error(`[EMAIL] Send failed: HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Email send failed:", err);
      return false;
    }
  }

  /**
   * Generate an attribution report for captured, qualified, and converted leads.
   */
  async generateAttributionReport(): Promise<{
    totalCaptured: number;
    totalQualified: number;
    totalConverted: number;
    byChannel: Record<string, number>;
    byUseCase: Record<string, number>;
  }> {
    await this.env.LEADS_DB.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        phone TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        company TEXT,
        useCase TEXT,
        companySize TEXT,
        timeline TEXT,
        channel TEXT,
        qualified BOOLEAN,
        giveawayEntry BOOLEAN,
        createdAt TEXT,
        updatedAt TEXT
      )
    `);

    const result = await this.env.LEADS_DB.prepare(
      "SELECT channel, useCase, qualified, giveawayEntry FROM leads"
    ).all<{ channel: string; useCase: string; qualified: boolean; giveawayEntry: boolean }>();

    const leads = result.results || [];
    const report = {
      totalCaptured: leads.length,
      totalQualified: leads.filter((l: any) => l.qualified).length,
      totalConverted: leads.filter((l: any) => l.giveawayEntry).length,
      byChannel: {} as Record<string, number>,
      byUseCase: {} as Record<string, number>,
    };

    for (const lead of leads) {
      report.byChannel[lead.channel] = (report.byChannel[lead.channel] || 0) + 1;
      if (lead.useCase) {
        report.byUseCase[lead.useCase] = (report.byUseCase[lead.useCase] || 0) + 1;
      }
    }

    return report;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async detectLanguage(text: string): Promise<string> {
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: (await cfg(this.env, "AI_MODEL", "moonshotai/Kimi-K2.6")),
        messages: [
          {
            role: "system",
            content: "Detect the language of the following text. Respond with only the ISO 639-1 language code (e.g., 'en', 'es', 'fr', 'de', 'ja', 'zh').",
          },
          { role: "user", content: text },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || "en";
    } catch (err) {
      console.error("Language detection failed:", err);
      return "en";
    }
  }

  /**
   * The next unanswered qualification question, or null when the flow is
   * complete. Attendee replies are captured into `state.collected`, so the
   * same actor picks the conversation back up across channels.
   */
  private async nextFlowQuestion(state: SessionState): Promise<string | null> {
    if (!state.collected.name) {
      state.step = "ask_name";
      return await this.localize(`Hi! Welcome to ${(await cfg(this.env, "EVENT_NAME", "our event"))}. What's your name?`, state.language);
    }
    if (!state.collected.company) {
      state.step = "ask_company";
      return await this.localize(`Nice to meet you, ${state.collected.name}! What company do you work for?`, state.language);
    }
    if (!state.collected.useCase) {
      state.step = "ask_usecase";
      return await this.localize("What's your primary use case for Telnyx?", state.language);
    }
    if (!state.collected.companySize) {
      state.step = "ask_company_size";
      return await this.localize("How many employees are at your company?", state.language);
    }
    if (!state.collected.timeline) {
      state.step = "ask_timeline";
      return await this.localize("When are you looking to implement a solution?", state.language);
    }
    return null;
  }

  private async processMessage(
    text: string,
    state: SessionState,
    channel: "sms" | "whatsapp" | "chat" | "voice"
  ): Promise<string> {
    const lowerText = text.toLowerCase().trim();

    // Follow-up preference capture — the agent asked a specific question,
    // so this reply is the answer (checked before intent keywords).
    if (state.step === "ask_followup") {
      return await this.handleFollowUpAnswer(text, state);
    }
    if (state.step === "ask_email") {
      return await this.handleEmailAnswer(text, state);
    }

    // Giveaway entry
    if (lowerText.includes("giveaway") || lowerText.includes("enter") || lowerText.includes("prize")) {
      state.giveawayEntry = true;
      await this.saveLead(state);
      return await this.localize("You are entered in the giveaway. Prize: " + (await cfg(this.env, "GIVEAWAY_PRIZE", "Telnyx Developer Kit")) + ". A sales rep will contact you shortly.", state.language);
    }

    // Demo booking
    if (lowerText.includes("demo") || lowerText.includes("book") || lowerText.includes("schedule")) {
      state.demoRequested = true;
      await this.saveLead(state);
      return await this.localize("Great! Let us book a demo — I will take your details first.", state.language);
    }

    // Product questions
    if (lowerText.includes("product") || lowerText.includes("what") || lowerText.includes("how")) {
      const answer = await this.answerProductQuestion(text, state.language);
      return answer;
    }

    // Qualification flow: on the first interaction, greet and ask — don't
    // capture the greeting as an answer. Once a question is out, this
    // message IS the answer: capture it, persist the lead, and continue.
    if (state.step === "welcome") {
      return (await this.nextFlowQuestion(state)) ?? await this.localize("Hi! Welcome to " + (await cfg(this.env, "EVENT_NAME", "our event")) + ". What is your name?", state.language);
    }
    const pending = (await this.nextFlowQuestion(state));
    if (pending) {
      const field = state.step.replace(/^ask_/, "");
      const keyMap: Record<string, keyof SessionState["collected"]> = {
        name: "name",
        company: "company",
        usecase: "useCase",
        company_size: "companySize",
        timeline: "timeline",
      };
      const key = keyMap[field];
      if (key) {
        state.collected[key] = text.trim();
        await this.saveLead(state);

        const next = (await this.nextFlowQuestion(state));
        if (next) {
          return next;
        }

        // Qualification complete — capture the preferred follow-up channel
        state.step = "ask_followup";
        await this.setState(state);
        return await this.localize("Perfect — you're all set! One last thing: how would you like us to follow up after the event — SMS, email, or a call?", state.language);
      }
      return pending;
    }

    // Qualification complete: use inference to generate a contextual response
    const contextualResponse = await this.generateAgentResponse(text, state, channel);
    return contextualResponse;
  }

  /**
   * Map a free-text follow-up preference to a supported channel.
   * Understands English and common non-English channel words, and treats
   * an email address as an email preference.
   */
  private mapFollowUpChannel(text: string): "sms" | "whatsapp" | "email" | "voice" | null {
    const t = text.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return "email";
    if (t.includes("email") || t.includes("e-mail") || t.includes("mail") || t.includes("correo") || t.includes("courriel") || t.includes("邮件") || t.includes("メール")) return "email";
    if (t.includes("whatsapp")) return "whatsapp";
    if (t.includes("call") || t.includes("phone") || t.includes("voice") || t.includes("llamada") || t.includes("appel") || t.includes("電話") || t.includes("电话")) return "voice";
    if (t.includes("sms") || t.includes("text") || t.includes("message") || t.includes("mensaje") || t.includes("短信")) return "sms";
    return null;
  }

  private async handleFollowUpAnswer(text: string, state: SessionState): Promise<string> {
    const mapped = this.mapFollowUpChannel(text);
    if (!mapped) {
      // Don't trap the attendee: default to the channel they are on now.
      return await this.completeFlow(state, state.channel === "whatsapp" ? "whatsapp" : "sms");
    }
    state.collected.followUpChannel = mapped;
    if (mapped === "email") {
      state.step = "ask_email";
      await this.setState(state);
      return await this.localize("Great — what is the best email for you?", state.language);
    }
    return await this.completeFlow(state, mapped);
  }

  private async handleEmailAnswer(text: string, state: SessionState): Promise<string> {
    const email = text.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return await this.localize("That does not look like an email address — what is the best email for you?", state.language);
    }
    state.collected.email = email;
    return await this.completeFlow(state, "email");
  }

  /**
   * Finish onboarding: persist the lead, schedule the post-event follow-up
   * on the attendee's preferred channel, and confirm.
   */
  private async completeFlow(state: SessionState, followUpChannel: "sms" | "whatsapp" | "email" | "voice"): Promise<string> {
    state.step = "chat";
    await this.saveLead(state);

    if (!state.followUpScheduled) {
      // Demo deployments schedule a short-delay follow-up (FOLLOWUP_DELAY_SECONDS,
      // default 5 min) so the channel can be watched end-to-end; live events
      // follow up the next day.
      const delay = Number((await cfg(this.env, "FOLLOWUP_DELAY_SECONDS", ""))) ||
        ((await isDemoMode(this.env)) ? 300 : 86400);
      await this.schedule(delay, "sendFollowUp", { phone: state.phone, channel: followUpChannel });
      state.followUpScheduled = true;
      await this.setState(state);
    }

    const channelNote = followUpChannel === "email" ? "email" : followUpChannel === "voice" ? "a call" : followUpChannel;
    return await this.localize(`Perfect — you're all set! I've saved your details and will follow up after the event via ${channelNote}. Ask me anything, or type "giveaway" to enter the prize draw.`, state.language);
  }

  private async answerProductQuestion(question: string, language: string): Promise<string> {
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: (await cfg(this.env, "AI_MODEL", "moonshotai/Kimi-K2.6")),
        messages: [
          {
            role: "system",
            content: `You are a helpful product expert for Telnyx at ${(await cfg(this.env, "EVENT_NAME", "our event"))}. Answer the following question concisely. Respond in ${language}. Never mention or compare against competitor companies.`,
          },
          { role: "user", content: question },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || "I'm not sure about that. Let me connect you with a specialist.";
    } catch (err) {
      console.error("Product Q&A failed:", err);
      return "I'm not sure about that. Let me connect you with a specialist.";
    }
  }

  private async generateAgentResponse(
    text: string,
    state: SessionState,
    channel: "sms" | "whatsapp" | "chat" | "voice"
  ): Promise<string> {
    try {
      const context = `
You are a multilingual event sponsorship agent for ${(await cfg(this.env, "EVENT_NAME", "our event"))}.
The attendee's name is ${state.collected.name || "unknown"}.
Their company is ${state.collected.company || "unknown"}.
Their use case is ${state.collected.useCase || "unknown"}.
Their company size is ${state.collected.companySize || "unknown"}.
Their timeline is ${state.collected.timeline || "unknown"}.
They are interacting via ${channel}.
They have entered the giveaway: ${state.giveawayEntry}.
They have requested a demo: ${state.demoRequested}.
Respond helpfully in ${state.language}. Keep responses concise for SMS.
`;

      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: (await cfg(this.env, "AI_MODEL", "moonshotai/Kimi-K2.6")),
        messages: [
          { role: "system", content: context },
          { role: "user", content: text },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || "I'm here to help! You can enter the giveaway, ask product questions, or book a demo.";
    } catch (err) {
      console.error("Agent response generation failed:", err);
      return "I'm here to help! You can enter the giveaway, ask product questions, or book a demo.";
    }
  }

  private async generateFollowUpMessage(lead: LeadRecord): Promise<string> {
    const fallback = `Hi ${lead.name || "there"}! Thanks for stopping by ${(await cfg(this.env, "EVENT_NAME", "our event"))}. You mentioned ${lead.useCase || "your project"} — happy to pick that conversation back up whenever you're ready.`;

    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: (await cfg(this.env, "AI_MODEL", "moonshotai/Kimi-K2.6")),
        messages: [
          {
            role: "system",
            content: `You are a friendly sales follow-up assistant for ${(await cfg(this.env, "EVENT_NAME", "our event"))}. Write a short, warm follow-up message. Keep it under 300 characters (SMS-friendly).`,
          },
          {
            role: "user",
            content: `Write a follow-up message for: name=${lead.name || "unknown"}, company=${lead.company || "unknown"}, use case=${lead.useCase || "unknown"}, company size=${lead.companySize || "unknown"}, timeline=${lead.timeline || "unknown"}, demo requested=${lead.channel}.`,
          },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || fallback;
    } catch (err) {
      console.error("Follow-up generation failed:", err);
      return fallback;
    }
  }

  /**
   * Multilingual support: translate the canned English flow messages into
   * the attendee's detected language via inference. Falls back to the
   * English original on any failure. "en" short-circuits (no call).
   */
  private async localize(text: string, language: string): Promise<string> {
    const lang = (language || "en").trim().toLowerCase();
    if (!lang || lang === "en" || lang === "english") return text;

    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: (await cfg(this.env, "AI_MODEL", "moonshotai/Kimi-K2.6")),
        messages: [
          {
            role: "system",
            content: `Translate the message below into the language with ISO 639-1 code "${lang}". Keep the tone warm and professional. Reply with ONLY the translation — no quotes, no explanation. Keep it under 300 characters.`,
          },
          { role: "user", content: text },
        ],
      });

      return response.choices[0]?.message?.content?.trim() || text;
    } catch (err) {
      console.error("Translation failed:", err);
      return text;
    }
  }

  private async saveLead(state: SessionState): Promise<void> {
    const now = new Date().toISOString();
    const lead: LeadRecord = {
      phone: state.phone,
      name: state.collected.name || "",
      email: state.collected.email || "",
      company: state.collected.company || "",
      useCase: state.collected.useCase || "",
      companySize: state.collected.companySize || "",
      timeline: state.collected.timeline || "",
      channel: state.channel,
      qualified: !!(state.collected.useCase && state.collected.companySize && state.collected.timeline),
      giveawayEntry: state.giveawayEntry,
      createdAt: now,
      updatedAt: now,
    };

    // Upsert into SQLDB. A persistence failure must never kill the
    // conversation — the lead stays in actor state and we log for follow-up.
    try {
      await this.env.LEADS_DB.exec(`
        CREATE TABLE IF NOT EXISTS leads (
          phone TEXT PRIMARY KEY,
          name TEXT,
          email TEXT,
          company TEXT,
          useCase TEXT,
          companySize TEXT,
          timeline TEXT,
          channel TEXT,
          qualified BOOLEAN,
          giveawayEntry BOOLEAN,
          createdAt TEXT,
          updatedAt TEXT
        )
      `);

      await this.env.LEADS_DB.prepare(`
        INSERT INTO leads (phone, name, email, company, useCase, companySize, timeline, channel, qualified, giveawayEntry, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          company = excluded.company,
          useCase = excluded.useCase,
          companySize = excluded.companySize,
          timeline = excluded.timeline,
          channel = excluded.channel,
          qualified = excluded.qualified,
          giveawayEntry = excluded.giveawayEntry,
          updatedAt = excluded.updatedAt
      `).bind(
        lead.phone,
        lead.name,
        lead.email,
        lead.company,
        lead.useCase,
        lead.companySize,
        lead.timeline,
        lead.channel,
        lead.qualified ? 1 : 0,
        lead.giveawayEntry ? 1 : 0,
        lead.createdAt,
        lead.updatedAt
      ).all();
    } catch (err) {
      console.error("Lead persistence failed:", err);
    }

    // If qualified and demo requested, route hot lead to sales team via SMS
    // (independent of the DB write above).
    if (lead.qualified && state.demoRequested) {
      await this.routeHotLeadToSales(lead);
    }
  }

  private async getLeadByPhone(phone: string): Promise<LeadRecord | null> {
    try {
      const result = await this.env.LEADS_DB.prepare(
        "SELECT * FROM leads WHERE phone = ?"
      ).bind(phone).all();

      if (result.results && result.results.length > 0) {
        return result.results[0] as unknown as LeadRecord;
      }
      return null;
    } catch (err) {
      console.error("Lead lookup failed:", err);
      return null;
    }
  }

  /**
   * Build a lead from this actor's session state — the fallback when the
   * leads SQLDB is unreachable. The follow-up task fires on the per-lead
   * actor itself, whose state carries the full collected profile.
   */
  private async leadFromState(phone: string): Promise<LeadRecord | null> {
    try {
      const state = await this.getState();
      if (!state.phone || state.phone !== phone) return null;
      const now = new Date().toISOString();
      return {
        phone: state.phone,
        name: state.collected.name || "",
        email: state.collected.email || "",
        company: state.collected.company || "",
        useCase: state.collected.useCase || "",
        companySize: state.collected.companySize || "",
        timeline: state.collected.timeline || "",
        channel: state.channel,
        qualified: !!(state.collected.useCase && state.collected.companySize && state.collected.timeline),
        giveawayEntry: state.giveawayEntry,
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      console.error("Lead-from-state lookup failed:", err);
      return null;
    }
  }

  private async routeHotLeadToSales(lead: LeadRecord): Promise<void> {
    const message = `HOT LEAD: ${lead.name || "Unknown"} from ${lead.company || "Unknown"} (${lead.phone}). Use case: ${lead.useCase || "N/A"}. Company size: ${lead.companySize || "N/A"}. Timeline: ${lead.timeline || "N/A"}. Demo requested: YES.`;

    if ((await isDemoMode(this.env))) {
      console.log(`[DEMO] Would SMS sales team at ${(await cfg(this.env, "SALES_TEAM_NUMBER"))}: ${message}`);
    } else {
      await this.env.TELNYX.messages.send({
        to: (await cfg(this.env, "SALES_TEAM_NUMBER")),
        from: (await cfg(this.env, "FROM_NUMBER")),
        text: message,
      });
    }
  }

  private async sendResponse(
    to: string,
    text: string,
    channel: "sms" | "whatsapp" | "chat" | "voice"
  ): Promise<void> {
    if (channel === "chat") {
      // In-browser chat — response is returned directly to the caller
      return;
    }

    if ((await isDemoMode(this.env))) {
      console.log(`[DEMO] Would send ${channel} to ${to}: ${text}`);
      return;
    }

    if (channel === "sms") {
      await this.env.TELNYX.messages.send({
        to,
        from: (await cfg(this.env, "FROM_NUMBER")),
        text,
      });
    } else if (channel === "whatsapp") {
      await this.env.TELNYX.v2.messages.create({
        from: (await cfg(this.env, "FROM_NUMBER")),
        to,
        channel: "whatsapp",
        text: { body: text },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch handler — routes HTTP requests to the appropriate actor method.
// Each route resolves the per-attendee actor with `idFromName(...)` and
// invokes its public methods directly on the returned stub.
// ---------------------------------------------------------------------------

/** Normalize a Telnyx webhook `from`/`to` field (string or `{phone_number}`). */
function normalizePhone(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && typeof field.phone_number === "string") return field.phone_number;
  return "";
}

/** Parse a Telnyx webhook body into a normalized shape. */
function parseWebhookJson(rawBody: ArrayBuffer): { from: string; to: string; text: string; callId: string } {
  let body: any = {};
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    body = {};
  }
  const payload = body?.data?.payload ?? body ?? {};

  return {
    from: normalizePhone(payload.from),
    to: normalizePhone(payload.to),
    text: typeof payload.text === "string" ? payload.text : "",
    callId: typeof payload.call_control_id === "string" ? payload.call_control_id : "",
  };
}

export default {
  async fetch(req: Request, e: SponsorEnv): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Route: Inbound SMS webhook (signature-verified)
    if (path === "/webhook/sms" && req.method === "POST") {
      const raw = await req.arrayBuffer();
      const publicKey = process.env.TELNYX_PUBLIC_KEY ?? (await e.SECRETS?.get("TELNYX_PUBLIC_KEY").catch(() => "")) ?? "";
      if (verifyTelnyxSignature(req.headers, raw, publicKey) !== 0) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
      const { from, to, text } = parseWebhookJson(raw);
      if (!from || !text) {
        return new Response(JSON.stringify({ error: "Missing from or text" }), { status: 400 });
      }

      const result = await e.SPONSOR_AGENT.idFromName(encodeAgentName(from)).handleInboundMessage({ from, to, text, channel: "sms" });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Route: Inbound WhatsApp webhook (signature-verified)
    if (path === "/webhook/whatsapp" && req.method === "POST") {
      const raw = await req.arrayBuffer();
      const publicKey = process.env.TELNYX_PUBLIC_KEY ?? (await e.SECRETS?.get("TELNYX_PUBLIC_KEY").catch(() => "")) ?? "";
      if (verifyTelnyxSignature(req.headers, raw, publicKey) !== 0) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
      const { from, to, text } = parseWebhookJson(raw);
      if (!from || !text) {
        return new Response(JSON.stringify({ error: "Missing from or text" }), { status: 400 });
      }

      const result = await e.SPONSOR_AGENT.idFromName(encodeAgentName(from)).handleInboundMessage({ from, to, text, channel: "whatsapp" });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Route: Inbound voice webhook (signature-verified)
    if (path === "/webhook/voice" && req.method === "POST") {
      const raw = await req.arrayBuffer();
      const publicKey = process.env.TELNYX_PUBLIC_KEY ?? (await e.SECRETS?.get("TELNYX_PUBLIC_KEY").catch(() => "")) ?? "";
      if (verifyTelnyxSignature(req.headers, raw, publicKey) !== 0) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
      const { from, callId } = parseWebhookJson(raw);
      if (!from || !callId) {
        return new Response(JSON.stringify({ error: "Missing from or call_control_id" }), { status: 400 });
      }

      const result = await e.SPONSOR_AGENT.idFromName(encodeAgentName(from)).handleInboundCall({ callId, from, to: "" });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Route: In-browser chat (REST endpoint)
    if (path === "/api/chat" && req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `chat:${Date.now()}`;
      const text = typeof body.text === "string" ? body.text : "";

      if (!text) {
        return new Response(JSON.stringify({ error: "Missing text" }), { status: 400 });
      }

      const result = await e.SPONSOR_AGENT.idFromName(encodeAgentName(sessionId)).handleChatMessage({ sessionId, text });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Route: Schedule follow-up
    if (path === "/api/followup" && req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      const { phone, channel, delaySeconds } = body;

      if (!phone || !channel || !delaySeconds) {
        return new Response(JSON.stringify({ error: "Missing phone, channel, or delaySeconds" }), { status: 400 });
      }

      const result = await e.SPONSOR_AGENT.idFromName(encodeAgentName(phone)).scheduleFollowUp({ phone, channel, delaySeconds });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Route: Attribution report
    if (path === "/api/report" && req.method === "GET") {
      try {
        const report = await e.SPONSOR_AGENT.idFromName(encodeAgentName("report")).generateAttributionReport();
        return new Response(JSON.stringify(report), { status: 200 });
      } catch (err) {
        console.error("Attribution report failed:", err);
        return new Response(JSON.stringify({ error: "Leads database unavailable — report temporarily offline" }), { status: 503 });
      }
    }

    // Route: Health check
    if (path === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "event-sponsorship-agent" }), { status: 200 });
    }

    // Brand assets
    if (path === "/logo.svg" && req.method === "GET") {
      return new Response(TELNYX_LOGO_SVG, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
      });
    }
    if (path === "/fonts/pp-formula.woff2" && req.method === "GET") {
      const woff2 = base64ToArrayBuffer(PP_FORMULA_WOFF2_B64);
      return new Response(woff2, {
        status: 200,
        headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }

    // Default: serve the branded microsite
    if (path === "/" || path === "/index.html") {
      const html = micrositeHtml({
        eventName: await cfg(e, "EVENT_NAME", "our event"),
        prize: await cfg(e, "GIVEAWAY_PRIZE", "Telnyx Developer Kit"),
        smsNumber: await cfg(e, "FROM_NUMBER", "+15550000000"),
      });
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
  },
};

/** Decode base64 to ArrayBuffer (fonts/assets). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
