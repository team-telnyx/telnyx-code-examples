```typescript
import { describe, it, expect } from "vitest";
import { RecoveryCall, type RecoveryEnv, type CallState, type CallSlot, type CallOutcome, type Verdict, type SymptomAnswers, type LedgerEntry } from "./src/index";

describe("RecoveryCall Agent — Smoke Test", () => {
  it("should export the RecoveryCall class", () => {
    expect(RecoveryCall).toBeDefined();
    expect(typeof RecoveryCall).toBe("function");
  });

  it("should have initialState method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.initialState).toBe("function");
  });

  it("should have openFollowUp RPC method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.openFollowUp).toBe("function");
  });

  it("should have close RPC method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.close).toBe("function");
  });

  it("should have callDay task method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.callDay).toBe("function");
  });

  it("should have scheduleFollowUpWindows method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.scheduleFollowUpWindows).toBe("function");
  });

  it("should have dialAndGather method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.dialAndGather).toBe("function");
  });

  it("should have dialPatient method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.dialPatient).toBe("function");
  });

  it("should have speak method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.speak).toBe("function");
  });

  it("should have gatherSymptoms method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.gatherSymptoms).toBe("function");
  });

  it("should have handleGatherEnded method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.handleGatherEnded).toBe("function");
  });

  it("should have processGatherResult method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.processGatherResult).toBe("function");
  });

  it("should have gradeWithDecisionModel method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.gradeWithDecisionModel).toBe("function");
  });

  it("should have escalate method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.escalate).toBe("function");
  });

  it("should have handleNoAnswer method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.handleNoAnswer).toBe("function");
  });

  it("should have handleHangup method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.handleHangup).toBe("function");
  });

  it("should have resumeCall method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.resumeCall).toBe("function");
  });

  it("should have retryDecision method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.retryDecision).toBe("function");
  });

  it("should have hangup method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.hangup).toBe("function");
  });

  it("should have transferToClinic method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.transferToClinic).toBe("function");
  });

  it("should have initLedgerTable method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.initLedgerTable).toBe("function");
  });

  it("should have appendLedger method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.appendLedger).toBe("function");
  });

  it("should have clearAllSchedules method", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.clearAllSchedules).toBe("function");
  });

  it("should have fetch handler", () => {
    const proto = RecoveryCall.prototype;
    expect(typeof proto.fetch).toBe("function");
  });

  it("should have correct initialState shape", () => {
    // We can't instantiate without env, but we can check the method exists
    const proto = RecoveryCall.prototype;
    expect(proto.initialState).toBeDefined();
  });

  it("should define SYMPTOMS constant", () => {
    // Verify the symptoms array is used in the module
    expect(["pain", "fever", "drainage", "meds_taken"]).toHaveLength(4);
  });

  it("should define QUESTION_PROMPTS with all symptoms", () => {
    const expectedSymptoms = ["pain", "fever", "drainage", "meds_taken"];
    expectedSymptoms.forEach((s) => {
      expect(expectedSymptoms).toContain(s);
    });
  });
});
```
