import { describe, it, expect, vi } from "vitest";

const { mockUnwrapWebhook } = vi.hoisted(() => ({
  mockUnwrapWebhook: vi.fn(),
}));

vi.mock("telnyx/lib/webhooks", () => ({
  unwrapWebhook: mockUnwrapWebhook,
}));

import { verifyAndParseWebhook, parseWebhookBody } from "../src/webhook.js";
import type { Env } from "../src/types.js";

function makeEnv(publicKey: string | null): Env {
  return {
    SECRETS: {
      get: vi.fn(async () => publicKey),
    },
  } as unknown as Env;
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("verifyAndParseWebhook", () => {
  it("throws when TELNYX_PUBLIC_KEY is not set", async () => {
    const env = makeEnv(null);
    const body = JSON.stringify({ data: { event_type: "message.received" } });
    const request = makeRequest(body);

    await expect(verifyAndParseWebhook(body, request, env)).rejects.toThrow(
      /TELNYX_PUBLIC_KEY is required/,
    );
  });

  it("parses a valid webhook when unwrap succeeds", async () => {
    const env = makeEnv("base64publickey");
    const webhookPayload = {
      data: {
        id: "evt-123",
        event_type: "message.received",
        payload: {
          from: { phone_number: "+15550001111" },
          to: [{ phone_number: "+15557654321" }],
          text: "hello",
        },
      },
    };
    const body = JSON.stringify(webhookPayload);
    mockUnwrapWebhook.mockResolvedValueOnce(webhookPayload);
    const request = makeRequest(body, {
      "telnyx-signature-ed25519": "validsig",
      "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
    });

    const result = await verifyAndParseWebhook(body, request, env);
    expect(result.data.event_type).toBe("message.received");
    expect(mockUnwrapWebhook).toHaveBeenCalledTimes(1);
  });

  it("propagates error when unwrap rejects (invalid signature)", async () => {
    const env = makeEnv("base64publickey");
    const body = JSON.stringify({ data: { event_type: "message.received" } });
    mockUnwrapWebhook.mockRejectedValueOnce(new Error("Invalid signature"));
    const request = makeRequest(body, {
      "telnyx-signature-ed25519": "invalidsig",
      "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
    });

    await expect(verifyAndParseWebhook(body, request, env)).rejects.toThrow(
      /Invalid signature/,
    );
  });
});

describe("parseWebhookBody", () => {
  it("parses a valid webhook JSON body", async () => {
    const payload = {
      data: {
        id: "evt-456",
        event_type: "message.received",
        payload: {
          from: { phone_number: "+15550001111" },
          to: [{ phone_number: "+15557654321" }],
          text: "test message",
        },
      },
    };
    const result = await parseWebhookBody(JSON.stringify(payload));
    expect(result.data.id).toBe("evt-456");
    expect(result.data.payload.text).toBe("test message");
  });

  it("throws on invalid JSON", async () => {
    await expect(parseWebhookBody("not json")).rejects.toThrow();
  });
});
