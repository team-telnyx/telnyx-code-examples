import type { Appointment, Escalation, Patient, Slot } from "@/domain/types";
import { relativeDayLabel, formatTime12, fromLocalIso } from "@/domain/slots";

// Escalation policy: the assistant never advises on medical matters. It
// detects a medical question and packages full handoff context for staff.

export type MedicalCategory = "medication" | "dosage" | "symptoms" | "general";

const CATEGORY_KEYWORDS: Array<{ category: MedicalCategory; words: string[] }> = [
  {
    category: "dosage",
    words: ["dosage", "dose", "how many", "how much", "mg", "milligram", "strength"],
  },
  {
    category: "medication",
    words: ["medication", "medicine", "meds", "pill", "pills", "prescription", "drug"],
  },
  {
    category: "symptoms",
    words: ["symptom", "symptoms", "pain", "hurts", "fever", "dizzy", "nausea", "bleeding"],
  },
];

const GENERAL_MEDICAL_WORDS = ["doctor", "nurse", "treatment", "blood pressure", "surgery", "test results"];

export function detectMedicalQuestion(utterance: string): {
  isMedical: boolean;
  category?: MedicalCategory;
} {
  const text = utterance.toLowerCase();
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.some((w) => text.includes(w))) {
      return { isMedical: true, category };
    }
  }
  if (GENERAL_MEDICAL_WORDS.some((w) => text.includes(w))) {
    return { isMedical: true, category: "general" };
  }
  return { isMedical: false };
}

export function buildEscalation(
  patient: Patient,
  appointment: Appointment,
  selectedSlot: Slot | undefined,
  question: string,
): Escalation {
  const missedAt = fromLocalIso(appointment.scheduledForIso);
  const missedLabel = `${relativeDayLabel(missedAt)} at ${formatTime12(missedAt)}`;
  const parts = [`Missed appointment ${missedLabel}`];
  if (appointment.reason) {
    parts.push(`(${appointment.reason})`);
  }
  if (selectedSlot) {
    const slotAt = fromLocalIso(selectedSlot.startsAtIso);
    parts.push(
      `rebooked for ${relativeDayLabel(slotAt)} at ${formatTime12(slotAt)} with ${selectedSlot.clinicianName}`,
    );
  }

  const detected = detectMedicalQuestion(question);
  return {
    id: `esc-${crypto.randomUUID()}`,
    createdAtIso: new Date().toISOString(),
    category: detected.category ?? "general",
    patientQuestion: question,
    handoff: {
      patientName: patient.fullName,
      mrn: patient.mrn,
      appointmentSummary: parts.join(" "),
      selectedSlot,
      patientQuestion: question,
    },
    status: "pending",
  };
}
