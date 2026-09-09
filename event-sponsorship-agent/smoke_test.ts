import { describe, it, expect } from "vitest";
import { SponsorAgent, SimpleRateLimiter } from "./src/index";

describe("SponsorAgent", () => {
  it("should be a class", () => {
    expect(SponsorAgent).toBeDefined();
    expect(typeof SponsorAgent).toBe("function");
  });

  it("should have handleInboundMessage method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.handleInboundMessage).toBe("function");
  });

  it("should have handleInboundCall method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.handleInboundCall).toBe("function");
  });

  it("should have handleChatMessage method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.handleChatMessage).toBe("function");
  });

  it("should have scheduleFollowUp method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.scheduleFollowUp).toBe("function");
  });

  it("should have sendFollowUp method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.sendFollowUp).toBe("function");
  });

  it("should have generateAttributionReport method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.generateAttributionReport).toBe("function");
  });

  it("should have webSocket method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.webSocket).toBe("function");
  });

  it("should have alarm method", () => {
    const proto = SponsorAgent.prototype;
    expect(typeof proto.alarm).toBe("function");
  });
});

describe("SimpleRateLimiter", () => {
  it("should be a class", () => {
    expect(SimpleRateLimiter).toBeDefined();
    expect(typeof SimpleRateLimiter).toBe("function");
  });

  it("should have check method", () => {
    const proto = SimpleRateLimiter.prototype;
    expect(typeof proto.check).toBe("function");
  });
});

describe("Module exports", () => {
  it("should export default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
