import { describe, expect, it } from "vitest";
import { clinicMinutesOf, fromLocalIso, generateSlots, parseHours } from "@/domain/slots";
import { defaultSettings } from "@/domain/settings";

const NOW = new Date("2026-10-28T12:00:00");

const minutesOf = (iso: string): number => clinicMinutesOf(fromLocalIso(iso));

describe("generateSlots", () => {
  it("returns exactly 3 slots with unique ids", () => {
    const slots = generateSlots(NOW, defaultSettings, 42);

    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
  });

  it("is deterministic for the same (now, seed)", () => {
    const first = generateSlots(NOW, defaultSettings, 42);
    const second = generateSlots(NOW, defaultSettings, 42);

    expect(first).toEqual(second);
  });

  it("places every slot inside the default calling hours", () => {
    const { startMinutes, endMinutes } = parseHours(defaultSettings.callingHours);
    const slots = generateSlots(NOW, defaultSettings, 42);

    for (const slot of slots) {
      const start = minutesOf(slot.startsAtIso);
      expect(start).toBeGreaterThanOrEqual(startMinutes);
      expect(start + 30).toBeLessThanOrEqual(endMinutes);
    }
  });

  it("shifts into the calling hours when the base plan falls outside", () => {
    const settings = { ...defaultSettings, callingHours: { start: "10:00", end: "12:00" } };
    const slots = generateSlots(NOW, settings, 42);
    const { startMinutes, endMinutes } = parseHours(settings.callingHours);

    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      const start = minutesOf(slot.startsAtIso);
      expect(start).toBeGreaterThanOrEqual(startMinutes);
      expect(start + 30).toBeLessThanOrEqual(endMinutes);
    }
  });

  it("extends days until 3 slots fit in a narrow hours window", () => {
    const settings = { ...defaultSettings, callingHours: { start: "10:00", end: "12:00" } };
    const slots = generateSlots(NOW, settings, 42);

    const days = new Set(slots.map((s) => fromLocalIso(s.startsAtIso).getDate()));
    expect(days.size).toBe(3);
  });

  it("throws a clear error when no compliant set can be found", () => {
    const settings = { ...defaultSettings, callingHours: { start: "09:00", end: "09:15" } };
    expect(() => generateSlots(NOW, settings, 42)).toThrow(/unable to fit 3 slots/);
  });
});
