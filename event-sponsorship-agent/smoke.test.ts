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

  it("should inherit webSocket method from Agent base", () => {
    expect(typeof SponsorAgent.prototype.webSocket).toBe("function");
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

  it("should allow requests under the limit and deny at the limit", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string, options?: { type?: string }) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return options?.type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as any;

    const limiter = new SimpleRateLimiter(kv, 60, 3);

    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(false);

    // A different key has its own independent allowance
    expect((await limiter.check("other-caller")).allowed).toBe(true);
  });

  it("should not corrupt the counter when the store returns raw strings", async () => {
    // Regression: if the KV layer returns the count as a raw string, the
    // counter must still increment numerically ("2" + 1 must not become "21").
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as any;

    const limiter = new SimpleRateLimiter(kv, 60, 3);
    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(true);
    expect((await limiter.check("caller")).allowed).toBe(false);
  });

  it("should produce platform-legal KV keys for identifiers with special characters", async () => {
    // Regression: the platform KV rejects keys outside [a-zA-Z0-9\-_\/=.],
    // so phone numbers ("+1...") and colons must be sanitized.
    const keys: string[] = [];
    const kv = {
      get: async () => null,
      put: async (key: string) => {
        keys.push(key);
      },
    } as any;

    const limiter = new SimpleRateLimiter(kv, 60, 10);
    await limiter.check("+15550000001");
    await limiter.check("session:abc");

    const keyPattern = /^[a-zA-Z0-9\-_\/=.]+$/;
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toMatch(keyPattern);
  });

  it("should report a resetAt in the future when denied", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as any;

    const limiter = new SimpleRateLimiter(kv, 60, 1);
    await limiter.check("caller");
    const denied = await limiter.check("caller");

    expect(denied.allowed).toBe(false);
    expect(denied.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("Module exports", () => {
  it("should export default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });

  it("should serve /health", async () => {
    const mod = await import("./src/index");
    const res = await mod.default.fetch(new Request("http://localhost/health"), {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "event-sponsorship-agent" });
  });

  it("should route /api/chat through a per-session actor", async () => {
    const mod = await import("./src/index");

    const fakeActor = {
      handleChatMessage: async (params: { sessionId: string; text: string }) => ({
        success: true,
        message: `echo:${params.text}`,
      }),
    };
    const env = {
      SPONSOR_AGENT: {
        idFromName: (_name: string) => fakeActor,
      },
    } as any;

    const res = await mod.default.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "test-session", text: "hello" }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "echo:hello" });
  });

  it("should reject unsigned webhook posts", async () => {
    const mod = await import("./src/index");
    const env = {
      SPONSOR_AGENT: {
        idFromName: () => {
          throw new Error("actor should not be invoked");
        },
      },
    } as any;

    const res = await mod.default.fetch(
      new Request("http://localhost/webhook/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { payload: { from: "+15551234567", text: "hi" } } }),
      }),
      env,
    );

    expect(res.status).toBe(401);
  });
});
