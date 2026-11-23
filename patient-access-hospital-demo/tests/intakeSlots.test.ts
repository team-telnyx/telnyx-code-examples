import { describe, expect, it } from "vitest";
import { generateIntakeSlots } from "@/domain/slots";
import { defaultSettings } from "@/domain/settings";

describe("generateIntakeSlots", () => {
  it("offers today-only slots strictly ahead of now, inside calling hours", () => {
    const now = new Date("2026-11-02T12:00:00");
    const slots = generateIntakeSlots(now, defaultSettings, 42);
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      const d = new Date(slot.startsAtIso);
      expect(d.getTime()).toBeGreaterThan(now.getTime());
      expect(d.getDate()).toBe(now.getDate());
    }
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
    expect(slots[0].id).toBe("slot-intake-42-1");
  });

  it("spaces consecutive bookable slots an hour apart", () => {
    const now = new Date("2026-11-02T12:00:00");
    const slots = generateIntakeSlots(now, defaultSettings, 42);
    const first = new Date(slots[0].startsAtIso);
    const second = new Date(slots[1].startsAtIso);
    expect(second.getTime() - first.getTime()).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it("yields fewer slots when today's capacity is exhausted", () => {
    const late = new Date("2026-11-02T17:00:00");
    const slots = generateIntakeSlots(late, defaultSettings, 42);
    expect(slots.length).toBe(1);
  });

  it("returns no slots outside calling hours", () => {
    const after = new Date("2026-11-02T20:00:00");
    expect(generateIntakeSlots(after, defaultSettings, 42)).toEqual([]);
  });
});
