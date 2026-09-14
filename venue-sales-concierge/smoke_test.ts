import { describe, it, expect } from "vitest";
import { ConciergeAgent, env } from "./src/index";

describe("Venue Sales Concierge", () => {
  it("should export ConciergeAgent class", () => {
    expect(ConciergeAgent).toBeDefined();
    expect(typeof ConciergeAgent).toBe("function");
  });

  it("should export env", () => {
    expect(env).toBeDefined();
  });

  it("ConciergeAgent should have initialState method", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.initialState).toBe("function");
  });

  it("ConciergeAgent should have fetch method", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.fetch).toBe("function");
  });

  it("ConciergeAgent should have followUpCall task handler", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.followUpCall).toBe("function");
  });

  it("ConciergeAgent should have checkAvailability helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.checkAvailability).toBe("function");
  });

  it("ConciergeAgent should have getFaqContext helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.getFaqContext).toBe("function");
  });

  it("ConciergeAgent should have generateResponse helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.generateResponse).toBe("function");
  });

  it("ConciergeAgent should have sendSms helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.sendSms).toBe("function");
  });

  it("ConciergeAgent should have demoResponse helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.demoResponse).toBe("function");
  });

  it("ConciergeAgent should have maskPhone helper", () => {
    const proto = ConciergeAgent.prototype;
    expect(typeof proto.maskPhone).toBe("function");
  });

  it("maskPhone should mask phone numbers correctly", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const masked = agent.maskPhone("+15551234567");
    expect(masked).toContain("***");
    expect(masked).not.toContain("1234567");
  });

  it("initialState should return correct default state", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const state = agent.initialState();
    expect(state).toEqual({
      phone: "",
      qualified: false,
      siteVisitBooked: false,
      lastActive: expect.any(Number),
      inquiryCount: 0,
    });
  });

  it("demoResponse should handle availability queries", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("check availability", "", "2 of 3 dates available", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("availability");
  });

  it("demoResponse should handle pricing queries", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("what is the cost", "", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("pricing");
  });

  it("demoResponse should handle proposal requests", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("I need a proposal", "", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("proposal");
  });

  it("demoResponse should handle site visit requests", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("book a site visit", "", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("site visit");
  });

  it("demoResponse should handle capacity questions", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("what is the capacity", "Our ballroom holds 500 guests", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("500");
  });

  it("demoResponse should handle parking/catering/AV/accessibility questions", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("parking and catering", "We have 200 parking spaces", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("200");
  });

  it("demoResponse should return default greeting for unknown queries", () => {
    const agent = Object.create(ConciergeAgent.prototype);
    const response = agent.demoResponse("hello there", "", "", {
      phone: "+15551234567",
      qualified: false,
      siteVisitBooked: false,
      lastActive: Date.now(),
      inquiryCount: 1,
    });
    expect(response).toContain("DEMO MODE");
    expect(response).toContain("venue");
  });
});
</arg_key></tool_call>
