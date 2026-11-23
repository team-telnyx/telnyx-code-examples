import type { CallDriver } from "@/call/driver";
import { appendCallEvent } from "@/call/driver";
import type { Appointment, CallEvent, CallEventKind, DemoPhase, Escalation, Slot, SmsStatus } from "@/domain/types";
import type { ClinicStore } from "@/domain/scheduling";
import type { StateStore } from "@/demo/state";
import { brandName } from "@/domain/brand";
import { buildEscalation } from "@/domain/escalation";
import { buildSmsConfirmation } from "@/domain/sms";
import { buildTransferToolConfig } from "@/domain/transfer";
import { formatTime12, relativeDayLabel, slotOfferLabel, slotSpeakLabel, slotTimeLabel } from "@/domain/slots";

// Scripted demo orchestrator: drives the reschedule story against any CallDriver
// (mock simulates the transport; Telnyx places a real call).

const MOCK_FROM_NUMBER = "+15555550100";
const PATIENT_QUESTION = "Quick question — can I take my medication before the appointment?";
const AGENT_POLICY_LINE =
  "That's an important question for your care team. I'm not able to give medical advice, but let me connect you with our nurse line right now.";
const AGENT_HANDOFF_LINE =
  "Connecting you now. I've shared your name, your new appointment time, and your question with our nurse.";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = (): string => new Date().toISOString();

class DemoStopped extends Error {}

export class DemoDriver {
  private readonly driver: CallDriver;
  private readonly clinic: ClinicStore;
  private readonly state: StateStore;
  private running = false;
  private stopped = false;
  private callId: string | null = null;
  private stopResolve: (() => void) | null = null;
  private stopSignal: Promise<void> = Promise.resolve();
  private emit: (e: CallEvent) => void | Promise<void> = () => undefined;

  constructor(deps: { driver: CallDriver; clinic: ClinicStore; state: StateStore }) {
    this.driver = deps.driver;
    this.clinic = deps.clinic;
    this.state = deps.state;
  }

  /** Fire-and-forget start; the route handles 409 via isRunning(). */
  start(opts: { paceMs?: number } = {}): void {
    void this.run(opts).catch(() => {
      void this.state.update((s) => ({ ...s, phase: "stopped", updatedAtIso: nowIso() }));
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.callId) void this.driver.cancel(this.callId).catch(() => undefined);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Full scripted run; resolves when the script finishes or is stopped. */
  async run(opts: { paceMs?: number } = {}): Promise<void> {
    if (this.running) throw new Error("demo is already running");
    const paceMs = Math.max(1, opts.paceMs ?? 9000);
    this.running = true;
    this.stopped = false;
    this.stopSignal = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
    this.emit = (e) => appendCallEvent(this.state, e);
    try {
      if ((await this.state.get()).mode === "live") await this.runLive(paceMs);
      else await this.runScripted(paceMs);
    } catch (error) {
      if (!(error instanceof DemoStopped)) {
        await this.state.update((s) => ({
          ...s,
          phase: "stopped",
          diagnostics: [...(s.diagnostics ?? []).slice(-7), `[error] ${error instanceof Error ? error.message : String(error)}`],
          updatedAtIso: nowIso(),
        }));
        return;
      }
      await this.finishStopped();
    } finally {
      this.running = false;
      const resolve = this.stopResolve;
      this.stopResolve = null;
      if (resolve) resolve();
    }
  }

  /** Resolves once the current run loop has fully exited (no-op when idle). */
  async waitStopped(): Promise<void> {
    if (!this.running) return;
    await this.stopSignal;
  }

  private async setPhase(phase: DemoPhase): Promise<void> {
    await this.state.update((s) => ({ ...s, phase, updatedAtIso: nowIso() }));
  }

  private async script(kind: CallEventKind, extra: Partial<Pick<CallEvent, "speaker" | "text" | "data">> = {}): Promise<void> {
    if (!this.callId) throw new Error("script event before the call started");
    await this.emit({ id: `evt-${crypto.randomUUID()}`, callId: this.callId, atIso: nowIso(), kind, ...extra });
  }

  private async say(speaker: "agent" | "patient", text: string): Promise<void> {
    await this.script(speaker === "agent" ? "transcript.agent" : "transcript.patient", { speaker, text });
  }

  private async syncAppointments(): Promise<void> {
    await this.state.update((s) => ({ ...s, appointments: this.clinic.listAppointments(), updatedAtIso: nowIso() }));
  }

  private async syncSlots(): Promise<Slot[]> {
    const slots = this.clinic.listRebookSlots(new Date(), (await this.state.get()).settings);
    await this.state.update((s) => ({ ...s, availableSlots: slots, updatedAtIso: nowIso() }));
    return slots;
  }

  private async connectEscalations(): Promise<void> {
    await this.state.update((s) => ({
      ...s,
      escalations: s.escalations.map((e) => ({ ...e, status: "connected" })),
      updatedAtIso: nowIso(),
    }));
  }

  private async callParticipants(): Promise<{ to: string; from: string }> {
    const settings = (await this.state.get()).settings;
    const patient = this.clinic.getPatient();
    return { to: settings.targetPhoneE164 ?? patient.phoneE164, from: settings.fromNumberE164 ?? MOCK_FROM_NUMBER };
  }

  private async finishStopped(): Promise<void> {
    const callId = this.callId;
    await this.state.update((s) => ({
      ...s,
      phase: "stopped",
      calls: callId
        ? s.calls.map((c) => (c.id === callId ? { ...c, status: "cancelled", endedAtIso: nowIso() } : c))
        : s.calls,
      updatedAtIso: nowIso(),
    }));
  }

  /** Live mode: place the real call, then wait for webhook-driven terminal state. */
  private async runLive(paceMs: number): Promise<void> {
    await this.setPhase("preparing");
    if (this.clinic.listAppointments()[0]) this.clinic.markMissed();
    await this.syncAppointments();
    const slots = await this.syncSlots();
    this.callId = (await this.driver.start(await this.callParticipants(), this.emit)).callId;
    await this.setPhase("calling");
    await this.script("slots.offered", { data: { slots } });
    const deadline = Date.now() + 15 * 60_000;
    let ended = false;
    while (Date.now() < deadline && !this.stopped) {
      const state = await this.state.get();
      const call = state.calls.find((c) => c.id === this.callId);
      if (call && (call.status === "ended" || call.status === "failed")) {
        ended = true;
        break;
      }
      await sleep(Math.max(1000, paceMs));
    }
    if (this.stopped) throw new DemoStopped();
    if (ended) await this.setPhase("done");
  }

  private async runScripted(paceMs: number): Promise<void> {
    const patient = this.clinic.getPatient();
    const { to, from } = await this.callParticipants();
    const advanceSms = async (smsId: string, status: SmsStatus) =>
      this.state.update((s) => ({
        ...s,
        sms: s.sms.map((m) => (m.id === smsId ? { ...m, status } : m)),
        updatedAtIso: nowIso(),
      }));
    let missed: Appointment | undefined;
    let chosen: Slot | undefined;
    let booked: Appointment | undefined;
    let escalation: Escalation | undefined;

    const beats: Array<() => Promise<void>> = [
      async () => {
        await this.setPhase("preparing");
        const onFile = this.clinic.listAppointments();
        missed = onFile[0] ? this.clinic.markMissed() : undefined;
        await this.syncAppointments();
        this.callId = (await this.driver.start({ to, from }, this.emit)).callId;
      },
      async () => { await this.setPhase("calling"); await this.script("call.answered"); },
      async () => {
        await this.setPhase("identifying");
        await this.say("agent", `Hi, this is Ava calling from ${brandName()} on behalf of your care team. Am I speaking with ${patient.fullName}?`);
        await this.say("patient", `Yes, this is ${patient.fullName.split(" ")[0]}.`);
      },
      async () => {
        if (!missed) throw new Error("missing seeded appointment");
        await this.setPhase("explaining_missed");
        const missedAt = new Date(missed.scheduledForIso);
        const visitText = missed.reason ?? "visit";
        await this.say("agent", `I'm calling because you missed your appointment — your ${visitText} was scheduled for ${relativeDayLabel(missedAt)} at ${formatTime12(missedAt)} and I don't see you checked in. I'd like to help you find a new time that works for you.`);
        await this.say("patient", "Oh no, I completely forgot. Can we reschedule?");
      },
      async () => {
        await this.setPhase("offering_slots");
        const slots = await this.syncSlots();
        await this.script("slots.offered", { data: { slots } });
        const now = new Date();
        const offer =
          slots.length >= 2
            ? `I can get you in ${slotSpeakLabel(slots[0], now)} with ${slots[0].clinicianName}, or ${slotSpeakLabel(slots[1], now)} with ${slots[1].clinicianName}. Would one of those work for you?`
            : `I have ${slotSpeakLabel(slots[0], now)} with ${slots[0].clinicianName}. Does that work for you?`;
        await this.say("agent", offer);
      },
      async () => {
        await this.setPhase("awaiting_choice");
        const slots = (await this.state.get()).availableSlots;
        if (!slots[0]) throw new Error("no slots available to offer");
        chosen = slots[1] ?? slots[0];
        await this.say("patient", `${slotSpeakLabel(chosen, new Date())} works for me.`);
        await this.script("slot.selected", { data: { slotId: chosen.id } });
      },
      async () => {
        if (!chosen) throw new Error("no slot selected");
        await this.setPhase("booking");
        const result = this.clinic.bookSlot(chosen.id);
        if ("error" in result) throw new Error(`booking failed unexpectedly: ${result.error}`);
        booked = result.appointment;
        const bookedSlotId = chosen.id;
        await this.syncAppointments();
        await this.state.update((s) => ({
          ...s,
          availableSlots: s.availableSlots.filter((x) => x.id !== bookedSlotId),
          updatedAtIso: nowIso(),
        }));
        await this.say("agent", `Done — you're rebooked for ${slotTimeLabel(chosen, new Date())} with ${chosen.clinicianName}.`);
      },
      async () => {
        if (!booked) throw new Error("no booked appointment");
        await this.setPhase("confirming_sms");
        const sms = buildSmsConfirmation({ patient, appointment: booked, fromE164: from, messageType: "rescheduled" });
        await this.state.update((s) => ({ ...s, sms: [...s.sms, sms], updatedAtIso: nowIso() }));
        await sleep(Math.min(2500, paceMs));
        await advanceSms(sms.id, "sent");
        await sleep(Math.min(2500, paceMs));
        await advanceSms(sms.id, "delivered");
      },
      async () => { await this.setPhase("handling_question"); await this.say("patient", PATIENT_QUESTION); },
      async () => { await this.say("agent", AGENT_POLICY_LINE); },
      async () => {
        if (!missed || !chosen) throw new Error("missing context for escalation");
        await this.setPhase("escalating");
        const raised = buildEscalation(patient, missed, chosen, PATIENT_QUESTION);
        await this.state.update((s) => ({ ...s, escalations: [...s.escalations, raised], updatedAtIso: nowIso() }));
        await this.script("escalation.raised", { data: { escalationId: raised.id, category: raised.category } });
        escalation = raised;
      },
      async () => {
        if (!escalation) throw new Error("no escalation raised");
        await this.setPhase("transferring");
        const tool = buildTransferToolConfig({
          staffNumber: (await this.state.get()).settings.staffPhoneE164,
          fromNumber: from,
          instructions: `Warm transfer to ${brandName()} staff. Patient: ${patient.fullName} (MRN ${patient.mrn}). ${escalation.handoff.appointmentSummary}. Patient question: ${escalation.patientQuestion}. Ask the staff member to confirm pickup before connecting.`,
        });
        await this.script("transfer.started", { data: tool });
        await sleep(Math.min(500, paceMs));
        await this.script("transfer.connected");
        await this.connectEscalations();
      },
      async () => {
        await this.say("agent", AGENT_HANDOFF_LINE);
        await this.say("agent", `Hi ${patient.fullName.split(" ")[0]}, this is Nurse Priya — I understand you have a question about your medication before your appointment.`);
      },
      async () => {
        await this.setPhase("in_handoff");
        await sleep(Math.min(1500, paceMs));
        await this.script("call.ended");
        await this.setPhase("done");
      },
    ];

    for (const beat of beats) {
      if (this.stopped) throw new DemoStopped();
      await beat();
      await sleep(paceMs);
    }
  }
}
