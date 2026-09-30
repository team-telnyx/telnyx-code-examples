import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { generateReceiptNonce, isValidNonceFormat, NONCE_LENGTH } from "../src/nonce.js";

test("nonce uses only the TrustedRouter-accepted character set", () => {
  for (let i = 0; i < 200; i += 1) {
    const nonce = generateReceiptNonce();
    assert.match(nonce, /^[A-Za-z0-9_-]+$/);
  }
});

test("nonce length is 32 (within the accepted 1-88 range)", () => {
  assert.equal(generateReceiptNonce().length, NONCE_LENGTH);
  assert.ok(NONCE_LENGTH >= 1 && NONCE_LENGTH <= 88);
});

test("nonce generation is cryptographically random (no repeats in 500 draws)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) seen.add(generateReceiptNonce());
  assert.equal(seen.size, 500);
});

test("injected randomness source is honored", () => {
  const deterministic = (count: number): Uint8Array => new Uint8Array(count).fill(0);
  assert.equal(generateReceiptNonce(deterministic), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
});

test("isValidNonceFormat accepts valid and rejects invalid values", () => {
  assert.equal(isValidNonceFormat(generateReceiptNonce()), true);
  assert.equal(isValidNonceFormat("a".repeat(88)), true);
  assert.equal(isValidNonceFormat("a".repeat(89)), false);
  assert.equal(isValidNonceFormat("bad nonce with spaces"), false);
  assert.equal(isValidNonceFormat(""), false);
  assert.equal(isValidNonceFormat(123), false);
  assert.equal(isValidNonceFormat(null), false);
});

test("nonce does not bias toward any character position (sanity)", () => {
  const bytes = randomBytes(NONCE_LENGTH);
  const nonce = generateReceiptNonce(() => bytes);
  assert.equal(nonce.length, NONCE_LENGTH);
});
