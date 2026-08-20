import { describe, it, expect, vi, beforeAll } from "vitest";
import { Webhook } from "svix";
import {
  sendAgentMail,
  verifyAgentMailWebhook,
  parseAgentMailInbound,
  agentMailApiKey,
  agentMailInbox,
  agentMailWebhookSecret,
} from "../src/agent-mail.js";
import type { Env, AgentMailInboundPayload } from "../src/types.js";

const TEST_SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LWZvci1zdml4LXNpZ25pbmd"; 
const ALT_SECRET = "whsec_YWx0ZXJuYXRlLXNlY3JldC1mb3Itc3ZpeC10ZXN0";
const TEST_API_KEY = "am_us_test_a5263504cbc7052a9046fde359208542f4d6fedae0400bc30d5a06902ff8237c";
const TEST_INBOX = "sfdc-agent-telnyx@agentmail.to";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AGENTMAIL_API_KEY: TEST_API_KEY,
    AGENTMAIL_INBOX: TEST_INBOX,
    AGENTMAIL_WEBHOOK_SECRET: TEST_SECRET,
    SECRETS: {
      get: vi.fn(async (key: string): Promise<string | undefined> => {
        if (key === "AGENTMAIL_API_KEY") return TEST_API_KEY;
        if (key === "AGENTMAIL_INBOX") return TEST_INBOX;
        if (key === "AGENTMAIL_WEBHOOK_SECRET") return TEST_SECRET;
        return undefined;
      }),
    },
    ...overrides,
  } as unknown as Env;
}

function makeInboundPayload(
  overrides: Partial<AgentMailInboundPayload["message"]> = {},
): AgentMailInboundPayload {
  return {
    type: "event",
    event_type: "message.received",
    event_id: "evt_test_001",
    message: {
      inbox_id: TEST_INBOX,
      thread_id: "thr_test_001",
      message_id: "msg_test_001",
      timestamp: "2026-08-19T23:04:18.302Z",
      from: "steve@example.com",
      to: [TEST_INBOX],
      subject: "Re: New Telnyx onboarding lead: Anusha",
      text: "Yes, that meeting time works.",
      extracted_text: "Yes, that meeting time works.",
      in_reply_to: "msg_outbound_001",
      ...overrides,
    },
  };
}

function signPayload(
  payload: string,
  secret: string = TEST_SECRET,
): { "svix-id": string; "svix-timestamp": string; "svix-signature": string } {
  const wh = new Webhook(secret);
  const msgId = "msg_svix_test_001";
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, payload);
  const ts = Math.floor(timestamp.getTime() / 1000).toString();
  return {
    "svix-id": msgId,
    "svix-timestamp": ts,
    "svix-signature": signature,
  };
}

describe("agentMailApiKey", () => {
  it("returns the env value when set", async () => {
    const env = makeEnv();
    const key = await agentMailApiKey(env);
    expect(key).toBe(TEST_API_KEY);
  });

  it("falls back to SECRETS binding when env value is empty", async () => {
    const env = makeEnv({ AGENTMAIL_API_KEY: undefined });
    const key = await agentMailApiKey(env);
    expect(key).toBe(TEST_API_KEY);
    expect(env.SECRETS?.get).toHaveBeenCalledWith("AGENTMAIL_API_KEY");
  });

  it("throws when neither env nor SECRETS has the key", async () => {
    const env = makeEnv({
      AGENTMAIL_API_KEY: undefined,
      SECRETS: { get: vi.fn(async (): Promise<string | undefined> => undefined) },
    });
    await expect(agentMailApiKey(env)).rejects.toThrow(/AGENTMAIL_API_KEY is required/);
  });
});

describe("agentMailInbox", () => {
  it("returns the env value when set", async () => {
    const env = makeEnv();
    const inbox = await agentMailInbox(env);
    expect(inbox).toBe(TEST_INBOX);
  });

  it("falls back to SECRETS binding", async () => {
    const env = makeEnv({ AGENTMAIL_INBOX: undefined });
    const inbox = await agentMailInbox(env);
    expect(inbox).toBe(TEST_INBOX);
  });

  it("uses the default when nothing is set", async () => {
    const env = makeEnv({
      AGENTMAIL_INBOX: undefined,
      SECRETS: { get: vi.fn(async (): Promise<string | undefined> => undefined) },
    });
    const inbox = await agentMailInbox(env);
    expect(inbox).toBe("sfdc-agent-telnyx@agentmail.to");
  });
});

describe("agentMailWebhookSecret", () => {
  it("returns the env value when set", async () => {
    const env = makeEnv();
    const secret = await agentMailWebhookSecret(env);
    expect(secret).toBe(TEST_SECRET);
  });

  it("returns null when nothing is configured", async () => {
    const env = makeEnv({
      AGENTMAIL_WEBHOOK_SECRET: undefined,
      SECRETS: { get: vi.fn(async (): Promise<string | undefined> => undefined) },
    });
    const secret = await agentMailWebhookSecret(env);
    expect(secret).toBeNull();
  });
});

describe("sendAgentMail", () => {
  it("sends an email and returns message_id + thread_id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ message_id: "msg_out_001", thread_id: "thr_001" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const result = await sendAgentMail(env, {
      to: "steve@example.com",
      subject: "Test subject",
      text: "Test body",
    });

    expect(result.message_id).toBe("msg_out_001");
    expect(result.thread_id).toBe("thr_001");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toContain("/v0/inboxes/sfdc-agent-telnyx%40agentmail.to/messages/send");
    expect(init.method).toBe("POST");
    const authHeader = (init.headers as Record<string, string>).Authorization;
    expect(authHeader).toBe(`Bearer ${TEST_API_KEY}`);

    const body = JSON.parse(String(init.body));
    expect(body.to).toBe("steve@example.com");
    expect(body.subject).toBe("Test subject");
    expect(body.text).toBe("Test body");

    vi.unstubAllGlobals();
  });

  it("throws when AgentMail returns a non-2xx status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"error":"forbidden"}', { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    await expect(
      sendAgentMail(env, { to: "steve@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow(/AgentMail send failed: 403/);

    vi.unstubAllGlobals();
  });

  it("throws when the response is missing message_id or thread_id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    await expect(
      sendAgentMail(env, { to: "steve@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow(/missing message_id or thread_id/);

    vi.unstubAllGlobals();
  });

  it("throws when AGENTMAIL_API_KEY is not set", async () => {
    const env = makeEnv({
      AGENTMAIL_API_KEY: undefined,
      SECRETS: { get: vi.fn(async (): Promise<string | undefined> => undefined) },
    });
    await expect(
      sendAgentMail(env, { to: "steve@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow(/AGENTMAIL_API_KEY is required/);
  });
});

describe("verifyAgentMailWebhook", () => {
  it("verifies a payload signed with the correct Svix secret", async () => {
    const env = makeEnv();
    const payload = makeInboundPayload();
    const rawBody = JSON.stringify(payload);
    const headers = signPayload(rawBody);

    const verified = await verifyAgentMailWebhook(rawBody, headers, env);
    expect(verified.event_type).toBe("message.received");
    expect(verified.message.from).toBe("steve@example.com");
  });

  it("rejects when the signature is invalid", async () => {
    const env = makeEnv();
    const rawBody = JSON.stringify(makeInboundPayload());
    const headers = {
      "svix-id": "msg_bad_001",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,invalidbase64signature==",
    };

    await expect(verifyAgentMailWebhook(rawBody, headers, env)).rejects.toThrow();
  });

  it("rejects when svix headers are missing", async () => {
    const env = makeEnv();
    const rawBody = JSON.stringify(makeInboundPayload());

    await expect(verifyAgentMailWebhook(rawBody, {}, env)).rejects.toThrow(
      /Missing Svix signature headers/,
    );
  });

  it("rejects when the webhook secret is not configured", async () => {
    const env = makeEnv({
      AGENTMAIL_WEBHOOK_SECRET: undefined,
      SECRETS: { get: vi.fn(async (): Promise<string | undefined> => undefined) },
    });
    const rawBody = JSON.stringify(makeInboundPayload());
    const headers = signPayload(rawBody, ALT_SECRET);

    await expect(verifyAgentMailWebhook(rawBody, headers, env)).rejects.toThrow(
      /AGENTMAIL_WEBHOOK_SECRET is required/,
    );
  });
});

describe("parseAgentMailInbound", () => {
  it("extracts from, subject, text, thread_id, message_id, in_reply_to", () => {
    const payload = makeInboundPayload();
    const parsed = parseAgentMailInbound(payload);
    expect(parsed.from).toBe("steve@example.com");
    expect(parsed.subject).toBe("Re: New Telnyx onboarding lead: Anusha");
    expect(parsed.text).toBe("Yes, that meeting time works.");
    expect(parsed.thread_id).toBe("thr_test_001");
    expect(parsed.message_id).toBe("msg_test_001");
    expect(parsed.in_reply_to).toBe("msg_outbound_001");
  });

  it("prefers extracted_text over raw text", () => {
    const payload = makeInboundPayload({
      text: "Yes, that meeting time works.\n\n> On Mon, Anusha wrote:\n> Hi Steve...",
      extracted_text: "Yes, that meeting time works.",
    });
    const parsed = parseAgentMailInbound(payload);
    expect(parsed.text).toBe("Yes, that meeting time works.");
  });

  it("falls back to raw text when extracted_text is absent", () => {
    const payload = makeInboundPayload({ extracted_text: undefined });
    const parsed = parseAgentMailInbound(payload);
    expect(parsed.text).toBe("Yes, that meeting time works.");
  });

  it("throws when both text and extracted_text are empty", () => {
    const payload = makeInboundPayload({ text: "", extracted_text: undefined });
    expect(() => parseAgentMailInbound(payload)).toThrow(/no text body/);
  });

  it("returns null in_reply_to when the field is absent", () => {
    const payload = makeInboundPayload({ in_reply_to: undefined });
    const parsed = parseAgentMailInbound(payload);
    expect(parsed.in_reply_to).toBeNull();
  });

  it("throws when the message field is missing", () => {
    const payload = {
      type: "event" as const,
      event_type: "message.received" as const,
      event_id: "evt_x",
      message: undefined as unknown,
    } as AgentMailInboundPayload;
    expect(() => parseAgentMailInbound(payload)).toThrow(/missing message/);
  });
});
