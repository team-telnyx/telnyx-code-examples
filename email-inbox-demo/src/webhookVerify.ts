import nacl from "tweetnacl";
import { createHash } from "node:crypto";

/**
 * Ed25519 signature verification for Telnyx webhooks.
 *
 * Telnyx sends:
 *   telnyx-signature-ed25519: <hex signature>
 *   telnyx-timestamp: <unix seconds>
 *
 * The signed payload is `<timestamp>.<rawBody>` (the exact bytes Telnyx
 * received — no JSON re-serialization). We hash the concatenation and
 * verify against the configured public key.
 *
 * The public key is provided via the `TELNYX_PUBLIC_KEY` env var. The Telnyx
 * CLI exposes it via:
 *   curl -s -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/public_key | jq -r '.data.public'
 */
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "stale_timestamp" | "bad_signature" | "no_public_key" };

export function verifyTelnyxSignature(args: {
  rawBody: Buffer;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  publicKeyPem: string | null | undefined;
  toleranceSeconds?: number;
}): VerifyResult {
  const { rawBody, signature, timestamp, publicKeyPem } = args;
  const tolerance = args.toleranceSeconds ?? 300;

  if (!signature || !timestamp) return { ok: false, reason: "missing_header" };
  if (!publicKeyPem) return { ok: false, reason: "no_public_key" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "stale_timestamp" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const sigBytes = safeHexToBytes(signature);
  if (!sigBytes) return { ok: false, reason: "bad_signature" };

  const pubBytes = pemToRawEd25519(publicKeyPem);
  if (!pubBytes) return { ok: false, reason: "bad_signature" };

  const message = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  const ok = nacl.sign.detached.verify(message, sigBytes, pubBytes);
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function safeHexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Accept either a raw 32-byte Ed25519 public key (hex or base64) or a
 * PEM-encoded PUBLIC KEY block. The Telnyx CLI returns the raw key as a
 * single base64 string, so we handle that as the common case.
 */
function pemToRawEd25519(pem: string): Uint8Array | null {
  const trimmed = pem.trim();
  // PEM: take the base64 between BEGIN and END markers
  if (trimmed.includes("BEGIN")) {
    const lines = trimmed.split(/\r?\n/).filter(
      (l) => !l.startsWith("-----") && l.trim().length > 0,
    );
    const b64 = lines.join("");
    return base64ToBytes(b64);
  }
  // Raw key — try base64 first, fall back to hex
  const asBase64 = base64ToBytes(trimmed);
  if (asBase64 && asBase64.length === 32) return asBase64;
  const asHex = safeHexToBytes(trimmed);
  if (asHex && asHex.length === 32) return asHex;
  return null;
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Stable id for a Telnyx message (sha256 of `inbox_id|message_id`). */
export function messageFingerprint(inboxId: string, telnyxId: string): string {
  return createHash("sha256").update(`${inboxId}|${telnyxId}`).digest("hex").slice(0, 24);
}
