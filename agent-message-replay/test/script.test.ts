import { describe, expect, it } from "vitest";
import { parseRecording } from "../src/script.js";

const validRecording = {
  conversation_id: "support-48211",
  steps: [
    { role: "user", content: "I was charged twice.", delayMs: 500 },
    { role: "assistant", content: "I can help with that.", delayMs: 1200, stage: "intake" },
  ],
};

describe("parseRecording", () => {
  it("accepts a well-formed recording", () => {
    const parsed = parseRecording(validRecording);
    expect(parsed.conversation_id).toBe("support-48211");
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.replace).toBe(true);
  });

  it("applies the default delay and drops an out-of-range one", () => {
    const parsed = parseRecording({
      conversation_id: "demo",
      steps: [{ role: "user", content: "hello" }],
    });
    expect(parsed.steps[0]?.delayMs).toBe(1000);
  });

  it("rejects an empty conversation id", () => {
    expect(() =>
      parseRecording({ conversation_id: "", steps: validRecording.steps }),
    ).toThrow();
  });

  it("rejects ids with characters outside [a-zA-Z0-9_-]", () => {
    expect(() =>
      parseRecording({ conversation_id: "bad/id!", steps: validRecording.steps }),
    ).toThrow();
  });

  it("rejects unknown roles", () => {
    expect(() =>
      parseRecording({
        conversation_id: "demo",
        steps: [{ role: "moderator", content: "hi", delayMs: 100 }],
      }),
    ).toThrow();
  });

  it("rejects delays above the 60s ceiling", () => {
    expect(() =>
      parseRecording({
        conversation_id: "demo",
        steps: [{ role: "user", content: "hi", delayMs: 61_000 }],
      }),
    ).toThrow();
  });

  it("rejects empty step lists", () => {
    expect(() => parseRecording({ conversation_id: "demo", steps: [] })).toThrow();
  });

  it("rejects step lists above the 200-step cap", () => {
    const steps = Array.from({ length: 201 }, () => ({
      role: "user" as const,
      content: "x",
      delayMs: 100,
    }));
    expect(() => parseRecording({ conversation_id: "demo", steps })).toThrow();
  });
});
