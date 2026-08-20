import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizePhoneE164, actorNameForCustomer } from "../src/types.js";

const { mockState, mockMessages, mockCalls, mockFns, insertedEventIds } = vi.hoisted(() => {
  const insertedEventIds = new Set<string>();
  return {
    mockState: {} as Record<string, unknown>,
    mockMessages: [] as Array<{ role: string; content: string }>,
    mockCalls: {} as Record<string, unknown[]>,
    insertedEventIds,
    mockFns: {
      getState: vi.fn(() => Promise.resolve({ ...mockState })),
      setState: vi.fn((patch: Record<string, unknown>) => {
        Object.assign(mockState, patch);
        return Promise.resolve({ ...mockState });
      }),
      queue: vi.fn((_method: string) => Promise.resolve("queued")),
      schedule: vi.fn((_delay: number, _method: string) => Promise.resolve("scheduled")),
      messagesAdd: vi.fn(async (role: string, content: string) => {
        mockMessages.push({ role, content });
      }),
      toLangChain: vi.fn(async () =>
        mockMessages.map((m) => ({ role: m.role, content: m.content })),
      ),
      messagesLast: vi.fn(async () => mockMessages[mockMessages.length - 1] ?? null),
      sqlExec: vi.fn((query?: string, ...params: unknown[]) => {
        if (query && query.startsWith("INSERT INTO webhook_events")) {
          const eventId = params[0] as string;
          if (insertedEventIds.has(eventId)) {
            throw new Error("UNIQUE constraint failed: webhook_events.event_id");
          }
          insertedEventIds.add(eventId);
        }
        return { toArray: () => [] };
      }),
    },
  };
});

vi.mock("@telnyx/edge-runtime", () => {
  class MockAgent {
    env: Record<string, unknown>;
    ctx: { storage: { sql: { exec: typeof mockFns.sqlExec } } };

    constructor(_ctx: unknown, env: Record<string, unknown>) {
      this.env = env;
      this.ctx = { storage: { sql: { exec: mockFns.sqlExec } } };
    }

    protected getState() {
      return mockFns.getState();
    }
    protected setState(patch: Record<string, unknown>) {
      return mockFns.setState(patch);
    }
    protected queue(method: string) {
      (mockCalls.queue ??= []).push(method);
      return mockFns.queue(method);
    }
    protected schedule(delay: number, method: string) {
      (mockCalls.schedule ??= []).push({ delay, method });
      return mockFns.schedule(delay, method);
    }
    protected messages = {
      add: mockFns.messagesAdd,
      toLangChain: mockFns.toLangChain,
      last: mockFns.messagesLast,
      all: vi.fn(async () => [...mockMessages]),
    };
  }
  return { Agent: MockAgent, StatefulActor: MockAgent };
});

const mockGraphOutput = vi.hoisted(() => ({
  replyText: "Your order is shipped.",
  intentLabel: "order",
}));

vi.mock("../src/graph.js", () => ({
  buildGraph: vi.fn(() => ({
    invoke: vi.fn(async () => ({
      replyText: mockGraphOutput.replyText,
      intentLabel: mockGraphOutput.intentLabel,
    })),
  })),
}));

const { CustomerAgent } = await import("../src/customer-agent.js");
import type { Env, CustomerState } from "../src/types.js";

function freshInitialState(): CustomerState {
  return {
    phone_e164: "",
    to: "+16282564467",
    name: "Anusha",
    salesforce_id: "mock-anusha-salesforce-id",
    preferred_channel: "sms",
    proactive_consent: true,
    open_tickets: [],
    shipments: [],
    latest_lead: null,
    escalation_pending: null,
    active_schedule_ids: [],
    history: [],
    turn: 0,
    queuedTurn: 0,
    processingTurn: 0,
    lastSentTurn: 0,
    pendingOutbound: null,
    lastIntent: "unknown",
    at: 0,
  };
}

function resetMocks() {
  for (const k of Object.keys(mockState)) delete mockState[k];
  const initial = freshInitialState();
  Object.assign(mockState, initial);
  mockMessages.length = 0;
  for (const k of Object.keys(mockCalls)) delete mockCalls[k];
  insertedEventIds.clear();
  mockGraphOutput.replyText = "Your order is shipped.";
  mockGraphOutput.intentLabel = "order";
  mockFns.getState.mockClear();
  mockFns.setState.mockClear();
  mockFns.queue.mockClear();
  mockFns.schedule.mockClear();
  mockFns.messagesAdd.mockClear();
  mockFns.toLangChain.mockClear();
  mockFns.messagesLast.mockClear();
  mockFns.sqlExec.mockClear();
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SMS_TRANSPORT: "demo",
    MODEL: "zai-org/GLM-5.2",
    ...overrides,
  } as Env;
}

function makeAgent(env?: Env): InstanceType<typeof CustomerAgent> {
  resetMocks();
  return new CustomerAgent({ id: "test" } as never, env ?? makeEnv()) as InstanceType<typeof CustomerAgent>;
}

describe("CustomerAgent initial state", () => {
  beforeEach(() => resetMocks());

  it("seeds the demo customer Anusha with the mock salesforce_id", () => {
    const agent = makeAgent();
    const initial = agent["initialState"]();

    expect(initial.name).toBe("Anusha");
    expect(initial.salesforce_id).toBe("mock-anusha-salesforce-id");
    expect(initial.preferred_channel).toBe("sms");
    expect(initial.proactive_consent).toBe(true);
    expect(initial.open_tickets).toEqual([]);
    expect(initial.shipments).toEqual([]);
    expect(initial.escalation_pending).toBeNull();
    expect(initial.active_schedule_ids).toEqual([]);
    expect(initial.history).toEqual([]);
  });

  it("uses env-supplied customer name and salesforce_id when provided", () => {
    const agent = makeAgent(
      makeEnv({
        DEMO_CUSTOMER_NAME: "Test Person",
        DEMO_CUSTOMER_SALESFORCE_ID: "mock-test-sfid",
      }),
    );
    const initial = agent["initialState"]();

    expect(initial.name).toBe("Test Person");
    expect(initial.salesforce_id).toBe("mock-test-sfid");
  });
});

describe("CustomerAgent.receive()", () => {
  beforeEach(() => resetMocks());

  it("sets phone_e164 to the inbound phone, bumps turn, and queues process", async () => {
    const agent = makeAgent();
    await agent.receive({
      text: "where is my order?",
      from: "+15550001111",
      to: "+15557654321",
      eventId: "evt-1",
    });

    expect(mockMessages).toContainEqual({ role: "user", content: "where is my order?" });
    expect(mockState.turn).toBe(1);
    expect(mockState.queuedTurn).toBe(1);
    expect(mockState.phone_e164).toBe("+15550001111");
    expect(mockState.to).toBe("+15557654321");
    expect(mockCalls.queue).toEqual(["process"]);
  });

  it("appends the inbound message to durable state.history", async () => {
    const agent = makeAgent();
    await agent.receive({
      text: "hi there",
      from: "+15550001111",
      to: "+15557654321",
      eventId: "evt-1",
    });

    const history = mockState.history as Array<{ role: string; content: string; at: number }>;
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("hi there");
    expect(typeof history[0].at).toBe("number");
  });

  it("deduplicates by eventId — second receive with same eventId is a no-op", async () => {
    const agent = makeAgent();
    await agent.receive({ text: "first", from: "+15550001111", to: "+15557654321", eventId: "evt-dup" });
    await agent.receive({ text: "second", from: "+15550001111", to: "+15557654321", eventId: "evt-dup" });

    expect(mockMessages).toHaveLength(1);
    expect(mockMessages[0].content).toBe("first");
    expect(mockState.turn).toBe(1);
  });

  it("routes two inbound from the same phone into the same actor (state accumulates)", async () => {
    const agent = makeAgent();
    await agent.receive({ text: "first", from: "+15550001111", to: "+15557654321", eventId: "evt-1" });
    await agent.receive({ text: "second", from: "+15550001111", to: "+15557654321", eventId: "evt-2" });

    expect(mockState.phone_e164).toBe("+15550001111");
    expect(mockState.turn).toBe(2);
    expect(mockState.queuedTurn).toBe(2);
    expect(mockState.name).toBe("Anusha");
    expect(mockState.salesforce_id).toBe("mock-anusha-salesforce-id");
  });

  it("logs a phone_mismatch phase when an inbound phone differs from the actor's bound customer", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.turn = 5;

    await agent.receive({
      text: "spoof?",
      from: "+15559990000",
      to: "+15557654321",
      eventId: "evt-mismatch",
    });

    const phases = (mockFns.sqlExec.mock.calls as Array<[string, ...unknown[]]>)
      .filter(([q]) => typeof q === "string" && q.startsWith("INSERT INTO process_log"))
      .map(([, , phase]) => phase);
    expect(phases).toContain("phone_mismatch");
  });
});

describe("CustomerAgent.process()", () => {
  beforeEach(() => resetMocks());

  it("returns immediately when queuedTurn <= lastSentTurn", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 2;
    mockState.queuedTurn = 2;
    mockState.lastSentTurn = 2;

    await agent.process();

    expect(mockMessages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("runs graph, appends assistant reply to history, sets lastSentTurn", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 1;
    mockState.queuedTurn = 1;
    mockState.lastSentTurn = 0;
    mockMessages.push({ role: "user", content: "where is my order ORD-10042?" });

    await agent.process();

    expect(mockMessages).toContainEqual({ role: "assistant", content: "Your order is shipped." });
    expect(mockState.pendingOutbound).toBeNull();
    expect(mockState.lastSentTurn).toBe(1);
    expect(mockState.lastIntent).toBe("order");

    const history = mockState.history as Array<{ role: string; content: string }>;
    expect(history[history.length - 1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "Your order is shipped." }),
    );
  });

  it("schedules a 24h nudge", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 1;
    mockState.queuedTurn = 1;
    mockState.lastSentTurn = 0;
    mockMessages.push({ role: "user", content: "hi" });

    await agent.process();

    expect(mockCalls.schedule).toContainEqual({ delay: 86400, method: "nudge" });
  });

  it("coalesces two inbound before first process into one reply for the latest turn", async () => {
    const agent = makeAgent();
    await agent.receive({ text: "first", from: "+15550001111", to: "+15557654321", eventId: "evt-1" });
    await agent.receive({ text: "second", from: "+15550001111", to: "+15557654321", eventId: "evt-2" });

    expect(mockState.queuedTurn).toBe(2);
    expect(mockMessages).toHaveLength(2);

    await agent.process();

    expect(mockState.lastSentTurn).toBe(2);
    expect(mockMessages.filter((m) => m.role === "assistant")).toHaveLength(1);

    await agent.process();
    expect(mockMessages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("re-queues process when a newer turn arrives during processing", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 3;
    mockState.queuedTurn = 3;
    mockState.lastSentTurn = 0;
    mockMessages.push({ role: "user", content: "msg" });

    let callCount = 0;
    const originalGetState = mockFns.getState;
    mockFns.getState = vi.fn(() => {
      callCount++;
      const result = { ...mockState };
      if (callCount >= 2) {
        result.queuedTurn = (mockState.queuedTurn as number) + 1;
      }
      return Promise.resolve(result);
    });

    mockCalls.queue = [];
    await agent.process();

    expect(mockState.lastSentTurn).toBe(3);
    expect(mockCalls.queue).toContain("process");

    mockFns.getState = originalGetState;
  });
});

describe("CustomerAgent.nudge()", () => {
  beforeEach(() => resetMocks());

  it("skips when last message is assistant (customer didn't reply)", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 1;
    mockMessages.push({ role: "user", content: "hi" });
    mockMessages.push({ role: "assistant", content: "hello" });

    await agent.nudge();

    expect(mockMessages).toHaveLength(2);
  });

  it("completes without error when last message is user (customer waiting)", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 1;
    mockMessages.push({ role: "user", content: "where is my order?" });

    await agent.nudge();

    expect(true).toBe(true);
  });
});

describe("CustomerAgent.ingestSalesforceUpdate()", () => {
  beforeEach(() => resetMocks());

  it("updates durable shipment state and records a proactive mocked SMS", async () => {
    const agent = makeAgent();
    mockState.to = "+16282564467";

    await agent.ingestSalesforceUpdate({
      phone_e164: "+14157986793",
      order_id: "ORD-10043",
      salesforce_id: "SHP-002",
      status: "delayed",
      estimated_delivery: "Wednesday",
    });

    expect(mockState.phone_e164).toBe("+14157986793");
    expect(mockState.shipments).toEqual([
      expect.objectContaining({
        id: "ORD-10043",
        salesforce_id: "SHP-002",
        status: "delayed",
        eta: "Wednesday",
      }),
    ]);
    expect(mockMessages).toContainEqual({
      role: "assistant",
      content: "Shipment ORD-10043 update: delayed, ETA Wednesday.",
    });

    const processPhases = (mockFns.sqlExec.mock.calls as Array<[string, ...unknown[]]>)
      .filter(([q]) => typeof q === "string" && q.startsWith("INSERT INTO process_log"))
      .map(([, , phase]) => phase);
    expect(processPhases).toContain("salesforce_sms_mocked");
  });
});

describe("CustomerAgent.updateLeadFromAgent()", () => {
  beforeEach(() => resetMocks());

  it("updates durable latest_lead state and records a mocked SMS", async () => {
    const agent = makeAgent();
    mockState.to = "+16282564467";

    const result = await agent.updateLeadFromAgent({
      phone_e164: "+14157986793",
      value: "Updated by test",
    });

    expect(result).toMatchObject({
      lead_id: "00Q-demo-latest",
      field: "reMQL_Source_Detail__c",
      value: "Updated by test",
    });
    expect(mockState.phone_e164).toBe("+14157986793");
    expect(mockState.salesforce_id).toBe("00Q-demo-latest");
    expect(mockState.latest_lead).toEqual(expect.objectContaining({
      id: "00Q-demo-latest",
      demo_note: "Updated by test",
    }));
    expect(mockMessages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: expect.stringContaining("I updated the CustomerAgent Demo record in Salesforce"),
    }));

    const processPhases = (mockFns.sqlExec.mock.calls as Array<[string, ...unknown[]]>)
      .filter(([q]) => typeof q === "string" && q.startsWith("INSERT INTO process_log"))
      .map(([, , phase]) => phase);
    expect(processPhases).toContain("salesforce_lead_sms_mocked");
    expect(processPhases).toContain("salesforce_lead_updated");
  });
});

describe("CustomerAgent human escalation", () => {
  beforeEach(() => resetMocks());

  it("waits for a human and then resumes with a resolved ticket", async () => {
    const agent = makeAgent();

    const result = await agent.requestHumanEscalation({
      phone_e164: "+14157986793",
      reason: "Needs authorization",
    });

    expect(result.ticket_id).toMatch(/^hitl-/);
    expect(mockState.escalation_pending).toEqual(expect.objectContaining({
      reason: "Needs authorization",
      ticket_id: result.ticket_id,
    }));
    expect(mockState.open_tickets).toEqual([
      expect.objectContaining({ id: result.ticket_id, status: "waiting_for_human" }),
    ]);

    await agent.resumeHumanEscalation({
      phone_e164: "+14157986793",
      reply_text: "Authorized by support",
    });

    expect(mockState.escalation_pending).toBeNull();
    expect(mockState.open_tickets).toEqual([
      expect.objectContaining({ id: result.ticket_id, status: "resolved" }),
    ]);
    expect(mockMessages.at(-1)).toEqual({
      role: "assistant",
      content: "Good news, Anusha. A specialist approved the expedited onboarding package. Authorized by support",
    });
  });
});

describe("CustomerAgent schedule and voice hooks", () => {
  beforeEach(() => resetMocks());

  it("creates a self-wake follow-up schedule on the actor", async () => {
    const agent = makeAgent();

    const result = await agent.scheduleLeadFollowup({
      phone_e164: "+14157986793",
      delay_seconds: 5,
      reason: "demo timer",
    });

    expect(result).toEqual({ schedule_id: "scheduled", delay_seconds: 5 });
    expect(mockCalls.schedule).toContainEqual({ delay: 5, method: "sendScheduledLeadFollowup" });
    expect(mockState.active_schedule_ids).toEqual(["scheduled"]);
  });

  it("records a call and sends a mocked SMS follow-up on hangup", async () => {
    const agent = makeAgent();

    const started = await agent.onCall({
      from: "+14157986793",
      to: "+16282564467",
      call_control_id: "call-1",
    });
    await agent.onCallEnded({
      from: "+14157986793",
      to: "+16282564467",
      call_control_id: "call-1",
    });

    expect(started.prompt).toContain("CustomerAgent");
    expect(started.prompt).toContain("onboarding package status");
    expect(mockState.preferred_channel).toBe("sms");
    expect(mockMessages.at(-1)).toEqual({
      role: "assistant",
      content: "Thanks for calling, Anusha. I'll keep this thread updated with your onboarding status. You can reply here any time.",
    });
  });
});

describe("CustomerAgent.getContext()", () => {
  beforeEach(() => resetMocks());

  it("returns the full customer state plus durable history", async () => {
    const agent = makeAgent();
    mockState.phone_e164 = "+15550001111";
    mockState.to = "+15557654321";
    mockState.turn = 2;
    mockState.queuedTurn = 2;
    mockState.processingTurn = 0;
    mockState.lastSentTurn = 2;
    mockState.lastIntent = "order";
    mockState.history = [
      { role: "user", content: "first", at: 1 },
      { role: "assistant", content: "hi", at: 2 },
    ];

    const ctx = await agent.getContext();

    expect(ctx.customer.phone_e164).toBe("+15550001111");
    expect(ctx.customer.name).toBe("Anusha");
    expect(ctx.customer.salesforce_id).toBe("mock-anusha-salesforce-id");
    expect(ctx.customer.preferred_channel).toBe("sms");
    expect(ctx.customer.open_tickets).toEqual([]);
    expect(ctx.customer.shipments).toEqual([]);
    expect(ctx.customer.escalation_pending).toBeNull();
    expect(ctx.customer.active_schedule_ids).toEqual([]);
    expect(ctx.customer.turn).toBe(2);
    expect(ctx.customer.lastIntent).toBe("order");
    expect(ctx.history).toEqual([
      { role: "user", content: "first", at: 1 },
      { role: "assistant", content: "hi", at: 2 },
    ]);
  });

  it("reports empty history for a freshly-seeded actor before any receive", async () => {
    const agent = makeAgent();
    const ctx = await agent.getContext();

    expect(ctx.customer.name).toBe("Anusha");
    expect(ctx.customer.salesforce_id).toBe("mock-anusha-salesforce-id");
    expect(ctx.history).toEqual([]);
    expect(ctx.customer.turn).toBe(0);
  });
});

describe("phone normalization and actor naming", () => {
  it("normalizePhoneE164 accepts valid E.164 with +", () => {
    expect(normalizePhoneE164("+15551234567")).toBe("+15551234567");
  });

  it("normalizePhoneE164 rejects phones missing the +", () => {
    expect(normalizePhoneE164("15551234567")).toBe("");
    expect(normalizePhoneE164("5551234567", "fallback")).toBe("fallback");
  });

  it("normalizePhoneE164 rejects non-string input", () => {
    expect(normalizePhoneE164(15551234567)).toBe("");
    expect(normalizePhoneE164(null)).toBe("");
    expect(normalizePhoneE164(undefined)).toBe("");
  });

  it("normalizePhoneE164 trims whitespace", () => {
    expect(normalizePhoneE164("  +15551234567  ")).toBe("+15551234567");
  });

  it("actorNameForCustomer strips non-digits and prefixes customer-", () => {
    expect(actorNameForCustomer("+15551234567")).toBe("customer-15551234567");
    expect(actorNameForCustomer("+1 (555) 123-4567")).toBe("customer-15551234567");
  });

  it("actorNameForCustomer returns empty string for invalid input", () => {
    expect(actorNameForCustomer("")).toBe("");
    expect(actorNameForCustomer("abc")).toBe("");
  });
});
