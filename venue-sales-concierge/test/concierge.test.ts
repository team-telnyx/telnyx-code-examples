import { describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import { verifyTelnyxSignature } from "../src/verify";
import { actorNameForPhone, maskPhone, normalizePhone } from "../src/types";
import { isQualifiedLead } from "../src/agent";
import { completeJson } from "../src/telnyx";
import type { Env } from "../src/types";
import { seededAvailable } from "../src/db";

// Pass the exact bytes to verify — Buffer.buffer can be a pooled ArrayBuffer
// with a non-zero byteOffset, so slice out just this string's bytes.
function ab(s: string): ArrayBuffer {
  const b = Buffer.from(s);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("phone helpers", () => {
  it("derives Dapr-safe actor names from E.164 numbers", () => {
    expect(actorNameForPhone("+1 555 123 4567")).toBe("15551234567");
    expect(actorNameForPhone("+15551234567")).toBe("15551234567");
  });

  it("normalizes phone numbers to E.164", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("masks phone numbers in logs", () => {
    const masked = maskPhone("+15551234567");
    expect(masked).not.toContain("15551234567");
    expect(masked.endsWith("4567")).toBe(true);
  });
});

describe("lead qualification", () => {
  it("qualifies planners with an email and 50+ guests", () => {
    expect(isQualifiedLead({ email: "jane@example.com", guests: 150, budget: "", event_type: "" })).toBe(true);
  });

  it("requires an email", () => {
    expect(isQualifiedLead({ email: "", guests: 500, budget: "enterprise", event_type: "" })).toBe(false);
  });

  it("qualifies on enterprise budget wording", () => {
    expect(isQualifiedLead({ email: "j@x.co", guests: 0, budget: "Enterprise", event_type: "" })).toBe(true);
  });

  it("does not qualify small casual inquiries", () => {
    expect(isQualifiedLead({ email: "j@x.co", guests: 10, budget: "low", event_type: "birthday" })).toBe(false);
  });
});

describe("Ed25519 webhook verification", () => {
  function signedRequest(body: string, opts?: { skewSeconds?: number; tamper?: boolean }): Request {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(12);
    process.env.TELNYX_PUBLIC_KEY = Buffer.from(rawPub).toString("base64");

    const ts = Math.floor((Date.now() + (opts?.skewSeconds ?? 0) * 1000) / 1000);
    const signed = Buffer.concat([Buffer.from(`${ts}|`), Buffer.from(body)]);
    const sig = crypto.sign(null, signed, privateKey);
    const headers = new Headers({
      "Telnyx-Signature-Ed25519": (opts?.tamper
        ? Buffer.from("bad").toString("base64")
        : sig.toString("base64")),
      "Telnyx-Timestamp": String(ts),
    });
    return new Request("https://example.com/webhooks/sms", { method: "POST", headers, body });
  }

  it("accepts a valid signature", () => {
    const body0 = JSON.stringify({ hello: "world" });
    const req = signedRequest(body0);
    expect(verifyTelnyxSignature(req.headers, ab(body0))).toBe(0);
  });

  it("rejects a tampered signature with 401", () => {
    const body = JSON.stringify({ hello: "world" });
    const req = signedRequest(body, { tamper: true });
    expect(verifyTelnyxSignature(req.headers, ab(body))).toBe(401);
  });

  it("rejects stale timestamps with 401", () => {
    const body = JSON.stringify({ hello: "world" });
    const req = signedRequest(body, { skewSeconds: -600 });
    expect(verifyTelnyxSignature(req.headers, ab(body))).toBe(401);
  });

  it("returns 400 when signature headers are missing", () => {
    expect(verifyTelnyxSignature(new Headers(), ab("{}"))).toBe(400);
  });

  it("returns 500 when TELNYX_PUBLIC_KEY is unset", () => {
    const saved = process.env.TELNYX_PUBLIC_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;
    try {
      expect(verifyTelnyxSignature(new Headers(), ab("{}"))).toBe(500);
    } finally {
      process.env.TELNYX_PUBLIC_KEY = saved;
    }
  });
});

describe("completeJson", () => {
  function fakeEnv(content: string): Env {
    return {
      TELNYX: {
        ai: { openai: { chat: { createCompletion: async () => ({ choices: [{ message: { content } }] }) } } },
      },
    } as unknown as Env;
  }

  it("parses fenced JSON", async () => {
    const out = await completeJson<{ guests: number }>(fakeEnv("```json\n{\"guests\": 150}\n```"), "s", "u");
    expect(out?.guests).toBe(150);
  });

  it("parses bare JSON", async () => {
    const out = await completeJson<{ intent: string }>(fakeEnv("{\"intent\": \"site_visit\"}"), "s", "u");
    expect(out?.intent).toBe("site_visit");
  });

  it("returns null for non-JSON output", async () => {
    expect(await completeJson(fakeEnv("I am not JSON"), "s", "u")).toBeNull();
  });
});

describe("availability seed determinism", () => {
  it("is deterministic for a given date", () => {
    expect(seededAvailable("2026-10-15")).toBe(seededAvailable("2026-10-15"));
    expect(typeof seededAvailable("2026-10-15")).toBe("boolean");
  });
});
