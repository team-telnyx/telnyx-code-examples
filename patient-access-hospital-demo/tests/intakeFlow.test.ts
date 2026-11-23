import { describe, expect, it } from "vitest";
import { intakeSeed, MockClinicStore } from "@/domain/scheduling";
import { generateIntakeSlots } from "@/domain/slots";
import { defaultSettings } from "@/domain/settings";
import type { Patient } from "@/domain/types";

const now = new Date("2026-11-02T12:00:00");
const patient: Patient = {
  id: "patient-self-1",
  fullName: "Priya Nair",
  mrn: "MRN-0099999",
  dobIso: "",
  phoneE164: "+15555551999",
};

describe("book-first intake flow", () => {
  it("books the slot, saves the patient on file, consumes the slot", () => {
    const clinic = new MockClinicStore(intakeSeed());
    const slots = generateIntakeSlots(now, defaultSettings, 42);
    expect(slots.length).toBeGreaterThan(0);
    const result = clinic.intake(patient, slots[0]);
    if (!("appointment" in result)) throw new Error("intake should succeed here");
    expect(result.appointment.status).toBe("booked");
    expect(result.appointment.scheduledForIso).toBe(slots[0].startsAtIso);
    expect(result.appointment.reason).toContain("Dr. A. Chen");
    expect(clinic.getPatient().fullName).toBe("Priya Nair");
    expect(clinic.getPatient().phoneE164).toBe("+15555551999");
    expect(clinic.listAppointments()).toHaveLength(1);
  });

  it("refuses a second intake while a visit is on file", () => {
    const clinic = new MockClinicStore(intakeSeed());
    const slots = generateIntakeSlots(now, defaultSettings, 42);
    clinic.intake(patient, slots[0]);
    const again = clinic.intake(patient, slots[1]);
    expect(again).toEqual({ error: "A visit is already on file — reset the demo to book a new one." });
  });

  it("marks the visit missed and rebooks from future slots", () => {
    const clinic = new MockClinicStore(intakeSeed());
    const slots = generateIntakeSlots(now, defaultSettings, 42);
    clinic.intake(patient, slots[0]);
    const missed = clinic.markMissed();
    expect(missed.status).toBe("missed");
    const rebook = clinic.listRebookSlots(now, defaultSettings);
    expect(rebook).toHaveLength(3);
    expect(rebook.some((s) => s.id === "slot-42-2")).toBe(true);
    const booked = clinic.bookSlot(rebook[1].id);
    if (!("appointment" in booked)) throw new Error("rebooking should succeed here");
    expect(booked.appointment.status).toBe("booked");
    expect(booked.appointment.scheduledForIso).toBe(rebook[1].startsAtIso);
    expect(clinic.listAppointments()).toHaveLength(2);
  });
});
