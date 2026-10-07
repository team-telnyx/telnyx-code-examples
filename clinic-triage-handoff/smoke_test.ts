import { describe, it, expect } from "vitest";
import {
  TriageRouterV3,
  classifyIntent,
  Env,
} from "./src/index";

describe("TriageRouterV3", () => {
  it("should be a class", () => {
    expect(TriageRouterV3).toBeDefined();
    expect(typeof TriageRouterV3).toBe("function");
  });

  it("should have ensureSchema-equivalent lifecycle methods", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.onCall).toBe("function");
    expect(typeof proto.onGatherResult).toBe("function");
    expect(typeof proto.markTransferred).toBe("function");
  });

  it("should have logIntent and lastIntentFor for the routing log", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.logIntent).toBe("function");
    expect(typeof proto.lastIntentFor).toBe("function");
  });

  it("should have misroute queue methods", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.setPendingMisroute).toBe("function");
    expect(typeof proto.pendingMisrouteFor).toBe("function");
    expect(typeof proto.clearPendingMisroute).toBe("function");
  });

  it("should have routes() for the status page", () => {
    const proto = TriageRouterV3.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.routes).toBe("function");
  });
});

describe("classifyIntent", () => {
  it("returns a valid intent for billing keywords", () => {
    const fakeTelnyx = {
      ai: { openai: { chat: { createCompletion: async () => ({ choices: [] }) } } },
      calls: {},
    } as unknown as Env["TELNYX"];
    return classifyIntent(fakeTelnyx, "gpt-4o-mini", "I have a question about my bill").then(
      (result) => {
        expect(["billing", "clinical", "afterhours"]).toContain(result.intent);
        expect(typeof result.confidence).toBe("number");
      }
    );
  });

  it("falls back to clinical for clinical keywords when LLM is unavailable", () => {
    const fakeTelnyx = {
      ai: { openai: { chat: { createCompletion: async () => { throw new Error("LLM down"); } } } },
      calls: {},
    } as unknown as Env["TELNYX"];
    return classifyIntent(fakeTelnyx, "gpt-4o-mini", "I need to reschedule my doctor appointment").then(
      (result) => {
        expect(result.intent).toBe("clinical");
        expect(result.confidence).toBe(0.7);
      }
    );
  });

  it("falls back to afterhours when nothing matches", () => {
    const fakeTelnyx = {
      ai: { openai: { chat: { createCompletion: async () => { throw new Error("LLM down"); } } } },
      calls: {},
    } as unknown as Env["TELNYX"];
    return classifyIntent(fakeTelnyx, "gpt-4o-mini", "hello").then((result) => {
      expect(result.intent).toBe("afterhours");
    });
  });
});

describe("Default Export", () => {
  it("should export a default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
