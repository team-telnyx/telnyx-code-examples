import type { Appointment, DemoSettings, DemoState, Patient, Slot } from "@/domain/types";
import { generateSlots, toLocalIso } from "@/domain/slots";

// Clinic data store: the single source of truth for appointments and the
// slot inventory during a demo run. Framework-free; the server layer and
// DemoDriver both consume this interface.

export type SeedData = {
  patient: Patient;
  appointments: Appointment[];
  slotSeed: number;
};

export const SLOT_SEED = 42;

export function defaultSeed(now: Date = new Date()): SeedData {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(10, 30, 0, 0);
  return {
    patient: {
      id: "patient-001",
      fullName: "Jordan Rivera",
      mrn: "MRN-004512",
      dobIso: "1978-03-14",
      phoneE164: "+15555550123",
    },
    appointments: [
      {
        id: "apt-001",
        patientId: "patient-001",
        scheduledForIso: toLocalIso(yesterday),
        status: "booked",
        reason: "Follow-up with Dr. Chen",
      },
    ],
    slotSeed: SLOT_SEED,
  };
}

/**
 * The book-first clean start: no appointment on file until the operator books
 * one. The placeholder patient keeps type-shape intact until intake replaces
 * it with the real person.
 */
export function intakeSeed(patient?: Patient, now: Date = new Date()): SeedData {
  const base = defaultSeed(now);
  return { patient: patient ?? base.patient, appointments: [], slotSeed: SLOT_SEED };
}

export interface ClinicStore {
  getPatient(): Patient;
  listAppointments(): Appointment[];
  listAvailableSlots(now: Date, settings: DemoSettings): Slot[];
  /** Availability offered during the rebooking call (future slots, not intake slots). */
  listRebookSlots(now: Date, settings: DemoSettings): Slot[];
  /** Book-first intake: puts the patient on file and books their chosen slot. */
  intake(patient: Patient, slot: Slot): { appointment: Appointment } | { error: string };
  markMissed(): Appointment;
  bookSlot(slotId: string): { appointment: Appointment } | { error: "slot_taken" };
}

export class MockClinicStore implements ClinicStore {
  private seed: SeedData;
  private appointments: Appointment[];
  private cachedSlots: Slot[];

  constructor(seed?: SeedData) {
    this.seed = structuredClone(seed ?? defaultSeed());
    this.appointments = structuredClone(this.seed.appointments);
    this.cachedSlots = [];
  }

  getPatient(): Patient {
    return structuredClone(this.seed.patient);
  }

  listAppointments(): Appointment[] {
    return structuredClone(this.appointments);
  }

  listAvailableSlots(now: Date, settings: DemoSettings): Slot[] {
    if (this.cachedSlots.length === 0) {
      this.cachedSlots = generateSlots(now, settings, this.seed.slotSeed);
    }
    return structuredClone(this.cachedSlots);
  }

  /** Concrete-only: force regeneration (e.g. after a settings change or reset). */
  regenerateSlots(now: Date, settings: DemoSettings): Slot[] {
    this.cachedSlots = generateSlots(now, settings, this.seed.slotSeed);
    return structuredClone(this.cachedSlots);
  }

  /** Availability offered during the rebooking call — resets the inventory to future slots. */
  listRebookSlots(now: Date, settings: DemoSettings): Slot[] {
    this.cachedSlots = generateSlots(now, settings, this.seed.slotSeed);
    return structuredClone(this.cachedSlots);
  }

  /**
   * Book-first intake: replaces the placeholder patient with the real person
   * and books their chosen slot as a regular appointment. Only allowed while
   * no visit is on file.
   */
  intake(patient: Patient, slot: Slot): { appointment: Appointment } | { error: string } {
    if (this.appointments.some((a) => a.status === "booked" || a.status === "missed")) {
      return { error: "A visit is already on file — reset the demo to book a new one." };
    }
    this.seed.patient = structuredClone(patient);
    const appointment: Appointment = {
      id: "apt-self-1",
      patientId: patient.id,
      scheduledForIso: slot.startsAtIso,
      status: "booked",
      slotId: slot.id,
      reason: `${slot.kind === "new-patient" ? "New patient" : "Follow-up"} visit with ${slot.clinicianName}`,
    };
    this.appointments = [appointment];
    this.cachedSlots = this.cachedSlots.filter((s) => s.id !== slot.id);
    return { appointment: structuredClone(appointment) };
  }

  /** Concrete-only: restore the initial seed (used by /api/demo/start?reset=true). */
  reset(): void {
    this.appointments = structuredClone(this.seed.appointments);
    this.cachedSlots = [];
  }

  markMissed(): Appointment {
    const booked = this.appointments.find((a) => a.status === "booked");
    if (booked) {
      booked.status = "missed";
      return structuredClone(booked);
    }
    const first = this.appointments[0];
    if (!first) throw new Error("no appointments to mark missed");
    return structuredClone(first);
  }

  bookSlot(slotId: string): { appointment: Appointment } | { error: "slot_taken" } {
    const index = this.cachedSlots.findIndex((s) => s.id === slotId);
    if (index === -1) {
      return { error: "slot_taken" };
    }
    const slot = this.cachedSlots[index];
    this.cachedSlots = this.cachedSlots.filter((s) => s.id !== slotId);
    const appointment: Appointment = {
      id: `apt-${this.appointments.length + 1}`,
      patientId: this.seed.patient.id,
      scheduledForIso: slot.startsAtIso,
      status: "booked",
      slotId: slot.id,
      reason: `${slot.kind === "follow-up" ? "Follow-up" : "New patient"} visit with ${slot.clinicianName}`,
    };
    this.appointments.push(appointment);
    return { appointment: structuredClone(appointment) };
  }

  /**
   * In-place adopt: the driver holds this clinic instance across reset and
   * rehydrate, so mutations must flow through the SAME object reference.
   */
  adoptFromState(state: DemoState): void {
    this.seed = {
      patient: structuredClone(state.patient),
      appointments: structuredClone(state.appointments),
      slotSeed: SLOT_SEED,
    };
    this.appointments = structuredClone(state.appointments);
    this.cachedSlots = [];
  }
}
