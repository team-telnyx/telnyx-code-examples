import type { Appointment, Patient, SmsMessage } from "@/domain/types";
import { formatDateLong, formatTime12, fromLocalIso } from "@/domain/slots";
import { brandName } from "@/domain/brand";

// SMS confirmation built from a booked appointment. Framework-free.

/** Extract the clinician recorded by bookSlot in the appointment reason. */
export function clinicianFromAppointment(appointment: Appointment): string | undefined {
  const match = /with ([A-Za-z][A-Za-z. ]*)$/.exec(appointment.reason ?? "");
  return match ? match[1].trim() : undefined;
}

function createHash(input: string): string {
  // Small stable digest (FNV-1a) — enough for idempotent demo ids, no crypto needed.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildSmsConfirmation(input: {
  patient: Patient;
  appointment: Appointment;
  fromE164: string;
  messageType?: "booked" | "rescheduled";
}): SmsMessage {
  const when = fromLocalIso(input.appointment.scheduledForIso);
  const timeLabel = `on ${formatDateLong(when)} at ${formatTime12(when)}`;
  const clinician = clinicianFromAppointment(input.appointment);
  const prefix = input.messageType === "rescheduled" ? "confirming your rescheduled appointment" : "confirming your appointment";
  const body = clinician
    ? `Hi ${input.patient.fullName} — this is ${brandName()} ${prefix} ${timeLabel} with ${clinician}. Reply CALL with any questions.`
    : `Hi ${input.patient.fullName} — this is ${brandName()} ${prefix} ${timeLabel}. Reply CALL with any questions.`;

  return {
    id: `sms-${createHash(`${input.patient.id}:${input.appointment.id}`)}`,
    toE164: input.patient.phoneE164,
    fromE164: input.fromE164,
    body,
    status: "queued",
    createdAtIso: new Date().toISOString(),
    appointmentId: input.appointment.id,
  };
}
