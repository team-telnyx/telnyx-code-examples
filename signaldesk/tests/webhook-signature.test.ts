import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { TelnyxWebhook, unwrapWebhook } from "telnyx/lib/webhooks";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyB64 = publicKey
  .export({ type: "spki", format: "der" })
  .subarray(12)
  .toString("base64"); // raw 32-byte Ed25519 key, base64, as the portal shows it

function signPayload(rawBody: string, timestamp: string): string {
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
    privateKey,
  );
  return signature.toString("base64");
}

describe("Telnyx Ed25519 webhook verification", () => {
  const payload = JSON.stringify({ hello: "world", nested: { a: 1 } });

  it("accepts a valid signature over the exact raw body", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      "telnyx-signature-ed25519": signPayload(payload, timestamp),
      "telnyx-timestamp": timestamp,
    };
    await expect(unwrapWebhook(payload, { headers }, publicKeyB64)).resolves.toMatchObject({
      hello: "world",
    });
  });

  it("rejects a signature over tampered content", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      "telnyx-signature-ed25519": signPayload(payload, timestamp),
      "telnyx-timestamp": timestamp,
    };
    await expect(
      unwrapWebhook(payload.replace("world", "evil"), { headers }, publicKeyB64),
    ).rejects.toThrow();
  });

  it("rejects a stale timestamp (replay window ±300s)", async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 601);
    const headers = {
      "telnyx-signature-ed25519": signPayload(payload, oldTimestamp),
      "telnyx-timestamp": oldTimestamp,
    };
    await expect(
      unwrapWebhook(payload, { headers }, publicKeyB64),
    ).rejects.toThrow(/too old|timestamp/i);
  });

  it("rejects a future timestamp", async () => {
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 3600);
    const headers = {
      "telnyx-signature-ed25519": signPayload(payload, futureTimestamp),
      "telnyx-timestamp": futureTimestamp,
    };
    await expect(
      unwrapWebhook(payload, { headers }, publicKeyB64),
    ).rejects.toThrow();
  });

  it("rejects when the signature header is missing", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      unwrapWebhook(payload, { headers: { "telnyx-timestamp": timestamp } }, publicKeyB64),
    ).rejects.toThrow(/Missing required header/i);
  });

  it("rejects when no public key is configured", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      "telnyx-signature-ed25519": signPayload(payload, timestamp),
      "telnyx-timestamp": timestamp,
    };
    await expect(unwrapWebhook(payload, { headers }, null)).rejects.toThrow(
      /No public key/i,
    );
  });

  it("rejects malformed base64 signatures", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      unwrapWebhook(
        payload,
        { headers: { "telnyx-signature-ed25519": "!!not-base64!!", "telnyx-timestamp": timestamp } },
        publicKeyB64,
      ),
    ).rejects.toThrow();
  });

  it("verifies via the TelnyxWebhook helper class identically", async () => {
    const webhook = new TelnyxWebhook(publicKeyB64);
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      webhook.verify(payload, {
        "Telnyx-Signature-Ed25519": signPayload(payload, timestamp),
        "Telnyx-Timestamp": timestamp,
      }),
    ).resolves.toBeUndefined();
  });

  it("matches the expected signed format: timestamp|raw body", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = `${timestamp}|${payload}`;
    const signature = sign(null, Buffer.from(message, "utf8"), privateKey);
    const wrongFormatSignature = sign(
      null,
      Buffer.from(payload, "utf8"),
      privateKey,
    );

    const verified = verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      signature,
    );
    expect(verified).toBe(true);

    const webhook = new TelnyxWebhook(publicKeyB64);
    await expect(
      webhook.verify(payload, {
        "telnyx-signature-ed25519": Buffer.from(wrongFormatSignature).toString("base64"),
        "telnyx-timestamp": timestamp,
      }),
    ).rejects.toThrow();
  });
});
