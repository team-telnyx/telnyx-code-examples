import { describe, expect, it } from "vitest";
import type { Appointment, Slot } from "@/domain/types";
import { defaultSeed } from "@/domain/scheduling";
import { buildEscalation, detectMedicalQuestion } from "@/domain/escalation";
import { toLocalIso } from "@/domain/slots";

const patient = defaultSeed().patient;
const QUESTION = "Quick question — can I take my medication before the appointment?";

const yesterdayAt1030 = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(10, 30, 0, 0);
  return toLocalIso(d);
};

const tomorrowAt14 = (): Slot => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(14, 0, 0, 0);
  return {
    id: "slot-42-2",
    startsAtIso: toLocalIso(start),
    endsAtIso: toLocalIso(new Date(start.getTime() + 30 * 60_000)),
    clinicianName: "Dr. A. Chen",
    kind: "follow-up",
  };
};

const missedAppointment = (): Appointment => ({
  id: "apt-001",
  patientId: patient.id,
  scheduledForIso: yesterdayAt1030(),
  status: "missed",
  reason: "Follow-up with Dr. Chen",
});

describe("detectMedicalQuestion", () => {
  it("flags the scripted medication question as medical with category medication", () => {
    expect(detectMedicalQuestion(QUESTION)).toEqual({ isMedical: true, category: "medication" });
  });

  it("does not flag ordinary conversation as medical", () => {
    expect(detectMedicalQuestion("Thanks, see you then!")).toEqual({ isMedical: false });
  });

  it("detects dosage questions separately", () => {
    expect(detectMedicalQuestion("How much of the pill should I take?")).toEqual({
      isMedical: true,
      category: "dosage",
    });
  });
});

describe("buildEscalation", () => {
  it("packages complete handoff context without any medical advice", () => {
    const slot = tomorrowAt14();
    const escalation = buildEscalation(patient, missedAppointment(), slot, QUESTION);

    expect(escalation.category).toBe("medication");
    expect(escalation.status).toBe("pending");
    expect(escalation.handoff.patientName).toBe("Jordan Rivera");
    expect(escalation.handoff.mrn).toBe("MRN-004512");
    expect(escalation.handoff.selectedSlot).toEqual(slot);
    expect(escalation.handoff.patientQuestion).toBe(QUESTION);
    expect(escalation.handoff.appointmentSummary).toContain("Missed appointment");
    expect(escalation.handoff.appointmentSummary).toContain("rebooked for");
    expect(escalation.handoff.appointmentSummary).toContain("Dr. A. Chen");
  });

  it("omits the rebooked clause when no slot was selected", () => {
    const escalation = buildEscalation(patient, missedAppointment(), undefined, QUESTION);

    expect(escalation.handoff.appointmentSummary).not.toContain("rebooked for");
    expect(escalation.handoff.selectedSlot).toBeUndefined();
  });

  it("contains no advice text anywhere in the escalation payload", () => {
    const escalation = buildEscalation(patient, missedAppointment(), tomorrowAt14(), QUESTION);
    const serialized = JSON.stringify(escalation).toLowerCase();

    for (const phrase of [
      "you can take",
      "you should",
      "it is safe",
      "go ahead",
      "twice daily",
      "recommended",
      "milligram",
    ]) {
      expect(serialized).not.toContain(phrase);
    }
    expect(serialized).not.toMatch(/\bmg\b/);
  });
});
