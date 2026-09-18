import { Agent } from "@telnyx/edge-runtime";
import type { AppConfig, Env, PlannerState, VenueData } from "./types";
import { addDaysISO, cfg, maskPhone, todayISO } from "./types";
import {
  callCommand,
  complete,
  completeJson,
  speakPayload,
} from "./telnyx";

const FOLLOW_UP_SECONDS = 7 * 24 * 3600; // one week of planner inactivity
const QUALIFY_GUESTS = 50;
const QUALIFY_BUDGET = 10_000;
const HOT_BUDGET_WORDS = ["high", "enterprise", "premium"];

export interface PlannerDetails {
  name?: string;
  email?: string;
  event_type?: string;
  guests?: number;
  budget?: string;
  date_start?: string;
  date_end?: string;
  intent?: string;
}

export type VoiceEventType =
  | "call.initiated"
  | "call.answered"
  | "call.gather.ended"
  | "call.hangup"
  | "call.hangup.ended";

export interface ReceiveInput {
  phone: string;
  text: string;
  channel?: string;
  venue?: VenueData;
  availability?: string;
  origin?: string;
  demoMode?: string;
  smsFrom?: string;
}

export interface VoiceEventInput {
  type: VoiceEventType;
  callControlId: string;
  from?: string;
  digits?: string;
  speech?: string;
  venue?: VenueData;
  availability?: string;
  origin?: string;
  demoMode?: string;
  smsFrom?: string;
}

/** Report the actor sends back to the function (which owns SQLDB + email). */
export interface InquiryReport {
  type: "inquiry_report" | "site_visit";
  phone: string;
  name?: string;
  email?: string;
  event_type?: string;
  guests?: number;
  budget?: string;
  dates?: string;
  message?: string;
  channel?: string;
  qualified?: boolean;
  visit_date?: string;
  source?: string;
}

/** Concierge qualification: a real email plus serious scale or budget. */
export function isQualifiedLead(
  details: Pick<PlannerDetails, "email" | "guests" | "budget" | "event_type">,
): boolean {
  const email = (details.email ?? "").trim();
  if (!email || !email.includes("@")) return false;
  const guests = details.guests ?? 0;
  const budgetNum = Number(String(details.budget ?? "").replace(/[^0-9.]/g, "")) || 0;
  const budgetWord = (details.budget ?? "").toLowerCase();
  const hotBudget =
    budgetNum >= QUALIFY_BUDGET || HOT_BUDGET_WORDS.some((w) => budgetWord.includes(w));
  const bigEnough = guests >= QUALIFY_GUESTS;
  const flagship =
    ["wedding", "gala", "conference", "corporate"].includes(
      (details.event_type ?? "").toLowerCase(),
    ) && guests >= 25;
  return bigEnough || hotBudget || flagship;
}

function pickDates(state: PlannerState): { start: string; end: string } {
  return {
    start: state.dateStart ?? todayISO(),
    end: state.dateEnd ?? addDaysISO(90),
  };
}

/**
 * ConciergeAgent — one durable StatefulActor per planner (keyed by phone
 * number). Owns the conversation: durable state + history survive restarts,
 * grounded replies via Telnyx-hosted Inference (with a fallback model chain),
 * SMS replies via the zero-credential TELNYX binding, planner detail
 * extraction + qualification, and a named one-week follow-up task.
 *
 * The actor never touches KV or SQLDB bindings — the function scope owns
 * those (KV venue data and the live availability summary are passed in; the
 * actor reports inquiries/bookings back over HTTP for the venue dashboard).
 */
export class ConciergeAgent extends Agent<Env, PlannerState> {
  protected override initialState(): PlannerState {
    return {
      phone: "",
      qualified: false,
      siteVisitBooked: false,
      inquiryCount: 0,
      lastActive: Date.now(),
    };
  }

  // ── Entry: inbound SMS (or text from the browser demo) ──────────────────
  async receive(input: ReceiveInput): Promise<{ queued: boolean }> {
    const count = (await this.getState()).inquiryCount + 1;
    await this.setState({
      phone: input.phone,
      channel: input.channel ?? "sms",
      lastActive: Date.now(),
      inquiryCount: count,
      ...(input.venue ? { venue: input.venue } : {}),
      ...(input.availability ? { availability: input.availability } : {}),
      ...(input.origin ? { reportOrigin: input.origin } : {}),
      ...(input.demoMode ? { demoMode: input.demoMode } : {}),
      ...(input.smsFrom ? { smsFrom: input.smsFrom } : {}),
    });
    await this.messages.add("user", input.text);
    await this.queue("process");
    return { queued: true };
  }

  // ── Voice: Call Control events for inbound + follow-up calls ────────────
  async voiceEvent(evt: VoiceEventInput): Promise<{ handled: boolean }> {
    if (evt.venue) await this.setState({ venue: evt.venue });
    if (evt.availability) await this.setState({ availability: evt.availability });
    if (evt.origin) await this.setState({ reportOrigin: evt.origin });
    if (evt.demoMode) await this.setState({ demoMode: evt.demoMode });
    if (evt.smsFrom) await this.setState({ smsFrom: evt.smsFrom });

    const state = await this.getState();
    switch (evt.type) {
      case "call.initiated":
        await this.setState({ activeCallId: evt.callControlId });
        await callCommand(evt.callControlId, "answer", {}, this.bearer());
        return { handled: true };

      case "call.answered": {
        await this.setState({ activeCallId: evt.callControlId });
        if (state.followupCallActive) {
          // Outbound follow-up: personalized script + DTMF confirm, in one
          // gather (gather_using_speak speaks the payload, then collects).
          const script = `Hi ${state.name ?? "there"}, this is the concierge from ${this.venueName(state)}. You inquired about booking a site visit, so I wanted to personally reach out. Press 1 to book your visit now, or 2 if now isn't a good time.`;
          await callCommand(evt.callControlId, "gather_using_speak", {
            ...speakPayload(script),
            service_level: "hybrid",
            minimum_digits: 1,
            maximum_digits: 1,
            terminating_digit: "#",
            timeout_millis: 10000,
          }, this.bearer());
          return { handled: true };
        }
        // Inbound planner call: greet + start a speech conversation.
        await this.gatherSpeech(
          evt.callControlId,
          `Hello! Thank you for calling ${this.venueName(state)}. I'm the venue concierge — I can check dates, share pricing, and book your site visit. How can I help?`,
        );
        return { handled: true };
      }

      case "call.gather.ended": {
        if (evt.digits) return this.handleConfirmDigits(evt.callControlId, evt.digits);
        return this.voiceTurn(evt.callControlId, evt.speech ?? "");
      }

      case "call.hangup":
      case "call.hangup.ended":
        await this.setState({
          activeCallId: undefined,
          followupCallActive: false,
        });
        return { handled: true };
    }
    return { handled: false };
  }

  // ── Background turn: grounded reply + capture + qualify + follow-up ─────
  async process(): Promise<{ reply: string; qualified: boolean }> {
    try {
      return await this._process();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("process failed:", message);
      await this.setState({ lastError: message.slice(0, 500) });
      throw e;
    }
  }

  private async _process(): Promise<{ reply: string; qualified: boolean }> {
    await this.setState({ lastError: "", lastReport: "" });
    const state = await this.getState();
    const lastMsg = await this.messages.last();
    const lastUserText = lastMsg?.role === "user" ? String(lastMsg.content) : "";

    let reply = "";
    try {
      reply = await complete(
        this.env,
        [
          { role: "system", content: this.systemPrompt(state) },
          ...(await this.messages.toOpenAI()),
        ],
        { temperature: 0.4 },
      );
    } catch (e) {
      console.error("inference failed:", e instanceof Error ? e.message : e);
    }
    if (!reply) reply = this.fallbackReply(state);

    // Extract planner details from the whole conversation so far.
    const transcript = (await this.messages.toOpenAI())
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const details = await this.extractDetails(transcript);
    const merged: PlannerState = {
      ...state,
      ...this.detailsToState(state, details),
    };

    const newlyQualified = !merged.qualified && isQualifiedLead(merged);
    if (newlyQualified) merged.qualified = true;
    await this.setState(merged);

    await this.messages.add("assistant", reply);
    await this.sendReplySms(merged.phone, reply);

    // Report the interaction to the function — it owns the SQLDB inquiry log,
    // brochure delivery, and qualified-lead alerts.
    await this.reportToFunction({
      type: "inquiry_report",
      phone: merged.phone,
      name: merged.name,
      email: merged.email,
      event_type: merged.eventType,
      guests: merged.guests,
      budget: merged.budget,
      dates:
        merged.dateStart && merged.dateEnd ? `${merged.dateStart} → ${merged.dateEnd}` : undefined,
      message: lastUserText,
      channel: merged.channel ?? "sms",
      qualified: merged.qualified,
    });

    // Re-arm the one-week follow-up window on every touchpoint.
    if (!merged.qualified && merged.inquiryCount >= 2) {
      await this.schedule(FOLLOW_UP_SECONDS, "followUpCall", null, { id: "followup" });
    }

    return { reply, qualified: merged.qualified };
  }

  /** One voice exchange: speech → LLM → spoken reply → gather again. */
  private async voiceTurn(callControlId: string, speech: string): Promise<{ handled: boolean }> {
    if (speech.trim()) {
      await this.messages.add("user", speech);
      await this.setState({
        lastActive: Date.now(),
        inquiryCount: (await this.getState()).inquiryCount + 1,
      });
    }

    const state = await this.getState();
    let reply = "";
    try {
      reply = await complete(
        this.env,
        [
          { role: "system", content: this.systemPrompt(state) },
          ...(await this.messages.toOpenAI()),
        ],
        { temperature: 0.4 },
      );
    } catch (e) {
      console.error("voice inference failed:", e instanceof Error ? e.message : e);
    }
    if (!reply) reply = this.fallbackReply(state);

    await this.messages.add("assistant", reply);

    const details = await this.extractDetails(speech);
    const merged: PlannerState = { ...state, ...this.detailsToState(state, details) };
    const newlyQualified = !merged.qualified && isQualifiedLead(merged);
    if (newlyQualified) merged.qualified = true;
    await this.setState(merged);

    await this.reportToFunction({
      type: "inquiry_report",
      phone: merged.phone,
      name: merged.name,
      email: merged.email,
      event_type: merged.eventType,
      guests: merged.guests,
      budget: merged.budget,
      dates:
        merged.dateStart && merged.dateEnd ? `${merged.dateStart} → ${merged.dateEnd}` : undefined,
      message: speech,
      channel: "voice",
      qualified: merged.qualified,
    });

    // Want a site visit? Switch to a DTMF confirmation to lock it in.
    const wantsVisit = /site visit|book a tour|come see|visit the venue|schedule a tour/i.test(
      `${speech} ${reply}`,
    );
    if (wantsVisit) {
      await callCommand(callControlId, "gather_using_speak", {
        ...speakPayload(
          "Wonderful — I can book a site visit right now. Press 1 to confirm, or 2 to keep chatting instead.",
        ),
        service_level: "hybrid",
        minimum_digits: 1,
        maximum_digits: 1,
        terminating_digit: "#",
        timeout_millis: 10000,
      }, this.bearer());
      return { handled: true };
    }

    await callCommand(callControlId, "speak", speakPayload(reply), this.bearer());
    await this.gatherSpeech(callControlId);
    return { handled: true };
  }

  private async handleConfirmDigits(callControlId: string, digits: string): Promise<{ handled: boolean }> {
    if (digits.trim() !== "1") {
      await callCommand(
        callControlId,
        "speak",
        speakPayload("No problem at all. Feel free to text us any time — have a great day!"),
        this.bearer(),
      );
      await callCommand(callControlId, "hangup", {}, this.bearer());
      return { handled: true };
    }

    const state = await this.getState();
    const visitDate = addDaysISO(7); // default: one week out
    await this.setState({ siteVisitBooked: true, followupCallActive: false });
    await callCommand(
      callControlId,
      "speak",
      speakPayload(
        `Perfect! Your site visit is booked for ${visitDate}. We've emailed the details to ${state.email ?? "your inbox"}. We can't wait to show you around. Goodbye!`,
      ),
      this.bearer(),
    );
    await this.reportToFunction({
      type: "site_visit",
      phone: state.phone,
      name: state.name,
      email: state.email,
      visit_date: visitDate,
      source: state.followupCallActive ? "followup-call" : "voice-call",
    });
    await callCommand(callControlId, "hangup", {}, this.bearer());
    return { handled: true };
  }

  // ── Scheduled task: personalized voice follow-up after 1 quiet week ─────
  async followUpCall(opts?: { force?: boolean }): Promise<{ called: boolean; reason?: string }> {
    const state = await this.getState();

    if ((state.demoMode ?? this.cfg().DEMO_MODE) !== "false") {
      console.log(
        `[DEMO] Would place personalized follow-up call to ${maskPhone(state.phone)}` +
          `${state.name ? ` (for ${state.name})` : ""}: "Hi! Following up on your venue inquiry — would you like to book a site visit?"`,
      );
      return { called: false, reason: "demo_mode" };
    }
    if (state.siteVisitBooked) return { called: false, reason: "already_booked" };
    // `force` (demo trigger) bypasses only the 7-day recency window.
    if (!opts?.force && Date.now() - state.lastActive < FOLLOW_UP_SECONDS * 1000) {
      return { called: false, reason: "planner_active_recently" };
    }
    const last = await this.messages.last();
    if (!opts?.force && last && last.role === "user") {
      return { called: false, reason: "planner_replied_after_us" };
    }

    const connectionId = this.cfg().TELNYX_CONNECTION_ID;
    if (!connectionId) return { called: false, reason: "no_connection_id" };

    await this.setState({ followupCallActive: true });
    // Dial via the zero-credential [telnyx] binding (env.TELNYX.calls.dial) —
    // env vars and REST keys don't reach actor scope.
    const from = state.smsFrom || this.cfg().TELNYX_SMS_FROM;
    const origin = state.reportOrigin || this.cfg().PUBLIC_ORIGIN;
    try {
      const dial = await this.env.TELNYX.calls.dial({
        connection_id: connectionId,
        from,
        to: state.phone,
        ...(origin ? { webhook_url: `${origin}/webhooks/voice` } : {}),
      });
      const callControlId = (dial as { data?: { call_control_id?: string } }).data?.call_control_id;
      if (callControlId) await this.setState({ activeCallId: callControlId });
      return { called: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("follow-up dial failed:", message);
      await this.setState({ followupCallActive: false, lastError: `dial: ${message.slice(0, 300)}` });
      return { called: false, reason: "dial_failed" };
    }
  }

  // ── Debug / dashboard inspection ────────────────────────────────────────
  async getDebugState(): Promise<{ state: PlannerState; messageCount: number; lastMessage: unknown }> {
    const state = await this.getState();
    const count = await this.messages.count();
    const last = await this.messages.last();
    return { state, messageCount: count, lastMessage: last };
  }

  // ── Internals ───────────────────────────────────────────────────────────
  /** Env-first config resolution (env vars land in the bindings env). */
  private cfg(): AppConfig {
    return cfg(this.env);
  }

  /** Bearer token for REST calls from the actor (env-first). */
  private bearer(): string {
    return this.cfg().TELNYX_API_KEY;
  }

  private venueName(state: PlannerState): string {
    return state.venue?.venue.name ?? "our venue";
  }

  private systemPrompt(state: PlannerState): string {
    const venue = state.venue;
    if (!venue) {
      return `You are a venue sales concierge. Help event planners check availability, get pricing, request proposals, and book site visits. Be warm and brief. Today is ${todayISO()}.`;
    }
    return [
      `You are the sales concierge for ${venue.venue.name} (${venue.venue.location}) — ${venue.venue.tagline}.`,
      `Help event planners check availability, get pricing, request proposals, and book site visits.`,
      `Be warm, brief (2-4 sentences on SMS), and concrete. Quote ONLY facts from the venue data below; if something isn't in the data, say you'll check with the sales team.`,
      `Today's date: ${todayISO()}.`,
      ``,
      `LIVE AVAILABILITY (from the venue SQL database): ${state.availability ?? "not available right now"}`,
      ``,
      `PLANNER CONTEXT: ${JSON.stringify({
        name: state.name,
        email: state.email,
        event_type: state.eventType,
        guests: state.guests,
        budget: state.budget,
        dates: state.dateStart && state.dateEnd ? `${state.dateStart} → ${state.dateEnd}` : undefined,
        qualified: state.qualified,
        site_visit_booked: state.siteVisitBooked,
      })}`,
      ``,
      `VENUE DATA (live from KV — the same data the website shows):`,
      JSON.stringify(venue),
    ].join("\n");
  }

  private fallbackReply(state: PlannerState): string {
    return `Thanks for reaching out to ${this.venueName(state)}! I can help with availability, pricing, catering menus, and booking a site visit — what would you like to know?`;
  }

  private async extractDetails(transcript: string): Promise<PlannerDetails | null> {
    try {
      return await completeJson<PlannerDetails>(
        this.env,
        `From this conversation with an event planner, extract: name, email, event_type (wedding/gala/corporate/conference/other), guests (number), budget (string), date_start (YYYY-MM-DD), date_end (YYYY-MM-DD), intent (pricing|availability|proposal|site_visit|other). Use "" or 0 for unknowns.`,
        transcript,
      );
    } catch (e) {
      console.error("extraction failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }

  private detailsToState(state: PlannerState, details: PlannerDetails | null): Partial<PlannerState> {
    if (!details) return {};
    const out: Partial<PlannerState> = {};
    if (details.name && !state.name) out.name = details.name;
    if (details.email && !state.email) out.email = details.email;
    if (details.event_type && !state.eventType) out.eventType = details.event_type;
    if (details.guests && !state.guests) out.guests = details.guests;
    if (details.budget && !state.budget) out.budget = details.budget;
    if (details.date_start && !state.dateStart) out.dateStart = details.date_start;
    if (details.date_end && !state.dateEnd) out.dateEnd = details.date_end;
    return out;
  }

  /**
   * Report inquiries/bookings back to the function scope — the function owns
   * the shared SQLDB (dashboard) and all email sends. No-op unless
   * PUBLIC_ORIGIN is configured.
   */
  private async reportToFunction(report: InquiryReport): Promise<void> {
    const config = this.cfg();
    const origin = (await this.getState()).reportOrigin || config.PUBLIC_ORIGIN;
    if (!origin) {
      console.error("PUBLIC_ORIGIN not set — inquiry report not delivered:", report.type);
      await this.setState({
        lastReport: `no_origin key=${Boolean(config.TELNYX_API_KEY)} @ ${Date.now()}`,
      });
      return;
    }
    try {
      const resp = await fetch(`${origin}/api/leads/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.INGEST_TOKEN ? { "x-ingest-token": config.INGEST_TOKEN } : {}),
        },
        body: JSON.stringify(report),
      });
      const status = `http_${resp.status} @ ${Date.now()}`;
      console.error(`ingest: ${status}`);
      await this.setState({ lastReport: status });
      if (!resp.ok) console.error(`ingest body: ${(await resp.text()).slice(0, 200)}`);
    } catch (e) {
      const status = `fetch_err:${(e instanceof Error ? e.message : String(e)).slice(0, 120)} @ ${Date.now()}`;
      console.error("ingest failed:", status);
      await this.setState({ lastReport: status });
    }
  }

  private async sendReplySms(to: string, text: string): Promise<void> {
    const state = await this.getState();
    if ((state.demoMode ?? this.cfg().DEMO_MODE) !== "false") {
      console.log(`[DEMO] Would send SMS to ${maskPhone(to)}: ${text.slice(0, 160)}`);
      return;
    }
    try {
      const from = state.smsFrom || this.cfg().TELNYX_SMS_FROM;
      await this.env.TELNYX.messages.send({
        from,
        to,
        text: text.slice(0, 640),
      });
    } catch (e) {
      console.error("sms failed:", e instanceof Error ? e.message : e);
    }
  }

  private async gatherSpeech(callControlId: string, prompt = "Anything else I can help you with?"): Promise<void> {
    await callCommand(
      callControlId,
      "gather_using_speak",
      {
        ...speakPayload(prompt),
        service_level: "hybrid",
        speech_recognition_timeout_ms: 10000,
      },
      this.bearer(),
    );
  }
}
