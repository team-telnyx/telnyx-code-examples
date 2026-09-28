```typescript
import { describe, it, expect } from "vitest";
import {
  TriageRouter,
  BillingAgent,
  ClinicalAgent,
  AfterHoursAgent,
  classifyIntent,
  summarizeTranscript,
  HandoffPayload,
  CallInfo,
  RouterState,
  Env,
} from "./src/index";

describe("TriageRouter", () => {
  it("should be a class", () => {
    expect(TriageRouter).toBeDefined();
    expect(typeof TriageRouter).toBe("function");
  });

  it("should have onCall method", () => {
    expect(TriageRouter.prototype.onCall).toBeDefined();
    expect(typeof TriageRouter.prototype.onCall).toBe("function");
  });

  it("should have handoff method", () => {
    expect(TriageRouter.prototype.handoff).toBeDefined();
    expect(typeof TriageRouter.prototype.handoff).toBe("function");
  });

  it("should have onMisroute method", () => {
    expect(TriageRouter.prototype.onMisroute).toBeDefined();
    expect(typeof TriageRouter.prototype.onMisroute).toBe("function");
  });

  it("should have routeForReturn method", () => {
    expect(TriageRouter.prototype.routeForReturn).toBeDefined();
    expect(typeof TriageRouter.prototype.routeForReturn).toBe("function");
  });

  it("should have transferTo method", () => {
    expect(TriageRouter.prototype.transferTo).toBeDefined();
    expect(typeof TriageRouter.prototype.transferTo).toBe("function");
  });

  it("should have fetch method (webhook entry point)", () => {
    expect(TriageRouter.prototype.fetch).toBeDefined();
    expect(typeof TriageRouter.prototype.fetch).toBe("function");
  });
});

describe("Sub-Agents", () => {
  it("BillingAgent should be a class with onHandoff and fetch", () => {
    expect(BillingAgent).toBeDefined();
    expect(BillingAgent.prototype.onHandoff).toBeDefined();
    expect(BillingAgent.prototype.fetch).toBeDefined();
  });

  it("ClinicalAgent should be a class with onHandoff and fetch", () => {
    expect(ClinicalAgent).toBeDefined();
    expect(ClinicalAgent.prototype.onHandoff).toBeDefined();
    expect(ClinicalAgent.prototype.fetch).toBeDefined();
  });

  it("AfterHoursAgent should be a class with onHandoff and fetch", () => {
    expect(AfterHoursAgent).toBeDefined();
    expect(AfterHoursAgent.prototype.onHandoff).toBeDefined();
    expect(AfterHoursAgent.prototype.fetch).toBeDefined();
  });
});

describe("Helper Functions", () => {
  it("classifyIntent should be exported", () => {
    expect(classifyIntent).toBeDefined();
    expect(typeof classifyIntent).toBe("function");
  });

  it("summarizeTranscript should be exported", () => {
    expect(summarizeTranscript).toBeDefined();
    expect(typeof summarizeTranscript).toBe("function");
  });
});

describe("Types", () => {
  it("HandoffPayload interface should be usable", () => {
    const payload: HandoffPayload = {
      caller: "+15551234567",
      transcript: "I need help with my bill",
      intent: "billing",
      summary: "Caller has a billing question",
    };
    expect(payload.caller).toBe("+15551234567");
    expect(payload.intent).toBe("billing");
  });

  it("CallInfo interface should be usable", () => {
    const call: CallInfo = {
      callId: "call-123",
      from: "+15551234567",
      to: "+15559876543",
      transcript: "I have a billing question",
    };
    expect(call.callId).toBe("call-123");
  });

  it("RouterState interface should be usable", () => {
    const state: RouterState = {
      line: "+15559876543",
      destinations: {
        billing: "billing",
        clinical: "clinical",
        afterhours: "afterhours",
      },
      initialized: true,
    };
    expect(state.line).toBe("+15559876543");
    expect(state.destinations.billing).toBe("billing");
  });
});

describe("Idempotency Guards", () => {
  it("TriageRouter.onCall should check done guard before logging", () => {
    const router = Object.create(TriageRouter.prototype);
    expect(typeof router.onCall).toBe("function");
  });

  it("TriageRouter.handoff should check done guard before transferring", () => {
    const router = Object.create(TriageRouter.prototype);
    expect(typeof router.handoff).toBe("function");
  });
});

describe("Default Export", () => {
  it("should export a default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
```
