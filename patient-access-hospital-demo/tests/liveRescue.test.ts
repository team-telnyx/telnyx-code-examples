import { describe, expect, it } from "vitest";
import { rescueLiveCallId } from "@/call/driver";
import type { Call, CallEvent, CallStatus, DemoState } from "@/domain/types";
import { defaultSettings } from "@/domain/settings";

const callWith = (id: string, status: CallStatus): Call => ({
  id,
  toE164: "",
  fromE164: "",
  status,
  events: [],
});

const stateWith = (calls: Call[]): DemoState => ({
  mode: "live",
  patient: { id: "p1", fullName: "Priya Nair", mrn: "MRN-00000", dobIso: "", phoneE164: "+15555550177" },
  appointments: [],
  availableSlots: [],
  calls,
  sms: [],
  escalations: [],
  settings: defaultSettings,
  phase: "calling",
  updatedAtIso: new Date().toISOString(),
});

const transcriptEvent = (callId: string): CallEvent => ({
  id: "evt-test",
  callId,
  atIso: new Date().toISOString(),
  kind: "transcript.agent",
  text: "Hello, this is Ava from Winderval Medical.",
});

describe("rescueLiveCallId", () => {
  it("returns null when the event already matches a call record", () => {
    const state = stateWith([callWith("cc-1", "in_progress")]);

    expect(rescueLiveCallId(state, transcriptEvent("cc-1"))).toBeNull();
  });

  it("retargets an orphan event onto the single live call", () => {
    const state = stateWith([callWith("cc-leg-2", "in_progress")]);

    expect(rescueLiveCallId(state, transcriptEvent("conv-108"))).toBe("cc-leg-2");
  });

  it("retargets onto the live call even when an older call already ended", () => {
    const state = stateWith([callWith("cc-old", "ended"), callWith("cc-new", "in_progress")]);

    expect(rescueLiveCallId(state, transcriptEvent("conv-new"))).toBe("cc-new");
  });

  it("returns null between zero live calls", () => {
    const state = stateWith([callWith("cc-old", "ended")]);

    expect(rescueLiveCallId(state, transcriptEvent("conv-108"))).toBeNull();
  });

  it("returns null when two calls are live at once", () => {
    const state = stateWith([callWith("cc-a", "in_progress"), callWith("cc-b", "dialing")]);

    expect(rescueLiveCallId(state, transcriptEvent("conv-108"))).toBeNull();
  });

  it("never rescues call.initiated — only the driver creates call records", () => {
    const state = stateWith([callWith("cc-1", "in_progress")]);

    expect(rescueLiveCallId(state, { ...transcriptEvent("conv-108"), kind: "call.initiated" })).toBeNull();
  });
});
