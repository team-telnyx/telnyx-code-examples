import { randomBytes } from "node:crypto";

/**
 * TrustedRouter accepts receipt nonces of 1-88 characters drawn from
 * A-Z, a-z, 0-9, "_" and "-". The alphabet below has exactly 64 members,
 * so masking each random byte to its low 6 bits yields an unbiased
 * character selection.
 */
const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export const NONCE_LENGTH = 32;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,88}$/;

export function generateReceiptNonce(random: (count: number) => Uint8Array = randomBytes): string {
  const bytes = random(NONCE_LENGTH);
  const chars: string[] = [];
  for (const byte of bytes) {
    chars.push(NONCE_ALPHABET[byte & 0x3f] as string);
  }
  return chars.join("");
}

export function isValidNonceFormat(nonce: unknown): nonce is string {
  return typeof nonce === "string" && NONCE_PATTERN.test(nonce);
}
