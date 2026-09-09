import * as crypto from "node:crypto";

// Telnyx signs webhooks with Ed25519. The signed payload is
// "{Telnyx-Timestamp}|{raw_body}" and the base64 signature is in the
// Telnyx-Signature-Ed25519 header. Timestamps within ±5 minutes are accepted.
const MAX_SKEW_MS = 5 * 60 * 1000;

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromRaw(rawB64: string): crypto.KeyObject | null {
  try {
    const raw = Buffer.from(rawB64, "base64");
    if (raw.length !== 32) return null;
    const spki = Buffer.concat([SPKI_PREFIX, raw]);
    return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/**
 * Verify a Telnyx webhook signature. Returns 0 on success or an HTTP
 * status code describing the failure (400 missing headers, 401 bad
 * signature, 500 no public key configured).
 */
export function verifyTelnyxSignature(
  headers: Headers,
  body: ArrayBuffer,
): 0 | 400 | 401 | 500 {
  const keyB64 = process.env.TELNYX_PUBLIC_KEY ?? "";
  if (!keyB64) return 500;

  const sigB64 = headers.get("Telnyx-Signature-Ed25519") ?? "";
  const ts = headers.get("Telnyx-Timestamp") ?? "";
  if (!sigB64 || !ts) return 400;

  const tsMs = Number.parseInt(ts, 10) * 1000;
  if (!Number.isFinite(tsMs)) return 400;
  const age = Date.now() - tsMs;
  if (age < -MAX_SKEW_MS || age > MAX_SKEW_MS) return 401;

  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, "base64");
  } catch {
    return 401;
  }

  const key = publicKeyFromRaw(keyB64);
  if (!key) return 500;

  const signed = Buffer.concat([
    Buffer.from(`${ts}|`),
    Buffer.from(body),
  ]);
  const ok = crypto.verify(null, signed, key, sig);
  return ok ? 0 : 401;
}
