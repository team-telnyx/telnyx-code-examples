import nacl from "tweetnacl";
import { createHash } from "node:crypto";

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

function pemToRawEd25519(pem: string): Uint8Array | null {
  const trimmed = pem.trim();
  if (trimmed.includes("BEGIN")) {
    const lines = trimmed.split(/\r?\n/).filter(
      (l) => !l.startsWith("-----") && l.trim().length > 0,
    );
    const b64 = lines.join("");
    return base64ToBytes(b64);
  }
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

export function messageFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}
