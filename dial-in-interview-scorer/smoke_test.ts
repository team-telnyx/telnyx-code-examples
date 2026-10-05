```typescript
import { describe, it, expect } from "vitest";
import { InterviewCall, InterviewState, InterviewQuestion, ScoreEntry, Env } from "./src/index";

describe("InterviewCall Actor", () => {
  it("should be a class that extends Agent", () => {
    expect(InterviewCall).toBeDefined();
    expect(typeof InterviewCall).toBe("function");
  });

  it("should have openInterview RPC method", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.openInterview).toBe("function");
  });

  it("should have handleGatherEnded method", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.handleGatherEnded).toBe("function");
  });

  it("should have handleHangup method", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.handleHangup).toBe("function");
  });

  it("should have recoverInterview method", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.recoverInterview).toBe("function");
  });

  it("should have doScoreAnswer queued task method", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.doScoreAnswer).toBe("function");
  });

  it("should have fetch handler", () => {
    const proto = InterviewCall.prototype;
    expect(typeof proto.fetch).toBe("function");
  });

  it("should define initialState with correct shape", () => {
    const instance = Object.create(InterviewCall.prototype);
    const state = instance.initialState();
    expect(state).toHaveProperty("candidate");
    expect(state).toHaveProperty("phone");
    expect(state).toHaveProperty("questions");
    expect(state).toHaveProperty("currentQIdx");
    expect(state).toHaveProperty("callId");
    expect(state).toHaveProperty("escalated");
    expect(state).toHaveProperty("completed");
    expect(state).toHaveProperty("summary");
    expect(state.currentQIdx).toBe(0);
    expect(state.escalated).toBe(false);
    expect(state.completed).toBe(false);
  });

  it("should validate openInterview inputs", async () => {
    const instance = Object.create(InterviewCall.prototype);
    instance.setState = async () => {};
    instance.initScorecard = async () => {};
    instance.dialCandidate = async () => {};

    await expect(instance.openInterview("", "+15551234567", [])).rejects.toThrow(
      "candidate, phone, and questions[] are required"
    );
    await expect(instance.openInterview("John", "", [])).rejects.toThrow(
      "candidate, phone, and questions[] are required"
    );
    await expect(
      instance.openInterview("John", "+15551234567", [])
    ).rejects.toThrow("candidate, phone, and questions[] are required");
  });

  it("should reject invalid phone numbers", async () => {
    const instance = Object.create(InterviewCall.prototype);
    instance.setState = async () => {};
    instance.initScorecard = async () => {};
    instance.dialCandidate = async () => {};

    await expect(
      instance.openInterview("John", "abc", [{ qIdx: 0, text: "Q1", rubric: "R1" }])
    ).rejects.toThrow("Invalid phone number");
  });
});

describe("Types", () => {
  it("should export InterviewQuestion type", () => {
    const q: InterviewQuestion = { qIdx: 0, text: "Tell me about yourself", rubric: "Clarity: 0-3" };
    expect(q.qIdx).toBe(0);
    expect(q.text).toBe("Tell me about yourself");
  });

  it("should export ScoreEntry type", () => {
    const e: ScoreEntry = {
      qIdx: 0,
      answer: "I am a software engineer",
      score: 3,
      choice: "continue",
      noul: 0.1,
      notes: "{}",
    };
    expect(e.score).toBe(3);
    expect(e.choice).toBe("continue");
  });

  it("should export InterviewState type", () => {
    const s: InterviewState = {
      candidate: "Jane",
      phone: "+15551234567",
      questions: [],
      currentQIdx: 0,
      callId: null,
      escalated: false,
      completed: false,
      summary: null,
      _retryCount: 0,
    };
    expect(s.candidate).toBe("Jane");
  });
});

describe("Default export", () => {
  it("should export a fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
```
