import { describe, expect, it } from "vitest";
import type { DemoSettings } from "@/domain/types";
import { MockClinicStore } from "@/domain/scheduling";
import { defaultSettings, validateSettings } from "@/domain/settings";
import { clinicMinutesOf, fromLocalIso } from "@/domain/slots";

describe("validateSettings", () => {
  it("rejects calling hours where start is not before end", () => {
    const result = validateSettings({
      callingHours: { start: "18:00", end: "08:00" },
      staffPhoneE164: "+15555550188",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects malformed phone numbers", () => {
    const result = validateSettings({
      callingHours: { start: "08:00", end: "18:00" },
      staffPhoneE164: "5551234",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/E\.164/);
  });

  it("applies a valid partial update by filling defaults", () => {
    const result = validateSettings({ callingHours: { start: "10:00", end: "12:00" } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid settings");
    expect(result.settings.callingHours).toEqual({ start: "10:00", end: "12:00" });
    expect(result.settings.staffPhoneE164).toBe(defaultSettings.staffPhoneE164);
  });

  it("allows optional live phone settings to be cleared", () => {
    const result = validateSettings({
      callingHours: { start: "08:00", end: "17:00" },
      staffPhoneE164: "+15555550188",
      fromNumberE164: "",
      targetPhoneE164: "",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected empty optional phone settings to be valid");
    expect(result.settings.fromNumberE164).toBeUndefined();
    expect(result.settings.targetPhoneE164).toBeUndefined();
  });

  it("regenerates slots inside new calling hours via MockClinicStore.listAvailableSlots", () => {
    const store = new MockClinicStore();
    const settings: DemoSettings = {
      callingHours: { start: "10:00", end: "12:00" },
      staffPhoneE164: "+15555550188",
    };

    const slots = store.listAvailableSlots(new Date("2026-10-28T12:00:00"), settings);

    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      const start = fromLocalIso(slot.startsAtIso);
      const minutes = clinicMinutesOf(start);
      expect(minutes).toBeGreaterThanOrEqual(600);
      expect(minutes + 30).toBeLessThanOrEqual(720);
    }
  });
});
