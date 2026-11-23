import { describe, expect, it } from "vitest";
import { slotMatchesToolInput } from "@/domain/voiceTools";
import type { Slot } from "@/domain/types";

const slots: Slot[] = [
  {
    id: "slot-42-1",
    startsAtIso: "2026-11-24T09:00:00",
    endsAtIso: "2026-11-24T09:30:00",
    clinicianName: "Dr. A. Chen",
    kind: "follow-up",
  },
];

describe("slotMatchesToolInput", () => {
  it("falls back from a stale slot id to an exact ISO time", () => {
    expect(
      slotMatchesToolInput(
        { slotId: "slot-9am-chen-20261124", newTime: "2026-11-24 09:00" },
        slots,
        () => null,
      ),
    ).toEqual(slots[0]);
  });

  it("matches a valid runtime slot id", () => {
    expect(slotMatchesToolInput({ slotId: "slot-42-1" }, slots, () => null)).toEqual(slots[0]);
  });
});
