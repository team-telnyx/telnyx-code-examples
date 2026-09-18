import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT, DEMO_CONVERSATION_ID, demoStages } from "../src/demo-script.js";
import { recordingSchema } from "../src/script.js";

describe("DEMO_SCRIPT", () => {
  it("is a valid recording under the ingest schema", () => {
    const parsed = recordingSchema.parse({
      conversation_id: DEMO_CONVERSATION_ID,
      steps: DEMO_SCRIPT,
    });
    expect(parsed.steps).toEqual(DEMO_SCRIPT);
  });

  it("opens with a customer message", () => {
    expect(DEMO_SCRIPT[0]?.role).toBe("user");
  });

  it("walks every pipeline stage in first-appearance order", () => {
    expect(demoStages()).toEqual([
      "intake",
      "verifying",
      "investigating",
      "resolving",
      "resolved",
    ]);
  });

  it("ends in the resolved stage", () => {
    const last = DEMO_SCRIPT.at(-1);
    expect(last?.stage).toBe("resolved");
  });

  it("uses sub-minute pacing on every step", () => {
    for (const step of DEMO_SCRIPT) {
      expect(step.delayMs).toBeGreaterThanOrEqual(0);
      expect(step.delayMs).toBeLessThanOrEqual(60_000);
    }
  });
});
