/**
 * AppointmentSlot — the durable entity IS the open appointment slot (DEV-1223).
 *
 * When a patient cancels or misses an appointment, a scheduling webhook opens
 * the slot and ONE durable actor is born for it: the AppointmentSlot owns the
 * entire recovery workflow — it calls/texts the missed patient to reschedule,
 * then works the waitlist in priority order until someone confirms. Keeping
 * slot status, outreach attempts, confirmations, and the waitlist cursor in
 * one durable actor is what makes double-booking impossible.
 *
 * Telnyx Edge primitives used (per DEV-1223):
 *  - Agent SDK (Stateful Actors) -> class AppointmentSlot extends Agent<Env, SlotState>
 *    addressed via `env.SLOTS.idFromName(slotId)`; born on the mock scheduling
 *    webhook's openSlot RPC — one durable actor per appointment slot.
 *  - Per-actor SQL               -> `this.ctx.storage.sql.exec(...)` — an
 *    append-only `outreach_attempts` ledger plus a single-row `confirmations`
 *    table that acts as the durable confirmation lock.
 *  - Scheduled tasks             -> `this.schedule(...)` — reply-window sweeps,
 *    retry budgets, and slot expiry all survive worker eviction.
 *  - Call Control                -> `POST /v2/calls` to dial the missed patient
 *    and waitlist candidates, `/actions/speak` for the offer, optional
 *    `/actions/gather_using_ai` to classify the reply intent.
 *  - Messaging                   -> `this.env.TELNYX.messages.send(...)` for
 *    SMS outreach and confirmations; `message.received` webhooks route replies
 *    back to the same actor-owned slot state.
 *
 * The actor owns the scarce resource: one appointment slot. The hard problem
 * is coordination — retries, waitlist order, confirmation races, and no
 * double-booking — not medical advice. All patients in the demo are synthetic;
 * no PHI or clinical advice is involved.
 *
 * Restart/idempotency contract:
 *  - Waitlist cursor, outreach budget, and the confirmation lock live in
 *    durable actor state + SQL. Killing the actor mid-outreach loses nothing:
 *    the next inbound reply, call event, or scheduled timer wakes the same
 *    actor with the same cursor.
 *  - `confirmations.slot_id` is a PRIMARY KEY — only the first confirmation
 *    ever lands; late replies get "slot already taken".
 *  - Every sweep/retry task carries a `generation`; once the slot fills, the
 *    generation bumps and every in-flight timer no-ops — outreach stops.
 */

import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import Telnyx from "telnyx";

/** Telnyx SDK client used for webhook signature verification only. */
const telnyxVerifyClient = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY ?? "unused-webhook-verification-only",
});

// ── Env bindings (resolved from telnyx.toml) ──────────────────────────────

export interface Env {
  SLOTS: SlotNamespace;
  SLOT_INDEX: SlotIndexNamespace;
  TELNYX: {
    messages: {
      send(req: { from: string; to: string; text: string }): Promise<unknown>;
    };
  };
  SECRETS: { get: (handle: string) => Promise<string> };
}

type SlotStub = ActorStub &
  Pick<
    AppointmentSlot,
    "openSlot" | "onInboundMessage" | "onCallEvent" | "inspect" | "ledgerSnapshot"
  >;

interface SlotNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): SlotStub;
}

type SlotIndexStub = ActorStub & Pick<SlotIndex, "register" | "clear" | "lookup">;

interface SlotIndexNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): SlotIndexStub;
}

// ── Config (secrets bindings with plain env-var fallback) ─────────────────
// The Edge runtime does NOT inject [env_vars] for actor projects, so config
// ships as [[secrets]] bindings in telnyx.toml and is read via SECRETS.get()
// with a plain env-var fallback (for local tooling).

function directEnv(e: Env, key: string): string | undefined {
  const v = (e as unknown as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function readConfig(e: Env, key: string): Promise<string | undefined> {
  const direct = directEnv(e, key);
  if (direct) return direct;
  try {
    const v = await e.SECRETS.get(key);
    return v || undefined;
  } catch {
    return undefined;
  }
}

async function isDemoMode(e: Env): Promise<boolean> {
  return (await readConfig(e, "DEMO_MODE")) !== "false";
}

async function readNumberConfig(
  e: Env,
  key: string,
  fallback: number,
): Promise<number> {
  const raw = await readConfig(e, key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Config defaults per DEV-1223. */
const DEFAULTS = {
  WAITLIST_REPLY_TIMEOUT_MIN: 10,
  OUTREACH_RETRY_MAX: 2,
  SLOT_EXPIRY_MIN: 60,
  CLINIC_TIMEZONE: "America/New_York",
} as const;

const TELNYX_API = "https://api.telnyx.com/v2";

// ── Types ─────────────────────────────────────────────────────────────────

export type SlotStatus =
  | "open"
  | "offering"
  | "filled"
  | "rescheduled"
  | "expired"
  | "unresolved";

export type Channel = "voice" | "sms";

export type AttemptStatus =
  | "attempted"
  | "answered"
  | "no_answer"
  | "timeout"
  | "declined"
  | "rescheduled"
  | "confirmed"
  | "given_up"
  | "closed";

export type ReplyDecision =
  | "reschedule"
  | "later"
  | "decline"
  | "confirm";

export interface Patient {
  name: string;
  phone: string;
}

export interface WaitlistEntry extends Patient {
  /** Lower number = higher priority (1 fills first). */
  priority: number;
}

export interface Candidate {
  name: string;
  phone: string;
  role: "missed" | "waitlist";
  channel: Channel;
  attempts: number;
  callControlId: string | null;
}

export interface Confirmation {
  patient: string;
  confirmedAt: number;
  source: Channel;
}

export interface SlotState extends Record<string, unknown> {
  slotId: string;
  provider: string;
  startsAt: string;
  timezone: string;
  missedPatient: Patient;
  waitlist: WaitlistEntry[];
  /** Index into waitlist for the candidate being worked; -1 = none yet. */
  cursor: number;
  currentCandidate: Candidate | null;
  confirmation: Confirmation | null;
  status: SlotStatus;
  /** Bumped on every phase transition — in-flight sweep timers no-op on mismatch. */
  generation: number;
}

export interface OpenSlotPayload {
  slotId: string;
  provider: string;
  /** ISO datetime the slot was scheduled for, e.g. "2026-10-08T10:00:00". */
  startsAt: string;
  missedPatient: Patient;
  waitlist: WaitlistEntry[];
}

export interface InboundMessage {
  from: string;
  text: string;
}

export interface CallEventPayload {
  eventType: string;
  callControlId: string;
  /** Classified intent from gather_using_ai, when present. */
  intent?: string;
  /** Raw gather_using_ai result (live mode), e.g. { intent, utterance }. */
  result?: Record<string, unknown>;
  /** Callee number (E.164) for outbound-call events. */
  to?: string;
}

export interface AttemptRecord {
  slotId: string;
  patient: string;
  channel: Channel;
  status: AttemptStatus;
  detail: string;
  ts: number;
}

export interface ConfirmationRecord {
  slotId: string;
  patient: string;
  confirmedAt: number;
  source: Channel;
}

/** Read-only snapshot exposed by inspect() / GET /state/:slotId. */
export interface SlotSnapshot {
  slotId: string;
  status: SlotStatus;
  provider: string;
  startsAt: string;
  cursor: number;
  waitlistLength: number;
  currentCandidate: Candidate | null;
  confirmation: Confirmation | null;
  generation: number;
}

// ── The slot actor ────────────────────────────────────────────────────────

/** Slots in these states no longer accept outreach or replies. */
const TERMINAL_STATUSES: readonly SlotStatus[] = ["filled", "rescheduled", "expired", "unresolved"];

function isClosed(status: SlotStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class AppointmentSlot extends Agent<Env, SlotState> {
  protected initialState(): SlotState {
    return {
      slotId: "",
      provider: "",
      startsAt: "",
      timezone: DEFAULTS.CLINIC_TIMEZONE,
      missedPatient: { name: "", phone: "" },
      waitlist: [],
      cursor: -1,
      currentCandidate: null,
      confirmation: null,
      status: "open",
      generation: 0,
    };
  }

  /**
   * Scheduling webhook RPC: the slot actor is born here.
   * `env.SLOTS.idFromName(slotId)` resolves this instance, so the durable
   * entity is created on demand and self-provisions its ledger schema.
   */
  @rpc({ description: "Open a recovered appointment slot and start the recovery workflow" })
  async openSlot(payload: OpenSlotPayload): Promise<{ ok: boolean; slotId: string }> {
    if (!payload?.slotId || !payload?.provider || !payload?.startsAt) {
      throw new Error("slotId, provider and startsAt are required");
    }
    if (!isValidE164(payload.missedPatient?.phone ?? "")) {
      throw new Error("missedPatient.phone must be E.164");
    }
    const waitlist = sortWaitlist(payload.waitlist ?? []);
    for (const entry of waitlist) {
      if (!isValidE164(entry.phone)) {
        throw new Error(`waitlist phone must be E.164: ${entry.phone}`);
      }
    }

    const previous = await this.getState();
    if (previous.slotId && previous.slotId !== payload.slotId) {
      throw new Error("actor is already bound to a different slot");
    }
    if (previous.status === "filled" || previous.status === "rescheduled") {
      return { ok: true, slotId: previous.slotId }; // idempotent re-open
    }

    await this.setState({
      slotId: payload.slotId,
      provider: payload.provider,
      startsAt: payload.startsAt,
      timezone:
        (await readConfig(this.env, "CLINIC_TIMEZONE")) ??
        DEFAULTS.CLINIC_TIMEZONE,
      missedPatient: payload.missedPatient,
      waitlist,
      cursor: -1,
      currentCandidate: null,
      status: "open",
      generation: previous.generation + 1,
    });

    this.ensureTables();
    await this.recordAttempt({
      slotId: payload.slotId,
      patient: payload.missedPatient.phone,
      channel: "sms",
      status: "closed",
      detail: `slot opened: ${payload.provider} @ ${payload.startsAt}, waitlist=${waitlist.length}`,
      ts: Date.now(),
    });

    // Slot expiry: if nobody confirms within SLOT_EXPIRY_MIN, close as expired.
    const expiryMin = await readNumberConfig(
      this.env,
      "SLOT_EXPIRY_MIN",
      DEFAULTS.SLOT_EXPIRY_MIN,
    );
    this.schedule(
      expiryMin * 60,
      "expireSlot",
      {},
      { id: `expiry:${payload.slotId}` },
    );

    await this.recoverMissedPatient();
    return { ok: true, slotId: payload.slotId };
  }

  /**
   * Missed-patient recovery: the original patient is contacted first.
   * Voice call (with speak + optional gather_using_ai in live mode); the
   * reply window then decides reschedule / later / decline / timeout.
   */
  async recoverMissedPatient(): Promise<{ ok: boolean; candidate: Candidate | null }> {
    const state = await this.getState();
    if (state.confirmation || isClosed(state.status)) {
      return { ok: true, candidate: null }; // already claimed or closed
    }
    const candidate: Candidate = {
      ...state.missedPatient,
      role: "missed",
      channel: "voice",
      attempts: 1,
      callControlId: null,
    };
    const generation = state.generation + 1;
    await this.setState({
      currentCandidate: candidate,
      status: "offering",
      generation,
    });

    await this.recordAttempt({
      slotId: state.slotId,
      patient: candidate.phone,
      channel: "voice",
      status: "attempted",
      detail: "missed-patient recovery call",
      ts: Date.now(),
    });
    await this.placeCall(candidate, this.missedPatientScript(candidate.name));
    await this.registerIndex(candidate.phone, "missed");

    const window = await this.replyWindowSeconds();
    this.schedule(window, "sweepCandidate", { generation }, {
      id: `sweep:missed:${generation}`,
    });
    return { ok: true, candidate };
  }

  /**
   * Waitlist fill: contact the next candidate in priority order. First
   * patient to reply/confirm wins; no reply within the window retries within
   * budget, then moves on to the next patient.
   */
  async contactNextWaitlistPatient(): Promise<{ ok: boolean; candidate: Candidate | null }> {
    const state = await this.getState();
    if (state.confirmation || isClosed(state.status)) {
      return { ok: true, candidate: null };
    }
    const next = state.cursor + 1;
    if (next >= state.waitlist.length) {
      // Waitlist exhausted — nobody confirmed before the deadline.
      const generation = state.generation + 1;
      await this.setState({ status: "unresolved", generation });
      await this.recordAttempt({
        slotId: state.slotId,
        patient: "waitlist",
        channel: "sms",
        status: "given_up",
        detail: `waitlist exhausted (${state.waitlist.length} candidates)`,
        ts: Date.now(),
      });
      await this.clearIndex();
      return { ok: true, candidate: null };
    }

    const entry = state.waitlist[next];
    const candidate: Candidate = {
      ...entry,
      role: "waitlist",
      channel: "voice",
      attempts: 1,
      callControlId: null,
    };
    const generation = state.generation + 1;
    await this.setState({
      cursor: next,
      currentCandidate: candidate,
      status: "offering",
      generation,
    });

    await this.recordAttempt({
      slotId: state.slotId,
      patient: candidate.phone,
      channel: "voice",
      status: "attempted",
      detail: `waitlist offer (priority ${entry.priority})`,
      ts: Date.now(),
    });
    await this.placeCall(candidate, this.waitlistScript(candidate.name));
    await this.registerIndex(candidate.phone, "waitlist");

    const window = await this.replyWindowSeconds();
    this.schedule(window, "sweepCandidate", { generation }, {
      id: `sweep:waitlist:${generation}`,
    });
    return { ok: true, candidate };
  }

  /**
   * Reply-window sweep (scheduled task): if the current candidate has not
   * replied within the window, retry within budget (alternating voice/SMS),
   * then advance to the next waitlist patient.
   */
  async sweepCandidate(payload: { generation: number }): Promise<{ ok: boolean; skipped?: boolean }> {
    const state = await this.getState();
    if (state.confirmation || isClosed(state.status) || state.generation !== payload.generation) {
      return { ok: true, skipped: true }; // filled, closed, or a stale timer
    }
    const candidate = state.currentCandidate;
    if (!candidate) return { ok: true, skipped: true };

    const retryMax = await readNumberConfig(
      this.env,
      "OUTREACH_RETRY_MAX",
      DEFAULTS.OUTREACH_RETRY_MAX,
    );
    if (candidate.attempts > retryMax) {
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: candidate.channel,
        status: "given_up",
        detail: `no reply after ${candidate.attempts} attempts`,
        ts: Date.now(),
      });
      return this.advance();
    }

    // Retry the same patient on the other channel.
    const nextChannel: Channel = candidate.channel === "voice" ? "sms" : "voice";
    const retried: Candidate = {
      ...candidate,
      channel: nextChannel,
      attempts: candidate.attempts + 1,
      callControlId: null,
    };
    const generation = state.generation + 1;
    await this.setState({ currentCandidate: retried, generation });

    await this.recordAttempt({
      slotId: state.slotId,
      patient: retried.phone,
      channel: nextChannel,
      status: "attempted",
      detail: `retry ${retried.attempts}/${retryMax + 1} after no reply`,
      ts: Date.now(),
    });
    if (nextChannel === "voice") {
      await this.placeCall(retried, this.scriptFor(retried));
    } else {
      await this.sendSms(retried.phone, this.scriptFor(retried));
    }

    const window = await this.replyWindowSeconds();
    this.schedule(window, "sweepCandidate", { generation }, {
      id: `sweep:${retried.role}:${generation}`,
    });
    return { ok: true };
  }

  /** Advance past the current candidate: next waitlist entry or unresolved. */
  async advance(): Promise<{ ok: boolean; candidate: Candidate | null }> {
    const state = await this.getState();
    if (state.confirmation) return { ok: true, candidate: null };
    // The cursor starts at -1, so the first call after the missed patient
    // gave up moves to waitlist[0]; a waitlist candidate advances cursor+1.
    return this.contactNextWaitlistPatient();
  }

  /**
   * Call Control event seam — both the real Telnyx webhooks (live mode) and
   * the deterministic demo driver (/demo/call-event) resolve through here, so
   * the same actor-owned slot state answers calls and simulated calls alike.
   *
   * Live voice flow: call.answered → speak the offer → call.speak.ended →
   * gather_using_ai (classifies the reply) → call.ai_gather.ended →
   * applyDecision → hangup.
   */
  @rpc({ description: "Handle a Call Control event routed to this slot" })
  async onCallEvent(
    payload: CallEventPayload,
  ): Promise<{ ok: boolean; handled: boolean; decision?: ReplyDecision }> {
    const state = await this.getState();
    const candidate = state.currentCandidate;
    if (!candidate || state.confirmation || isClosed(state.status)) {
      return { ok: true, handled: false };
    }

    const matches =
      (payload.callControlId && candidate.callControlId === payload.callControlId) ||
      (payload.to && payload.to === candidate.phone);

    if (payload.eventType === "call.answered") {
      if (!matches) return { ok: true, handled: false };
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: "voice",
        status: "answered",
        detail: "call answered — speaking offer",
        ts: Date.now(),
      });
      await this.speak(candidate.callControlId, this.scriptFor(candidate));
      return { ok: true, handled: true };
    }

    if (payload.eventType === "call.speak.ended") {
      if (!matches) return { ok: true, handled: false };
      await this.gatherUsingAi(candidate.callControlId, candidate);
      return { ok: true, handled: true };
    }

    if (payload.eventType === "call.ai_gather.ended") {
      if (!matches) return { ok: true, handled: false };
      const intent =
        (payload.result?.intent as string | undefined) ??
        (payload.result?.utterance as string | undefined) ??
        payload.intent ??
        "";
      const decision = parseDecision(candidate.role, intent);
      if (!decision) {
        await this.recordAttempt({
          slotId: state.slotId,
          patient: candidate.phone,
          channel: "voice",
          status: "no_answer",
          detail: `gather ended without a usable intent: ${intent.slice(0, 80)}`,
          ts: Date.now(),
        });
        await this.hangup(candidate.callControlId);
        return { ok: true, handled: true };
      }
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: "voice",
        status: "answered",
        detail: `voice intent: ${decision}`,
        ts: Date.now(),
      });
      await this.applyDecision(decision, candidate, "voice");
      await this.hangup(candidate.callControlId);
      return { ok: true, handled: true, decision };
    }

    if (payload.eventType === "call.ai_gather.failed") {
      if (!matches) return { ok: true, handled: false };
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: "voice",
        status: "no_answer",
        detail: "gather failed — no reply captured",
        ts: Date.now(),
      });
      await this.hangup(candidate.callControlId);
      return { ok: true, handled: true };
    }

    if (payload.eventType === "call.hangup") {
      if (!matches) return { ok: true, handled: false };
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: "voice",
        status: "no_answer",
        detail: "call ended without a decision",
        ts: Date.now(),
      });
      return { ok: true, handled: true };
    }

    return { ok: true, handled: false };
  }

  /**
   * Inbound SMS seam — real message.received webhooks and the demo driver
   * both land here, so replies always resolve through the actor-owned slot
   * state (cursor + confirmation lock).
   */
  @rpc({ description: "Handle an inbound SMS reply against the actor-owned slot state" })
  async onInboundMessage(
    msg: InboundMessage,
  ): Promise<{ ok: boolean; reply: string; decision?: ReplyDecision }> {
    if (!msg?.from || !msg?.text) {
      throw new Error("from and text are required");
    }
    const state = await this.getState();

    if (state.confirmation) {
      if (msg.from !== state.confirmation.patient) {
        return {
          ok: true,
          reply: `Sorry — the ${state.provider} slot at ${state.startsAt} was just filled. You're still on our waitlist for future openings.`,
        };
      }
      return { ok: true, reply: "You're all set! Reply CANCEL to release this appointment." };
    }

    if (state.status === "expired" || state.status === "unresolved") {
      return { ok: true, reply: "This slot has closed. We'll reach out for the next opening." };
    }

    const candidate = state.currentCandidate;
    const isMissed = msg.from === state.missedPatient.phone;
    const isCandidate = candidate && msg.from === candidate.phone;
    if (!isMissed && !isCandidate) {
      return { ok: true, reply: "Thanks! We'll be in touch about upcoming openings." };
    }

    const decision = parseDecision(
      isMissed && !isCandidate ? "missed" : (candidate?.role ?? "waitlist"),
      msg.text,
    );
    if (!decision) {
      return {
        ok: true,
        reply:
          isMissed && !isCandidate
            ? "Reply RESCHEDULE to rebook your missed appointment, LATER for a callback, or DECLINE to pass."
            : "Reply YES to take the open slot, or NO to pass.",
      };
    }
    const reply = await this.applyDecision(decision, candidate ?? {
      ...state.missedPatient,
      role: "missed",
      channel: "sms",
      attempts: 1,
      callControlId: null,
    }, "sms");
    return { ok: true, reply, decision };
  }

  /**
   * The confirmation lock. First confirmation wins: `confirmations.slot_id`
   * is a PRIMARY KEY, so a late reply can never double-book the slot. After a
   * win, the generation bumps — every pending sweep/retry timer no-ops and
   * all further outreach stops.
   */
  async applyDecision(
    decision: ReplyDecision,
    candidate: Candidate,
    source: Channel,
  ): Promise<string> {
    const state = await this.getState();

    if (decision === "confirm") {
      if (state.confirmation) {
        return `Sorry — ${state.confirmation.patient} claimed this slot first.`;
      }
      const recorded = await this.recordConfirmation({
        slotId: state.slotId,
        patient: candidate.phone,
        confirmedAt: Date.now(),
        source,
      });
      if (!recorded) {
        // Lost a race between two actors/invocations — the SQL lock held.
        return "Sorry — this slot was just filled.";
      }
      const generation = state.generation + 1;
      await this.setState({
        confirmation: {
          patient: candidate.phone,
          confirmedAt: Date.now(),
          source,
        },
        status: "filled",
        generation,
      });
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: source,
        status: "confirmed",
        detail: `first confirmation wins (${source})`,
        ts: Date.now(),
      });
      const confirmSms = `Confirmed: ${state.provider} at ${state.startsAt} (${state.timezone}). Reply CANCEL to release.`;
      await this.sendSms(candidate.phone, confirmSms);
      await this.clearIndex();
      return confirmSms;
    }

    if (decision === "reschedule") {
      // Only the missed patient reschedules: record the outcome and close
      // the recovery workflow — no waitlist fill needed.
      const generation = state.generation + 1;
      await this.setState({ status: "rescheduled", generation });
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: source,
        status: "rescheduled",
        detail: "missed patient rebooked — recovery closed",
        ts: Date.now(),
      });
      await this.sendSms(
        candidate.phone,
        `Rebooked — we'll confirm your new ${state.provider} time shortly.`,
      );
      await this.clearIndex();
      return "Rebooked — we'll confirm your new time shortly.";
    }

    if (decision === "later") {
      // Confirm later: schedule one more sweep inside the current budget.
      await this.recordAttempt({
        slotId: state.slotId,
        patient: candidate.phone,
        channel: source,
        status: "attempted",
        detail: "asked for a callback later",
        ts: Date.now(),
      });
      await this.sweepCandidate({ generation: state.generation });
      return "No problem — we'll try again shortly.";
    }

    // decline: a declined missed patient leaves the slot open for the
    // waitlist; a declined waitlist candidate moves the cursor forward.
    await this.recordAttempt({
      slotId: state.slotId,
      patient: candidate.phone,
      channel: source,
      status: "declined",
      detail: `${candidate.role} patient declined`,
      ts: Date.now(),
    });
    await this.contactNextWaitlistPatient();
    return "Understood — passing on this slot.";
  }

  /**
   * Slot expiry (scheduled task): nobody confirmed and the deadline passed.
   */
  async expireSlot(): Promise<{ ok: boolean; skipped?: boolean }> {
    const state = await this.getState();
    const stillWorkable = state.status === "open" || state.status === "offering";
    if (state.confirmation || !stillWorkable) {
      return { ok: true, skipped: true };
    }
    const generation = state.generation + 1;
    await this.setState({ status: "expired", generation });
    await this.recordAttempt({
      slotId: state.slotId,
      patient: "slot",
      channel: "sms",
      status: "closed",
      detail: "slot expired without a confirmation",
      ts: Date.now(),
    });
    await this.clearIndex();
    return { ok: true };
  }

  /** Read-only snapshot for demos, /state/:slotId, and the restart proof. */
  @rpc({ description: "Read-only slot snapshot: status, cursor, confirmation lock" })
  async inspect(): Promise<SlotSnapshot> {
    const s = await this.getState();
    return {
      slotId: s.slotId,
      status: s.status,
      provider: s.provider,
      startsAt: s.startsAt,
      cursor: s.cursor,
      waitlistLength: s.waitlist.length,
      currentCandidate: s.currentCandidate ?? null,
      confirmation: s.confirmation ?? null,
      generation: s.generation,
    };
  }

  /** Outreach ledger snapshot for /ledger/:slotId. */
  @rpc({ description: "Outreach ledger snapshot: every attempt plus the confirmation" })
  async ledgerSnapshot(): Promise<{
    attempts: AttemptRecord[];
    confirmation: ConfirmationRecord | null;
  }> {
    const state = await this.getState();
    return {
      attempts: this.attemptsFor(state.slotId),
      confirmation: this.existingConfirmation(state.slotId),
    };
  }

  // ── Script helpers ──────────────────────────────────────────────────────

  scriptFor(candidate: Candidate): string {
    return candidate.role === "missed"
      ? this.missedPatientScript(candidate.name)
      : this.waitlistScript(candidate.name);
  }

  missedPatientScript(name: string): string {
    return `Hi ${name || "there"}, this is your clinic scheduling line. You missed your appointment and we have the slot open. Say RESCHEDULE to rebook, LATER for a callback, or DECLINE to pass.`;
  }

  waitlistScript(name: string): string {
    return `Hi ${name || "there"}, this is your clinic scheduling line. An appointment slot just opened. Say YES to take it or NO to pass — the first person to confirm gets the slot.`;
  }

  // ── Outbound channels (demo: log; live: Call Control + Messaging) ───────

  /** Dial via Call Control; carries the slot in client_state for routing. */
  private async placeCall(candidate: Candidate, script: string): Promise<void> {
    if (await isDemoMode(this.env)) {
      console.log(`[demo] voice call to ${candidate.phone}: ${script}`);
      return;
    }
    const state = await this.getState();
    const apiKey = await this.apiKey();
    const connectionId = await readConfig(this.env, "OUTBOUND_CONNECTION_ID");
    const callerId = await readConfig(this.env, "OUTBOUND_CALLER_ID");
    if (!connectionId || !callerId) {
      throw new Error(
        "OUTBOUND_CONNECTION_ID and OUTBOUND_CALLER_ID are required for live calls",
      );
    }
    const resp = await fetch(`${TELNYX_API}/calls`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        connection_id: connectionId,
        to: candidate.phone,
        from: callerId,
        client_state: encodeSlotState(state.slotId),
      }),
    });
    if (!resp.ok) {
      throw new Error(`Call Control dial failed: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { data?: { call_control_id?: string } };
    const callControlId = data.data?.call_control_id ?? null;
    await this.setState({
      currentCandidate: {
        ...candidate,
        callControlId,
      },
    });
  }

  /** Speak the offer on a live call (no-op in demo mode). */
  private async speak(callControlId: string | null, script: string): Promise<void> {
    if (await isDemoMode(this.env)) {
      console.log(`[demo] speak: ${script}`);
      return;
    }
    if (!callControlId) return;
    const apiKey = await this.apiKey();
    const state = await this.getState();
    const resp = await fetch(
      `${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/speak`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          payload: script,
          language: "en-US",
          voice: "female",
          client_state: encodeSlotState(state.slotId),
        }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Call Control speak failed: HTTP ${resp.status}`);
    }
  }

  /**
   * Classify the patient's spoken reply with gather_using_ai. The parameters
   * schema constrains the model to one intent word; the result lands in
   * payload.result.intent on the call.ai_gather.ended webhook.
   */
  private async gatherUsingAi(callControlId: string | null, candidate: Candidate): Promise<void> {
    if (await isDemoMode(this.env)) {
      console.log(`[demo] gather_using_ai on call (awaiting reply from ${candidate.phone})`);
      return;
    }
    if (!callControlId) return;
    const apiKey = await this.apiKey();
    const state = await this.getState();
    const intents =
      candidate.role === "missed" ? ["reschedule", "later", "decline"] : ["confirm", "decline"];
    const model = (await readConfig(this.env, "AI_MODEL")) || "meta-llama/Llama-3.3-70B-Instruct";
    const instructions =
      candidate.role === "missed"
        ? "you are a one-turn speech classifier. the caller just heard an offer to reschedule a missed appointment. classify their reply as exactly one of: reschedule, later, decline. respond with only that word."
        : "you are a one-turn speech classifier. the caller just heard an offer to claim an open appointment slot. classify their reply as exactly one of: confirm, decline. respond with only that word.";
    const resp = await fetch(
      `${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/gather_using_ai`,
      {
        method: "POST",
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          parameters: {
            type: "object",
            properties: {
              intent: { type: "string", enum: intents },
              utterance: {
                type: "string",
                description: "the caller's spoken response, transcribed verbatim.",
              },
            },
            required: ["intent"],
          },
          assistant: { model, instructions },
          transcription: { language: "en" },
          user_response_timeout_ms: 15000,
          client_state: encodeSlotState(state.slotId),
        }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Call Control gather_using_ai failed: HTTP ${resp.status}`);
    }
  }

  private async hangup(callControlId: string | null): Promise<void> {
    if (await isDemoMode(this.env)) {
      console.log(`[demo] hangup call`);
      return;
    }
    if (!callControlId) return;
    const apiKey = await this.apiKey();
    const resp = await fetch(
      `${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/hangup`,
      { method: "POST", headers: authHeaders(apiKey) },
    );
    if (!resp.ok) {
      throw new Error(`Call Control hangup failed: HTTP ${resp.status}`);
    }
  }

  private async sendSms(to: string, text: string): Promise<void> {
    if (!to) throw new Error("missing destination number");
    if (await isDemoMode(this.env)) {
      console.log(`[demo] SMS to ${to}: ${text}`);
      return;
    }
    const from = await readConfig(this.env, "SCHEDULING_SMS_E164");
    if (!from) {
      throw new Error("SCHEDULING_SMS_E164 is not configured for live SMS");
    }
    await this.env.TELNYX.messages.send({ to, from, text });
  }

  private async apiKey(): Promise<string> {
    const key = await readConfig(this.env, "TELNYX_API_KEY");
    if (!key) throw new Error("TELNYX_API_KEY is not configured");
    return key;
  }

  private async replyWindowSeconds(): Promise<number> {
    const minutes = await readNumberConfig(
      this.env,
      "WAITLIST_REPLY_TIMEOUT_MIN",
      DEFAULTS.WAITLIST_REPLY_TIMEOUT_MIN,
    );
    return minutes * 60;
  }

  // ── Inbound routing index (shared actor; fallback for reply routing) ────

  private async registerIndex(patient: string, role: "missed" | "waitlist"): Promise<void> {
    const state = await this.getState();
    const index = this.env.SLOT_INDEX.idFromName("index");
    await index.register(patient, state.slotId, role);
  }

  private async clearIndex(): Promise<void> {
    const state = await this.getState();
    const index = this.env.SLOT_INDEX.idFromName("index");
    const patients = new Set<string>([state.missedPatient.phone]);
    for (const entry of state.waitlist) patients.add(entry.phone);
    for (const phone of patients) await index.clear(phone);
  }

  // ── Per-actor durable ledger (Agent SDK SQL) ────────────────────────────

  /** Per-actor durable schema — created on first use, survives eviction. */
  protected ensureTables(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS outreach_attempts (
         slot_id TEXT NOT NULL,
         patient TEXT NOT NULL,
         channel TEXT NOT NULL,
         status  TEXT NOT NULL,
         detail  TEXT NOT NULL DEFAULT '',
         ts      INTEGER NOT NULL
       )`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS confirmations (
         slot_id      TEXT PRIMARY KEY,
         patient      TEXT NOT NULL,
         confirmed_at INTEGER NOT NULL,
         source       TEXT NOT NULL
       )`,
    );
  }

  /** Append-only outreach ledger: every attempt, response, timeout, outcome. */
  protected recordAttempt(a: AttemptRecord): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO outreach_attempts (slot_id, patient, channel, status, detail, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
      a.slotId,
      a.patient,
      a.channel,
      a.status,
      a.detail,
      a.ts,
    );
  }

  /**
   * Durable confirmation lock. Returns false if a confirmation already
   * exists for this slot — that is the double-booking guard.
   */
  protected recordConfirmation(c: ConfirmationRecord): boolean {
    const existing = this.existingConfirmation(c.slotId);
    if (existing) return false;
    this.ctx.storage.sql.exec(
      `INSERT INTO confirmations (slot_id, patient, confirmed_at, source)
       VALUES (?, ?, ?, ?)`,
      c.slotId,
      c.patient,
      c.confirmedAt,
      c.source,
    );
    return true;
  }

  protected existingConfirmation(slotId: string): ConfirmationRecord | null {
    const row = this.ctx.storage.sql
      .exec<{ slot_id: string; patient: string; confirmed_at: number; source: string }>(
        "SELECT slot_id, patient, confirmed_at, source FROM confirmations WHERE slot_id = ?",
        slotId,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      slotId: row.slot_id,
      patient: row.patient,
      confirmedAt: row.confirmed_at,
      source: row.source as Channel,
    };
  }

  protected attemptsFor(slotId: string): AttemptRecord[] {
    return this.ctx.storage.sql
      .exec<{ slot_id: string; patient: string; channel: string; status: string; detail: string; ts: number }>(
        "SELECT slot_id, patient, channel, status, detail, ts FROM outreach_attempts WHERE slot_id = ? ORDER BY ts",
        slotId,
      )
      .toArray()
      .map((r) => ({
        slotId: r.slot_id,
        patient: r.patient,
        channel: r.channel as Channel,
        status: r.status as AttemptStatus,
        detail: r.detail,
        ts: r.ts,
      }));
  }
}

// ── Shared routing index actor ────────────────────────────────────────────

export interface IndexState extends Record<string, unknown> {
  /** patient E.164 -> active outreach target (slotId + role). */
  map: Record<string, { slotId: string; role: string }>;
}

/**
 * One shared actor instance that maps inbound patient phone numbers to the
 * slot actor currently reaching out to them — the fallback router for SMS
 * replies and call events that arrive without a slot reference.
 */
export class SlotIndex extends Agent<Env, IndexState> {
  protected initialState(): IndexState {
    return { map: {} };
  }

  @rpc({ description: "Register a patient's active outreach target for reply routing" })
  async register(patient: string, slotId: string, role: string): Promise<{ ok: boolean }> {
    const state = await this.getState();
    await this.setState({
      map: { ...state.map, [patient]: { slotId, role } },
    });
    return { ok: true };
  }

  @rpc({ description: "Clear a patient's routing entry after the slot resolves" })
  async clear(patient: string): Promise<{ ok: boolean }> {
    const state = await this.getState();
    if (!(patient in state.map)) return { ok: true };
    const next = { ...state.map };
    delete next[patient];
    await this.setState({ map: next });
    return { ok: true };
  }

  @rpc({ description: "Look up which slot actor is currently reaching out to a patient" })
  async lookup(patient: string): Promise<{ slotId: string; role: string } | null> {
    const state = await this.getState();
    return state.map[patient] ?? null;
  }
}

// ── HTTP front door ───────────────────────────────────────────────────────

const E164_RE = /^\+[1-9]\d{7,14}$/;
const DECISION_YES = /^(yes|confirm|take it|1|y)\b/i;
const DECISION_NO = /^(no|pass|can'?t|cannot|decline|2|n)\b/i;
const DECISION_RESCHEDULE = /^(reschedule|rebook|new time|yes)\b/i;
const DECISION_LATER = /^(later|call me (later|back)|callback|busy)\b/i;

/** Sanitize a slot id for use as an actor name (RFC 1123 safe). */
export function actorNameFromSlot(slotId: string): string {
  return slotId.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
}

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone);
}

export function encodeSlotState(slotId: string): string {
  return btoa(JSON.stringify({ slotId }));
}

export function decodeSlotState(raw: string): string | null {
  try {
    const parsed = JSON.parse(atob(raw)) as { slotId?: string };
    return parsed.slotId ?? null;
  } catch {
    return null;
  }
}

/**
 * Role-aware reply parsing. Explicit keywords win; bare yes/no falls back to
 * the script each role was offered (missed patient: yes = reschedule;
 * waitlist: yes = confirm).
 */
export function parseDecision(role: "missed" | "waitlist", text: string): ReplyDecision | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  if (role === "missed") {
    if (DECISION_RESCHEDULE.test(t)) return "reschedule";
    if (DECISION_LATER.test(t)) return "later";
    if (DECISION_NO.test(t)) return "decline";
    return null;
  }
  if (DECISION_YES.test(t)) return "confirm";
  if (DECISION_NO.test(t)) return "decline";
  return null;
}

/** Sort the waitlist by priority (1 first), stable for equal priorities. */
export function sortWaitlist(entries: WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : Number.MAX_SAFE_INTEGER;
    const pb = Number.isFinite(b.priority) ? b.priority : Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

interface TelnyxWebhookBody {
  data?: {
    event_type?: string;
    payload?: Record<string, unknown>;
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", agent: "AppointmentSlot" });
    }

    if (req.method === "GET" && url.pathname.startsWith("/state/")) {
      const slotId = decodeURIComponent(url.pathname.slice("/state/".length));
      if (!slotId) return json({ error: "slotId required" }, 400);
      const stub = env.SLOTS.idFromName(actorNameFromSlot(slotId));
      const result = await stub.inspect();
      return json(result);
    }

    if (req.method === "GET" && url.pathname.startsWith("/ledger/")) {
      const slotId = decodeURIComponent(url.pathname.slice("/ledger/".length));
      if (!slotId) return json({ error: "slotId required" }, 400);
      const stub = env.SLOTS.idFromName(actorNameFromSlot(slotId));
      const result = await stub.ledgerSnapshot();
      return json(result);
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    // ── Mock scheduling webhook -> openSlot RPC (the actor is born here) ──
    if (url.pathname === "/webhook/scheduling") {
      const jsonBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const payload = jsonBody as unknown as OpenSlotPayload;
      if (
        !payload?.slotId ||
        !payload?.provider ||
        !payload?.startsAt ||
        !payload?.missedPatient
      ) {
        return json(
          { error: "slotId, provider, startsAt and missedPatient are required" },
          400,
        );
      }
      try {
        const stub = env.SLOTS.idFromName(actorNameFromSlot(payload.slotId));
        const result = await stub.openSlot(payload);
        return json(result);
      } catch (e) {
        console.error("openSlot failed:", e instanceof Error ? e.message : e);
        return json({ error: "failed to open slot" }, 500);
      }
    }

    // ── Telnyx inbound-message callback (message.received) ────────────────
    if (url.pathname === "/webhook/inbound-message") {
      const data = (await verifyWebhook(req, env))?.data;
      if (!data || data.event_type !== "message.received") {
        return json({ error: "unexpected event_type" }, 400);
      }
      const payload = data.payload ?? {};
      const from = String(
        (payload.from as { phone_number?: string })?.phone_number ??
          payload.from ??
          "",
      );
      const text = String(payload.text ?? "");
      if (!E164_RE.test(from)) {
        return json({ error: "missing or invalid from number" }, 400);
      }
      try {
        return await routeReply(env, from, text);
      } catch (e) {
        console.error("inbound message failed:", e instanceof Error ? e.message : e);
        return json({ error: "failed to process inbound message" }, 500);
      }
    }

    // ── Telnyx Call Control event webhook ─────────────────────────────────
    if (url.pathname === "/webhook/call-events") {
      const data = (await verifyWebhook(req, env))?.data;
      if (!data?.event_type) return json({ error: "unexpected body" }, 400);
      const payload = data.payload ?? {};
      const callControlId = String(payload.call_control_id ?? "");
      let slotId = clientStateSlotId(payload.client_state);
      if (!slotId) {
        const to = String(
          (payload.to as { phone_number?: string })?.phone_number ?? payload.to ?? "",
        );
        if (to) {
          const index = env.SLOT_INDEX.idFromName("index");
          const hit = await index.lookup(to);
          if (hit) slotId = hit.slotId;
        }
      }
      if (!slotId) {
        return json({ error: "cannot route call event to a slot" }, 400);
      }
      try {
        const stub = env.SLOTS.idFromName(actorNameFromSlot(slotId));
        const result = await stub.onCallEvent({
          eventType: data.event_type,
          callControlId,
          intent: typeof payload.intent === "string" ? payload.intent : undefined,
          result:
            payload.result && typeof payload.result === "object"
              ? (payload.result as Record<string, unknown>)
              : undefined,
          to: typeof payload.to === "string" ? payload.to : undefined,
        });
        return json(result);
      } catch (e) {
        console.error("call event failed:", e instanceof Error ? e.message : e);
        return json({ error: "failed to process call event" }, 500);
      }
    }

    // ── Demo driver: simulate a patient's SMS reply (DEMO_MODE only) ──────
    if (url.pathname === "/demo/reply") {
      if (!(await isDemoMode(env))) {
        return json({ error: "demo endpoints are disabled in live mode" }, 403);
      }
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const from = String(body.from ?? "");
      const text = String(body.text ?? "");
      const slotId = body.slotId ? String(body.slotId) : null;
      if (!E164_RE.test(from) || !text.trim()) {
        return json({ error: "from (E.164) and text are required" }, 400);
      }
      try {
        return await routeReply(env, from, text, slotId);
      } catch (e) {
        console.error("demo reply failed:", e instanceof Error ? e.message : e);
        return json({ error: "failed to process demo reply" }, 500);
      }
    }

    // ── Demo driver: simulate a call event (DEMO_MODE only) ───────────────
    if (url.pathname === "/demo/call-event") {
      if (!(await isDemoMode(env))) {
        return json({ error: "demo endpoints are disabled in live mode" }, 403);
      }
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const slotId = String(body.slotId ?? "");
      const eventType = String(body.eventType ?? "");
      if (!slotId || !eventType) {
        return json({ error: "slotId and eventType are required" }, 400);
      }
      try {
        const stub = env.SLOTS.idFromName(actorNameFromSlot(slotId));
        const result = await stub.onCallEvent({
          eventType,
          callControlId: String(body.callControlId ?? ""),
          intent: typeof body.intent === "string" ? body.intent : undefined,
          to: typeof body.to === "string" ? body.to : undefined,
        });
        return json(result);
      } catch (e) {
        console.error("demo call event failed:", e instanceof Error ? e.message : e);
        return json({ error: "failed to process demo call event" }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};

// ── Routing: inbound reply -> slot actor ──────────────────────────────────

async function routeReply(
  env: Env,
  from: string,
  text: string,
  explicitSlotId?: string | null,
): Promise<Response> {
  let slotId = explicitSlotId ?? parseSlotRefFromText(text);
  if (!slotId) {
    const index = env.SLOT_INDEX.idFromName("index");
    const hit = await index.lookup(from);
    if (hit) slotId = hit.slotId;
  }
  if (!slotId) {
    return json({
      ok: true,
      reply: "Thanks for your message! Reply with the slot reference in your last text, or call our front desk.",
    });
  }
  const stub = env.SLOTS.idFromName(actorNameFromSlot(slotId));
  const result = await stub.onInboundMessage({ from, text });
  return json(result);
}

/** Slot reference embedded in outreach texts, e.g. "Reply YES <aWQ9..." — optional convenience. */
function parseSlotRefFromText(text: string): string | null {
  const m = /\bslot[- ]?([A-Za-z0-9][A-Za-z0-9._-]{2,40})\b/i.exec(text);
  return m ? m[1] : null;
}

function clientStateSlotId(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return decodeSlotState(raw);
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Verify the Telnyx Ed25519 signature on an inbound webhook and return the
 * parsed event. Demo mode skips verification (payloads come from /demo/*).
 * The signature covers the exact bytes Telnyx sent — read the raw body with
 * `await req.text()`, never `req.json()` before verify.
 */
async function verifyWebhook(req: Request, env: Env): Promise<TelnyxWebhookBody> {
  const body = await req.text();
  if (await isDemoMode(env)) {
    return JSON.parse(body) as TelnyxWebhookBody;
  }
  const publicKey = await readConfig(env, "TELNYX_PUBLIC_KEY");
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
  })) as TelnyxWebhookBody;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
