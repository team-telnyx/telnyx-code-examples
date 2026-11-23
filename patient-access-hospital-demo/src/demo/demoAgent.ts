import { Agent, rpc, type Env } from "@telnyx/edge-runtime";
import type { Call, CallEvent, DemoSettings, DemoState, Patient, SmsMessage } from "@/domain/types";
import { intakeSeed, SLOT_SEED, MockClinicStore } from "@/domain/scheduling";
import { defaultSettings, validateSettings } from "@/domain/settings";
import { findBookedSlot, generateIntakeSlots } from "@/domain/slots";
import { buildSmsConfirmation } from "@/domain/sms";
import { brandName } from "@/domain/brand";
import { parseMode, parseLiveEnvVars, resolveDemoMode } from "@/server/env";
import { MockCallDriver } from "@/call/mock";
import { appendCallEvent, rescueLiveCallId } from "@/call/driver";
import { buildAssistantConfig, TelnyxCallDriver, type AssistantConfig } from "@/call/telnyx";
import { buildTransferToolConfig } from "@/domain/transfer";
import { buildRescheduleToolConfig, slotMatchesToolInput } from "@/domain/voiceTools";
import { DemoDriver } from "@/demo/demoDriver";
import type { StateStore } from "@/demo/state";

// The demo's stateful actor: owns DemoState, the mock clinic, and the
// scripted demo driver. The book-first flow lives here: intake books a visit
// with the patient's number on file; startMissedCallback misses the visit and
// auto-calls the patient. All UI/API routes talk to this actor.

export class DemoAgent extends Agent<Env, DemoState> {
  private clinic: MockClinicStore = new MockClinicStore(intakeSeed());
  private demoDriver: DemoDriver | null = null;
  private liveConnectionId: string | null = null;
  private liveApiKey: string | null = null;
  private finalizedCallIds: Set<string> = new Set();

  private buildDemoState(settings: DemoSettings, now = new Date()): DemoState {
    const seed = intakeSeed();
    return {
      mode: parseMode(),
      patient: seed.patient,
      appointments: [],
      availableSlots: generateIntakeSlots(now, settings, SLOT_SEED),
      calls: [],
      sms: [],
      escalations: [],
      settings,
      phase: "idle",
      updatedAtIso: now.toISOString(),
    };
  }

  protected override initialState(): DemoState {
    const settings =
      parseMode() === "live"
        ? liveSettings()
        : { ...defaultSettings };
    return this.buildDemoState(settings);
  }

  private writeQueue: Promise<void> = Promise.resolve();

  private write(fn: (s: DemoState) => DemoState): Promise<DemoState> {
    const task = this.writeQueue.then(async () => {
      const next = fn(await this.getState());
      return this.replaceState(next);
    });
    this.writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private asStore(): StateStore {
    return {
      get: () => Promise.resolve(this.getState()),
      update: (fn) => this.write(fn),
      reset: async () => this.write(() => this.initialState()),
    };
  }

  private async rehydrateClinic(): Promise<void> {
    this.clinic.adoptFromState(await this.getState());
  }

  private async ensureDriver(): Promise<DemoDriver> {
    const mode = (await this.getState()).mode;
    const liveConnectionId = mode === "live" ? (await parseLiveEnvVars(this.env.SECRETS)).TELNYX_CONNECTION_ID : null;
    if (!this.demoDriver || (mode === "live" && this.liveConnectionId !== liveConnectionId)) {
      await this.rehydrateClinic();
      if (mode === "live" && this.liveConnectionId !== liveConnectionId) this.liveApiKey = null;
      const driver =
        mode === "live"
          ? new TelnyxCallDriver({
              connectionId: liveConnectionId ?? "",
              apiKey: await this.apiKey(),
              assistantConfig: () => this.liveAssistantConfig(),
            })
          : new MockCallDriver();
      this.demoDriver = new DemoDriver({ driver, clinic: this.clinic, state: this.asStore() });
      this.liveConnectionId = liveConnectionId;
    }
    return this.demoDriver;
  }

  private async apiKey(): Promise<string> {
    if (!this.liveApiKey) {
      this.liveApiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    }
    return this.liveApiKey;
  }

  private async liveAssistantConfig(): Promise<AssistantConfig> {
    const live = await parseLiveEnvVars(this.env.SECRETS);
    const state = await this.getState();
    const patient = this.clinic.getPatient();
    const missed = this.clinic.listAppointments().find((a) => a.status === "missed");
    const summary = missed
      ? `Missed appointment ${missed.scheduledForIso.slice(0, 16).replace("T", " ")}`
      : "Missed appointment (details unknown)";
    const staffPhone = live.STAFF_PHONE;
    const transferTool = buildTransferToolConfig({
      staffNumber: staffPhone,
      fromNumber: live.FROM_NUMBER,
      instructions:
        `Warm transfer to ${brandName()} staff. Patient: ${patient.fullName} (MRN ${patient.mrn}). ` +
        `${summary}. Ask the staff member to confirm pickup before connecting. ` +
        "Never give medical advice; escalate medical questions via this transfer.",
    });
    const slotOptions = this.clinic.listRebookSlots(new Date(), state.settings);
    await this.write((prev) => ({ ...prev, availableSlots: slotOptions, updatedAtIso: new Date().toISOString() }));
    const rescheduleTool = buildRescheduleToolConfig(`${live.PUBLIC_BASE_URL}/api/voice/reschedule`);
    return buildAssistantConfig({
      assistantId: live.TELNYX_ASSISTANT_ID,
      patientName: patient.fullName,
      patientDobIso: patient.dobIso,
      missedAppointmentSummary: summary,
      slotOptions,
      transferTool,
      rescheduleTool,
    });
  }

  @rpc({ description: "Reschedule the current patient appointment after explicit confirmation" })
  async rescheduleAppointment(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const state = await this.getState();
    if (state.mode !== "live") return { success: false, error: "live mode is required" };
    const patientName = typeof input.patient_name === "string" ? input.patient_name.trim() : "";
    const dateOfBirth = typeof input.date_of_birth === "string" ? input.date_of_birth.trim() : "";
    const newTime = typeof input.new_time === "string" ? input.new_time.trim() : "";
    const slotId = typeof input.slot_id === "string" ? input.slot_id.trim() : undefined;
    if (patientName !== state.patient.fullName || dateOfBirth !== state.patient.dobIso) {
      return { success: false, error: "patient identity could not be verified" };
    }
    const missed = state.appointments.find((appointment) => appointment.status === "missed");
    if (!missed) return { success: false, error: "no missed appointment is available to reschedule" };
    await this.rehydrateClinic();
    const slots = this.clinic.listRebookSlots(new Date(), state.settings);
    const selected = slotMatchesToolInput({ slotId, newTime }, slots, (text, candidates) =>
      findBookedSlot([text], candidates, new Date()),
    );
    if (!selected) return { success: false, error: "the requested time is not one of the currently offered slots" };

    const existing = state.appointments.find((appointment) => appointment.slotId === selected.id && appointment.status === "booked");
    if (existing) {
      return { success: true, already_completed: true, appointment_id: existing.id, message: "appointment already updated" };
    }
    const result = this.clinic.bookSlot(selected.id);
    if ("error" in result) return { success: false, error: "the selected slot is no longer available" };
    const appointment = result.appointment;
    const sms = buildSmsConfirmation({
      patient: this.clinic.getPatient(),
      appointment,
      fromE164: state.settings.fromNumberE164 ?? (await parseLiveEnvVars(this.env.SECRETS)).FROM_NUMBER,
      messageType: "rescheduled",
    });
    const sent = await this.sendSmsApi(sms);
    await this.write((prev) => ({
      ...prev,
      appointments: this.clinic.listAppointments(),
      availableSlots: prev.availableSlots.filter((slot) => slot.id !== selected.id),
      sms: [...prev.sms, { ...sms, status: sent ? "sent" : "failed" }],
      updatedAtIso: new Date().toISOString(),
    }));
    return {
      success: sent,
      appointment_id: appointment.id,
      appointment_time: appointment.scheduledForIso,
      confirmation_sms_sent: sent,
      message: sent ? "appointment updated and confirmation SMS sent" : "appointment updated but confirmation SMS failed",
    };
  }

  private async resetState(): Promise<DemoState> {
    const live = (await resolveDemoMode(this.env.SECRETS)) === "live";
    const liveEnv = live ? await parseLiveEnvVars(this.env.SECRETS) : null;
    const next = await this.write((prev) => {
      const rebuilt = this.buildDemoState(prev.settings, new Date());
      if (liveEnv) {
        rebuilt.mode = "live";
        rebuilt.settings = {
          callingHours: prev.settings.callingHours,
          staffPhoneE164: liveEnv.STAFF_PHONE,
          fromNumberE164: liveEnv.FROM_NUMBER,
          targetPhoneE164: liveEnv.DEMO_TARGET_PHONE || undefined,
        };
      }
      return rebuilt;
    });
    this.clinic.adoptFromState(next);
    return next;
  }

  @rpc({ description: "Full demo state snapshot for UI polling" })
  async snapshot(): Promise<DemoState> {
    return this.getState();
  }

  @rpc({ description: "Start (or restart) the scripted call; requires a visit on file" })
  async startDemo(opts: { reset?: boolean; paceMs?: number } = {}): Promise<
    { ok: true; state: DemoState } | { ok: false; error: string }
  > {
    const driver = await this.ensureDriver();
    if (driver.isRunning()) return { ok: false, error: "demo already running — Reset first" };
    if (this.clinic.listAppointments().length === 0) {
      return { ok: false, error: "Book an appointment first — use the intake card." };
    }
    driver.start({ paceMs: opts.paceMs ?? defaultPaceMs() });
    return { ok: true, state: await this.getState() };
  }

  @rpc({ description: "Book-first intake: patient + appointment on file, phone saved" })
  async intakePatient(input: { fullName?: string; phoneE164?: string; dobIso?: string; slotId?: string }): Promise<
    { ok: true; state: DemoState } | { ok: false; error: string }
  > {
    const driver = await this.ensureDriver();
    if (driver.isRunning()) return { ok: false, error: "Demo in progress — Reset first." };
    const fullName = (input.fullName ?? "").trim();
    const phoneE164 = (input.phoneE164 ?? "").trim();
    const dobIso = (input.dobIso ?? "").trim();
    if (fullName.length < 2 || fullName.length > 80) {
      return { ok: false, error: "Enter the patient's full name (2-80 characters)." };
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
      return { ok: false, error: "Enter a valid phone number in E.164 format, e.g. +15555550123." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso) || Number.isNaN(Date.parse(`${dobIso}T00:00:00Z`)) || new Date(`${dobIso}T00:00:00Z`) > new Date()) {
      return { ok: false, error: "Enter a valid date of birth that is not in the future." };
    }
    const slotId = (input.slotId ?? "").trim();
    const current = await this.getState();
    const slot = current.availableSlots.find((s) => s.id === slotId);
    if (!slot) return { ok: false, error: "Pick one of the available times first." };
    const patient: Patient = {
      id: "patient-self",
      fullName,
      mrn: `MRN-0${Math.floor(10000 + Math.random() * 89999)}`,
      dobIso,
      phoneE164,
    };
    const result = this.clinic.intake(patient, slot);
    if ("error" in result) return { ok: false, error: result.error };
    const mode = await resolveDemoMode(this.env.SECRETS);
    const fromE164 = mode === "live"
      ? (await parseLiveEnvVars(this.env.SECRETS)).FROM_NUMBER
      : (await this.getState()).settings.fromNumberE164;
    const sms = buildSmsConfirmation({
      patient,
      appointment: result.appointment,
      fromE164: fromE164 || "+15555550100",
      messageType: "booked",
    });
    const smsDelivered = mode === "mock" || await this.sendSmsApi(sms);
    const finalSms: SmsMessage = { ...sms, status: mode === "mock" ? "delivered" : smsDelivered ? "sent" : "failed" };
    const state = await this.write((prev) => ({
      ...prev,
      patient: this.clinic.getPatient(),
      appointments: this.clinic.listAppointments(),
      availableSlots: prev.availableSlots.filter((s) => s.id !== slotId),
      settings: { ...prev.settings, targetPhoneE164: phoneE164 },
      sms: [...prev.sms, finalSms],
      updatedAtIso: new Date().toISOString(),
    }));
    return { ok: true, state };
  }

  @rpc({ description: "Mark the visit missed and auto-start the AI call to the patient" })
  async startMissedCallback(opts: { paceMs?: number } = {}): Promise<
    { ok: true; state: DemoState } | { ok: false; error: string }
  > {
    const driver = await this.ensureDriver();
    if (driver.isRunning()) return { ok: false, error: "Demo in progress — Reset first." };
    if (this.clinic.listAppointments().length === 0) {
      return { ok: false, error: "Book an appointment first — use the intake card." };
    }
    this.clinic.markMissed();
    await this.replaceState({
      ...(await this.getState()),
      appointments: this.clinic.listAppointments(),
      updatedAtIso: new Date().toISOString(),
    });
    driver.start({ paceMs: opts.paceMs ?? defaultPaceMs() });
    return { ok: true, state: await this.getState() };
  }

  @rpc({ description: "Stop if running and return to a clean idle state" })
  async reset(): Promise<DemoState> {
    const driver = await this.ensureDriver();
    if (driver.isRunning()) {
      driver.stop();
      await driver.waitStopped();
    }
    return this.resetState();
  }

  @rpc({ description: "Stop a running scripted demo" })
  async stopDemo(): Promise<DemoState> {
    const driver = await this.ensureDriver();
    driver.stop();
    return this.getState();
  }

  @rpc({ description: "Validate and apply settings; regenerates slots" })
  async updateSettings(partial: unknown): Promise<
    { ok: true; state: DemoState } | { ok: false; errors: string[] }
  > {
    if (typeof partial !== "object" || partial === null) {
      return { ok: false, errors: ["expected a JSON object"] };
    }
    const current = (await this.getState()).settings;
    const result = validateSettings({ ...current, ...(partial as Record<string, unknown>) });
    if (!result.ok) return { ok: false, errors: result.errors };
    const state = await this.write((prev) => ({
      ...prev,
      settings: result.settings,
      availableSlots:
        prev.appointments.length === 0
          ? generateIntakeSlots(new Date(), result.settings, SLOT_SEED)
          : this.clinic.regenerateSlots(new Date(), result.settings),
      updatedAtIso: new Date().toISOString(),
    }));
    return { ok: true, state };
  }

  @rpc({ description: "Append a live-mode Telnyx webhook event to the call" })
  async applyCallEvent(event: CallEvent): Promise<void> {
    const rescued = rescueLiveCallId(await this.getState(), event);
    const effective = rescued ? { ...event, callId: rescued } : event;
    await appendCallEvent(this.asStore(), effective);
    if (effective.kind !== "call.ended") return;
    if ((await this.getState()).mode !== "live") return;
    await this.write((prev) =>
      prev.phase === "calling" ? { ...prev, phase: "done", updatedAtIso: new Date().toISOString() } : prev,
    );
    await this.finalizeLiveCall();
  }

  private async finalizeLiveCall(): Promise<void> {
    const call = [...(await this.getState()).calls].reverse().find((c) => c.status === "ended");
    if (!call || this.finalizedCallIds.has(call.id)) return;
    await this.rehydrateClinic();
    const state = await this.getState();
    this.clinic.listRebookSlots(new Date(), state.settings);
    const utterancesOf = (events: CallEvent[]): string[] =>
      events
        .filter((e) => (e.kind === "transcript.agent" || e.kind === "transcript.patient") && typeof e.text === "string" && e.text.length > 0)
        .map((e) => e.text ?? "");
    let utterances = utterancesOf(call.events);
    let booked = findBookedSlot(utterances, state.availableSlots, new Date());
    if (!booked) {
      const backfilled = await this.backfillConversationTranscript(call);
      if (backfilled) {
        const refreshed = (await this.getState()).calls.find((c) => c.id === call.id);
        utterances = utterancesOf(refreshed?.events ?? []);
        booked = findBookedSlot(utterances, state.availableSlots, new Date());
      }
    }
    if (!booked) {
      console.warn("[demo] live call wrapped without a matchable slot choice");
      return;
    }
    const result = this.clinic.bookSlot(booked.id);
    if ("error" in result) {
      console.warn(`[demo] live booking failed: ${result.error}`);
      return;
    }
    const appointment = result.appointment;
    const sms = buildSmsConfirmation({
      patient: this.clinic.getPatient(),
      appointment,
      fromE164: state.settings.fromNumberE164 ?? (await parseLiveEnvVars(this.env.SECRETS)).FROM_NUMBER,
      messageType: "rescheduled",
    });
    const pushed = await this.sendSmsApi(sms);
    const finalSms: SmsMessage = { ...sms, status: pushed ? "sent" : "failed" };
    await this.write((prev) => ({
      ...prev,
      appointments: this.clinic.listAppointments(),
      availableSlots: prev.availableSlots.filter((s) => s.id !== booked.id),
      sms: [...prev.sms, finalSms],
      updatedAtIso: new Date().toISOString(),
    }));
    this.finalizedCallIds.add(call.id);
  }

  /**
   * Fills the call record with the assistant conversation transcript after the
   * call ends, via the conversations API. Returns true when utterances were
   * appended. This is what powers the wrap-time slot match when live
   * transcription frames never reach the webhook.
   */
  private noteDiagnostic(line: string): void {
    void this.write((prev) => ({
      ...prev,
      diagnostics: [...(prev.diagnostics ?? []).slice(-7), `[diag] ${line}`],
      updatedAtIso: new Date().toISOString(),
    }));
  }

  private async backfillConversationTranscript(call: Call): Promise<boolean> {
    try {
      this.noteDiagnostic("backfill: listing conversations via the TELNYX binding");
      const convs = await this.env.TELNYX.ai.conversations.list({ limit: 10 });
      const conv = (convs.data ?? []).find((c: { metadata?: Record<string, string> }) => c.metadata?.call_control_id === call.id);
      if (!conv) {
        this.noteDiagnostic("backfill: no conversation matches the call id");
        return false;
      }
      const msgs = await this.env.TELNYX.ai.conversations.messages.list(conv.id);
      const items = (msgs.data ?? []) as Array<{ role: string; text: string; sent_at?: string }>;
      this.noteDiagnostic(`backfill: conversation has ${items.length} messages`);
      const events: CallEvent[] = items
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.length > 0)
        .map((m, i) => ({
          id: `evt-${crypto.randomUUID()}`,
          callId: call.id,
          atIso: m.sent_at ?? new Date(Date.now() + i).toISOString(),
          kind: m.role === "assistant" ? ("transcript.agent" as const) : ("transcript.patient" as const),
          speaker: m.role === "assistant" ? ("agent" as const) : ("patient" as const),
          text: m.text,
          data: { event_type: "conversation.messages.backfill" },
        }));
      if (events.length === 0) return false;
      for (const e of events) await appendCallEvent(this.asStore(), e);
      this.noteDiagnostic(`backfill: appended ${events.length} transcript utterances`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.noteDiagnostic(`backfill failed: ${message.slice(0, 200)}`);
      return false;
    }
  }

  private async sendSmsApi(sms: SmsMessage): Promise<boolean> {
    try {
      const res = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: sms.toE164, from: sms.fromE164, text: sms.body }),
      });
      if (!res.ok) {
        console.warn(`[demo] Telnyx SMS send failed: HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[demo] Telnyx SMS send error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

function liveSettings(): DemoSettings {
  const envOr = (key: string): string => (process.env[key] ?? "").trim();
  return {
    callingHours: { ...defaultSettings.callingHours },
    staffPhoneE164: defaultSettings.staffPhoneE164,
    fromNumberE164: envOr("FROM_NUMBER") || undefined,
    targetPhoneE164: envOr("DEMO_TARGET_PHONE") || undefined,
  };
}

/** Per-beat pacing from DEMO_PACE_MS (telnyx.toml env_vars), default 9000. */
function defaultPaceMs(): number {
  const raw = Number.parseInt(process.env.DEMO_PACE_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 9000;
}
