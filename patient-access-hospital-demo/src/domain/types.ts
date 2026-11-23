// Synthetic demo domain types. No real PHI — all data is fictional.
// This file is the frozen shared contract between the domain layer,
// the server runtime, and the UI. Do not change shapes without updating
// docs/API.md and src/fixtures/demoState.ts.

export type PhoneE164 = string; // validated by /^\+[1-9]\d{7,14}$/

export type Slot = {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  clinicianName: string;
  kind: "new-patient" | "follow-up";
};

export type AppointmentStatus = "missed" | "completed" | "cancelled" | "booked";

export type Appointment = {
  id: string;
  patientId: string;
  scheduledForIso: string;
  status: AppointmentStatus;
  slotId?: string;
  reason?: string;
};

export type Patient = {
  id: string;
  fullName: string;
  mrn: string;
  dobIso: string;
  phoneE164: PhoneE164;
};

export type CallStatus =
  | "dialing"
  | "in_progress"
  | "connected_to_staff"
  | "ended"
  | "failed"
  | "cancelled";

export type CallEventKind =
  | "call.initiated"
  | "call.answered"
  | "transcript.agent"
  | "transcript.patient"
  | "slots.offered"
  | "slot.selected"
  | "escalation.raised"
  | "transfer.started"
  | "transfer.connected"
  | "call.ended"
  | "call.failed";

export type CallEvent = {
  id: string;
  callId: string;
  atIso: string;
  kind: CallEventKind;
  speaker?: "agent" | "patient";
  text?: string;
  data?: Record<string, unknown>;
};

export type Call = {
  id: string;
  toE164: PhoneE164;
  fromE164: PhoneE164;
  status: CallStatus;
  events: CallEvent[];
  startedAtIso?: string;
  endedAtIso?: string;
};

export type SmsStatus = "queued" | "sent" | "delivered" | "failed";

export type SmsMessage = {
  id: string;
  toE164: PhoneE164;
  fromE164: PhoneE164;
  body: string;
  status: SmsStatus;
  createdAtIso: string;
  appointmentId?: string;
};

export type HandoffContext = {
  patientName: string;
  mrn: string;
  appointmentSummary: string;
  selectedSlot?: Slot;
  patientQuestion: string;
};

export type Escalation = {
  id: string;
  createdAtIso: string;
  category: "medication" | "dosage" | "symptoms" | "general";
  patientQuestion: string;
  handoff: HandoffContext;
  status: "pending" | "connected";
};

export type DemoSettings = {
  /** Clinic calling hours as local "HH:MM" strings; slots must fall inside. */
  callingHours: { start: string; end: string };
  /** Staff / nurse number for warm transfer (E.164). */
  staffPhoneE164: PhoneE164;
  /** Telnyx number used for calls + SMS in live mode (E.164). */
  fromNumberE164?: PhoneE164;
  /** Patient-side phone live mode calls/texts (E.164). */
  targetPhoneE164?: PhoneE164;
};

export type DemoPhase =
  | "idle"
  | "preparing"
  | "calling"
  | "identifying"
  | "explaining_missed"
  | "offering_slots"
  | "awaiting_choice"
  | "booking"
  | "confirming_sms"
  | "handling_question"
  | "escalating"
  | "transferring"
  | "in_handoff"
  | "done"
  | "stopped";

export type DemoMode = "mock" | "live";

export type DemoState = {
  mode: DemoMode;
  patient: Patient;
  appointments: Appointment[];
  availableSlots: Slot[];
  calls: Call[];
  sms: SmsMessage[];
  escalations: Escalation[];
  settings: DemoSettings;
  phase: DemoPhase;
  diagnostics?: string[];
  updatedAtIso: string;
};
