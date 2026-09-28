```typescript
import { describe, it, expect } from "vitest";
import { OrderAgent } from "./src/index";

describe("OrderAgent", () => {
  it("should be a class with the expected methods", () => {
    expect(typeof OrderAgent).toBe("function");
    const proto = OrderAgent.prototype;
    expect(typeof proto.linkOrder).toBe("function");
    expect(typeof proto.onCarrier).toBe("function");
    expect(typeof proto.onInboundMessage).toBe("function");
    expect(typeof proto.notifyDelay).toBe("function");
    expect(typeof proto.answerSms).toBe("function");
  });

  it("should have initialState returning CustomerState shape", () => {
    const agent = Object.create(OrderAgent.prototype);
    const state = OrderAgent.prototype.initialState.call(agent);
    expect(state).toHaveProperty("customer");
    expect(state).toHaveProperty("linked");
    expect(state).toHaveProperty("lastNotified");
    expect(Array.isArray(state.linked)).toBe(true);
  });

  it("should classify carrier event statuses correctly", () => {
    const agent = Object.create(OrderAgent.prototype);
    expect(agent.statusLabel("shipped")).toBe("shipped");
    expect(agent.statusLabel("delayed")).toBe("delayed");
    expect(agent.statusLabel("delivered")).toBe("delivered");
  });

  it("should produce demo interpretations for each status", () => {
    const agent = Object.create(OrderAgent.prototype);
    const shipped = agent.demoInterpretation({ orderId: "1", status: "shipped", eta: "Tue", ts: 0 });
    expect(shipped).toContain("On the way");
    const delayed = agent.demoInterpretation({ orderId: "1", status: "delayed", eta: "Fri", ts: 0 });
    expect(delayed).toContain("Delayed");
    const delivered = agent.demoInterpretation({ orderId: "1", status: "delivered", eta: "", ts: 0 });
    expect(delivered).toContain("Delivered");
  });
});
```
