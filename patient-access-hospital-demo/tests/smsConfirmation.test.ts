import { describe, expect, it } from "vitest";
import type { Appointment } from "@/domain/types";
import { defaultSeed } from "@/domain/scheduling";
import { buildSmsConfirmation } from "@/domain/sms";
import { formatDateLong, fromPacificParts, pacificParts, toLocalIso, fromLocalIso } from "@/domain/slots";

const patient = defaultSeed().patient;

const tomorrowAt14 = (): string => {
  const p = pacificParts(new Date());
  return toLocalIso(fromPacificParts(p.y, p.mo, p.d + 1, 14, 0, 0));
};

const bookedAppointment = (): Appointment => ({
  id: "apt-002",
  patientId: patient.id,
  scheduledForIso: tomorrowAt14(),
  status: "booked",
  slotId: "slot-42-2",
  reason: "Follow-up visit with Dr. A. Chen",
});

describe("buildSmsConfirmation", () => {
  it("includes the exact clinic-local date, time, and clinician in the body", () => {
    const sms = buildSmsConfirmation({
      patient,
      appointment: bookedAppointment(),
      fromE164: "+15555550100",
    });

    expect(sms.body).toContain(`${formatDateLong(fromLocalIso(bookedAppointment().scheduledForIso))} at 2:00 PM`);
    expect(sms.body).toContain("Dr. A. Chen");
  });

  it("starts in the queued status", () => {
    const sms = buildSmsConfirmation({
      patient,
      appointment: bookedAppointment(),
      fromE164: "+15555550100",
    });

    expect(sms.status).toBe("queued");
    expect(sms.toE164).toBe(patient.phoneE164);
  });

  it("produces an idempotent id for the same input and a different one otherwise", () => {
    const appointment = bookedAppointment();
    const first = buildSmsConfirmation({ patient, appointment, fromE164: "+15555550100" });
    const second = buildSmsConfirmation({ patient, appointment, fromE164: "+15555550100" });
    const other = buildSmsConfirmation({
      patient,
      appointment: { ...appointment, id: "apt-003" },
      fromE164: "+15555550100",
    });

    expect(second.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });
});
