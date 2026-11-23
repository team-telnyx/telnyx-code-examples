import { describe, expect, it } from "vitest";
import type { DemoPhase, DemoSettings, DemoState, Slot } from "@/domain/types";
import type { TransferToolConfig } from "@/domain/transfer";
import { MockClinicStore, defaultSeed } from "@/domain/scheduling";
import { defaultSettings } from "@/domain/settings";
import {generateSlots, clinicMinutesOf, fromLocalIso} from "@/domain/slots";
import { MockCallDriver } from "@/call/mock";
import { DemoDriver } from "@/demo/demoDriver";
import type { StateStore } from "@/demo/state";

const EXPECTED_PHASES: DemoPhase[] = [
  "idle",
  "preparing",
  "calling",
  "identifying",
  "explaining_missed",
  "offering_slots",
  "awaiting_choice",
  "booking",
  "confirming_sms",
  "handling_question",
  "escalating",
  "transferring",
  "in_handoff",
  "done",
];

function makeTestState(): { store: StateStore; phases: DemoPhase[] } {
  const now = new Date();
  const seed = defaultSeed();
  const settings: DemoSettings = { ...defaultSettings };
  let current: DemoState = {
    mode: "mock",
    patient: seed.patient,
    appointments: seed.appointments,
    availableSlots: generateSlots(now, settings, seed.slotSeed),
    calls: [],
    sms: [],
    escalations: [],
    settings,
    phase: "idle",
    updatedAtIso: now.toISOString(),
  };
  const phases: DemoPhase[] = [current.phase];
  const store: StateStore = {
    get: async () => current,
    update: async (fn) => {
      current = fn(current);
      if (current.phase !== phases[phases.length - 1]) phases.push(current.phase);
      return current;
    },
    reset: async () => current,
  };
  return { store, phases };
}

describe("DemoDriver scripted run", () => {
  it("plays the full reschedule + warm-transfer story at paceMs 1", async () => {
    const { store, phases } = makeTestState();
    const clinic = new MockClinicStore();
    const driver = new MockCallDriver();
    const demo = new DemoDriver({ driver, clinic, state: store });

    await demo.run({ paceMs: 1 });

    const state = await store.get();
    expect(demo.isRunning()).toBe(false);
    expect(state.phase).toBe("done");
    expect(phases).toEqual(EXPECTED_PHASES);

    const call = state.calls[0];
    expect(call).toBeDefined();
    expect(call.toE164).toBe("+15555550123");
    expect(call.fromE164).toBe("+15555550100");
    expect(call.status).toBe("ended");

    const kinds = call.events.map((e) => e.kind);
    expect(kinds[0]).toBe("call.initiated");
    expect(kinds).toContain("call.answered");
    expect(kinds.filter((k) => k === "slots.offered")).toHaveLength(1);
    expect(kinds).toContain("slot.selected");
    expect(kinds).toContain("escalation.raised");
    expect(kinds).toContain("transfer.started");
    expect(kinds).toContain("transfer.connected");
    expect(kinds[kinds.length - 1]).toBe("call.ended");

    const lines = call.events
      .filter((e) => e.kind === "transcript.agent" || e.kind === "transcript.patient")
      .map((e) => e.text ?? "");
    console.log("AGENT LINES:", JSON.stringify(lines, null, 1));
    expect(lines.some((t) => t.includes("Am I speaking with Jordan Rivera"))).toBe(true);
    expect(lines.some((t) => t.includes("missed your appointment"))).toBe(true);
    expect(lines.some((t) => t.includes("Tomorrow at 2 PM with Dr. A. Chen"))).toBe(true);
    expect(lines.some((t) => t.includes("Tomorrow at 9 AM with Dr. A. Chen"))).toBe(true);
    expect(lines.some((t) => t.startsWith("Done — you're rebooked for"))).toBe(true);
    expect(lines.some((t) => t.includes("not able to give medical advice"))).toBe(true);
    expect(lines.some((t) => t.includes("Nurse Priya"))).toBe(true);

    const offered = call.events.find((e) => e.kind === "slots.offered");
    const offeredSlots = (offered?.data?.slots ?? []) as Slot[];
    expect(offeredSlots).toHaveLength(3);

    const selected = call.events.find((e) => e.kind === "slot.selected");
    expect(selected?.data?.slotId).toBe("slot-42-2");
    expect(clinicMinutesOf(fromLocalIso((offeredSlots.find((s) => s.id === "slot-42-2") as Slot).startsAtIso))).toBe(14 * 60);

    const booked = state.appointments.find((a) => a.slotId === "slot-42-2");
    expect(booked?.status).toBe("booked");
    expect(state.appointments.find((a) => a.id === "apt-001")?.status).toBe("missed");
    expect(state.availableSlots).toHaveLength(2);
    expect(state.availableSlots.map((s) => s.id)).not.toContain("slot-42-2");

    const sms = state.sms[0];
    expect(sms).toBeDefined();
    expect(sms.status).toBe("delivered");
    expect(sms.body).toContain("2:00 PM");
    expect(sms.body).toContain("Dr. A. Chen");

    const escalation = state.escalations[0];
    expect(escalation.category).toBe("medication");
    expect(escalation.status).toBe("connected");
    expect(escalation.handoff.patientName).toBe("Jordan Rivera");
    expect(escalation.handoff.mrn).toBe("MRN-004512");
    expect(escalation.handoff.appointmentSummary).toContain("rebooked for");
    expect(escalation.handoff.patientQuestion).toContain("medication");

    const transferStarted = call.events.find((e) => e.kind === "transfer.started");
    const transferData = transferStarted?.data as TransferToolConfig | undefined;
    expect(transferData?.type).toBe("transfer");
    expect(transferData?.transfer.from).toBe(call.fromE164);
    expect(transferData?.transfer.targets).toEqual([
      { name: "Winderval Medical Staff Line", to: defaultSettings.staffPhoneE164 },
    ]);
    expect((transferData?.transfer.warm_transfer_instructions ?? "").length).toBeGreaterThan(0);
  });
});
