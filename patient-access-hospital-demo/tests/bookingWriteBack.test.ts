import { describe, expect, it } from "vitest";
import { MockClinicStore } from "@/domain/scheduling";
import { defaultSettings } from "@/domain/settings";

const NOW = new Date("2026-10-28T12:00:00");

describe("MockClinicStore.bookSlot", () => {
  it("writes a booked appointment with the slotId and scheduled time back", () => {
    const store = new MockClinicStore();
    const slots = store.listAvailableSlots(NOW, defaultSettings);

    const result = store.bookSlot(slots[0].id);

    expect("error" in result).toBe(false);
    if (!("appointment" in result)) throw new Error("expected booking success");
    const { appointment } = result;
    expect(appointment.status).toBe("booked");
    expect(appointment.slotId).toBe(slots[0].id);
    expect(appointment.scheduledForIso).toBe(slots[0].startsAtIso);
    expect(store.listAppointments().some((a) => a.id === appointment.id)).toBe(true);
  });

  it("removes the booked slot from the available slot list", () => {
    const store = new MockClinicStore();
    const slots = store.listAvailableSlots(NOW, defaultSettings);
    store.bookSlot(slots[0].id);

    const remaining = store.listAvailableSlots(NOW, defaultSettings);

    expect(remaining).toHaveLength(2);
    expect(remaining.map((s) => s.id)).not.toContain(slots[0].id);
  });

  it("rejects double-booking the same slot with slot_taken without mutating state", () => {
    const store = new MockClinicStore();
    const slots = store.listAvailableSlots(NOW, defaultSettings);
    store.bookSlot(slots[0].id);
    const appointmentsBefore = store.listAppointments();
    const slotsBefore = store.listAvailableSlots(NOW, defaultSettings);

    const rejected = store.bookSlot(slots[0].id);

    expect(rejected).toEqual({ error: "slot_taken" });
    expect(store.listAppointments()).toEqual(appointmentsBefore);
    expect(store.listAvailableSlots(NOW, defaultSettings)).toEqual(slotsBefore);
  });
});
