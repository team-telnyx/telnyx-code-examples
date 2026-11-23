import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { verifyTelnyxSignature } from "@/call/telnyx";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");

const BODY = JSON.stringify({
  data: { event_type: "call.answered", payload: { call_control_id: "cc-verify-1" } },
});

const signPayload = (timestamp: string, body: string): string =>
  cryptoSign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), privateKey).toString("base64");

describe("verifyTelnyxSignature", () => {
  it("accepts a webhook signed exactly per the Telnyx SDK contract", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(verifyTelnyxSignature({ publicKeyBase64, timestamp, signatureBase64: signPayload(timestamp, BODY), rawBody: BODY })).toBe(true);
  });

  it("rejects when the separator differs from the SDK contract", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = cryptoSign(null, Buffer.from(`${timestamp}.${BODY}`, "utf8"), privateKey).toString("base64");

    expect(verifyTelnyxSignature({ publicKeyBase64, timestamp, signatureBase64: signature, rawBody: BODY })).toBe(false);
  });

  it("rejects stale timestamps beyond the 5-minute tolerance", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 1_000);

    expect(verifyTelnyxSignature({ publicKeyBase64, timestamp: stale, signatureBase64: signPayload(stale, BODY), rawBody: BODY })).toBe(false);
  });

  it("rejects tampered bodies", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(verifyTelnyxSignature({ publicKeyBase64, timestamp, signatureBase64: signPayload(timestamp, BODY), rawBody: BODY.slice(2) })).toBe(false);
  });
});
