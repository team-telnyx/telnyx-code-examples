import { describe, expect, it } from "vitest";
import { extractTranscriptEvents } from "@/call/telnyx";
import {
  addClinicDays,
  findBookedSlot,
  formatTime12,
  fromLocalIso,
  generateSlots,
  relativeDayLabel,
} from "@/domain/slots";
import type { Slot } from "@/domain/types";
import { defaultSettings } from "@/domain/settings";
import { buildAssistantConfig } from "@/call/telnyx";

const NOW = new Date("2026-10-28T12:00:00");

const plusCalendarDays = (iso: string, days: number): string => addClinicDays(iso, days);

const slotLabel = (startsAtIso: string): string =>
  `${relativeDayLabel(fromLocalIso(startsAtIso), NOW)} at ${formatTime12(fromLocalIso(startsAtIso))}`;

describe("findBookedSlot", () => {
  const slots = generateSlots(NOW, defaultSettings, 42);

  it("books the slot named by a concrete day+time choice", () => {
    const utterances = [
      `Here are some available times: ${slots.map((s) => slotLabel(s.startsAtIso)).join("; ")}.`,
      `Oh no — ${slotLabel(slots[1].startsAtIso)} works for me.`,
    ];

    expect(findBookedSlot(utterances, slots, NOW)?.id).toBe(slots[1].id);
  });

  it("skips offer-list utterances that name every slot", () => {
    const offer = `Here are some available times: ${slots.map((s) => slotLabel(s.startsAtIso)).join("; ")}.`;

    expect(findBookedSlot([offer], slots, NOW)).toBeNull();
  });

  it("returns null when the patient never picks a time", () => {
    const utterances = ["Oh no, I completely forgot. Can we reschedule?", "I'm not sure, maybe next week."];

    expect(findBookedSlot(utterances, slots, NOW)).toBeNull();
  });

  it("books the earliest slot on a take-any utterance", () => {
    expect(findBookedSlot(["Whatever works for me.", "Sounds good."], slots, NOW)?.id).toBe(slots[0].id);
  });

  it("lets the agent confirmation carry the choice when the patient is terse", () => {
    const utterances = [
      `You're rebooked for ${slotLabel(slots[2].startsAtIso)} with ${slots[2].clinicianName}.`,
      "Perfect, thank you.",
    ];

    expect(findBookedSlot(utterances, slots, NOW)?.id).toBe(slots[2].id);
  });

  it("returns null with no slots on offer", () => {
    expect(findBookedSlot(["tomorrow at 2 pm please"], [], NOW)).toBeNull();
  });

  describe("time-only fallback (live speech without a day)", () => {
    it("books when the time is unique across offered slots", () => {
      const label = formatTime12(fromLocalIso(slots[1].startsAtIso));
      const hour = label.split(":")[0];

      expect(findBookedSlot([`${label} works for me.`], slots, NOW)?.id).toBe(slots[1].id);
      expect(findBookedSlot([`the ${hour} o'clock works.`], slots, NOW)?.id).toBe(slots[1].id);
    });

    it("stays null when the same time exists on two days", () => {
      const clone: Slot = {
        ...slots[1],
        id: "slot-clone-day4",
        startsAtIso: plusCalendarDays(slots[1].startsAtIso, 4),
      };
      const label = formatTime12(fromLocalIso(slots[1].startsAtIso));
      expect(findBookedSlot([`${label} works for me.`], [slots[1], clone], NOW)).toBeNull();
    });

    it("never misbooks the agent's offer list", () => {
      const offer = `Here are some available times: ${slots.map((s) => slotLabel(s.startsAtIso)).join("; ")}.`;

      expect(findBookedSlot([offer], slots, NOW)).toBeNull();
    });

    it("still books a full day+time utterance in pass one (fallback never needed)", () => {
      expect(findBookedSlot([`${slotLabel(slots[2].startsAtIso)} works for me.`], slots, NOW)?.id).toBe(slots[2].id);
    });
  });
});

describe("live assistant opening", () => {
  it("opens with the missed-appointment context instead of a generic help prompt", () => {
    const config = buildAssistantConfig({
      assistantId: "assistant-test",
      patientName: "Jordan Lee",
      missedAppointmentSummary: "Follow-up visit was scheduled today at 4:30 PM",
      slotOptions: [],
      transferTool: { type: "transfer", transfer: { from: "+15555550100", targets: [{ name: "Staff", to: "+15555550188" }], warm_transfer_instructions: "Connect." } },
    });

    expect(config.greeting).toContain("I see you missed your appointment");
    expect(config.instructions).toContain("MUST be exactly");
    expect(config.greeting).not.toContain("What can I help you with?");
  });
});

describe("extractTranscriptEvents", () => {
  it("maps a transcripts array into ordered utterance events", () => {
    const raw = JSON.stringify({
      data: {
        event_type: "call.transcripts",
        payload: {
          call_control_id: "cc-1",
          transcripts: [
            { role: "agent", text: "Hello Priya, this is Ava from Winderval Medical." },
            { role: "user", text: "Oh no, I completely forgot." },
          ],
        },
      },
    });

    const events = extractTranscriptEvents(raw);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ callId: "cc-1", kind: "transcript.agent", speaker: "agent" });
    expect(events[0].text).toContain("Ava");
    expect(events[1]).toMatchObject({ callId: "cc-1", kind: "transcript.patient", speaker: "patient" });
  });

  it("accepts a single utterance payload via role/content", () => {
    const raw = JSON.stringify({
      data: {
        event_type: "call.transcript",
        payload: { call_control_id: "cc-2", role: "assistant", content: "You're rebooked for tomorrow." },
      },
    });

    const events = extractTranscriptEvents(raw);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ callId: "cc-2", kind: "transcript.agent", speaker: "agent" });
    expect(events[0].text).toBe("You're rebooked for tomorrow.");
  });

  it("returns empty for non-transcript events, bad json, and empty utterances", () => {
    expect(extractTranscriptEvents(JSON.stringify({ data: { event_type: "call.answered", payload: {} } }))).toEqual([]);
    expect(extractTranscriptEvents("not-json")).toEqual([]);
    expect(
      extractTranscriptEvents(JSON.stringify({ data: { event_type: "call.transcripts", payload: { transcripts: [{ role: "user" }] } } })),
    ).toEqual([]);
  });

  it("parses call.transcription payloads (transcription_data) with the track-based speaker", () => {
    const raw = JSON.stringify({
      data: {
        event_type: "call.transcription",
        payload: {
          call_control_id: "cc-t1",
          transcription_data: { transcript: "Tomorrow at 2 PM works for me.", is_final: true, transcription_track: "inbound" },
        },
      },
    });

    const events = extractTranscriptEvents(raw);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ callId: "cc-t1", kind: "transcript.patient", speaker: "patient", text: "Tomorrow at 2 PM works for me." });
  });

  it("skips interim transcription frames and maps outbound track to the agent", () => {
    const interim = JSON.stringify({
      data: {
        event_type: "call.transcription",
        payload: { transcription_data: { transcript: "I'd like to—", is_final: false } },
      },
    });
    const agent = JSON.stringify({
      data: {
        event_type: "call.transcription",
        payload: { transcription_data: { transcript: "You're rebooked for tomorrow at 2:00 PM.", transcription_track: "outbound" } },
      },
    });

    expect(extractTranscriptEvents(interim)).toEqual([]);
    const agentEvents = extractTranscriptEvents(agent);
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]).toMatchObject({ kind: "transcript.agent", speaker: "agent" });
  });
});
