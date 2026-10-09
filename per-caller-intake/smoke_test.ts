import {
  IntakeDossier,
  base64UrlDecode,
  base64UrlEncode,
  decryptPortalToken,
  encryptPortalToken,
  normalizePhoneDigits,
  parseInitializationEvent,
  verifyTelnyxSignature,
} from "./src/index";

let failures = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}

// ─── 1. Actor surface ────────────────────────────────────────────────

check("IntakeDossier is exported", typeof IntakeDossier === "function");
const proto = IntakeDossier.prototype;
check("handleInitialization method exists", typeof proto.handleInitialization === "function");
check("fileVisitSummary method exists", typeof proto.fileVisitSummary === "function");
check("dossierView method exists", typeof proto.dossierView === "function");
check("initialState override exists", typeof proto.initialState === "function");

const initialState = (proto as unknown as { initialState(): unknown }).initialState();
check(
  "initialState shape is { lastVisitAt, lastFiledVisitId }",
  JSON.stringify(initialState) === JSON.stringify({ lastVisitAt: null, lastFiledVisitId: null }),
);

// ─── 2. Webhook envelope parsing (exact Telnyx payload shape) ────────

const docsPayload = {
  data: {
    record_type: "event",
    id: "event_12345678-90ab-cdef-1234-567890abcdef",
    event_type: "assistant.initialization",
    occurred_at: "2025-04-07T10:00:00Z",
    payload: {
      telnyx_conversation_channel: "phone_call",
      telnyx_agent_target: "+13128675309",
      telnyx_end_user_target: "+15551234567",
      telnyx_end_user_target_verified: false,
      call_control_id: "v3:u5OAKGEPT3Dx8SZSSDRWEMdNH2OripQhO",
      assistant_id: "assistant_12345678-90ab-cdef-1234-567890abcdef",
    },
  },
};

const parsed = parseInitializationEvent(docsPayload);
check("parses assistant.initialization envelope", parsed !== null);
check(
  "extracts telnyx_end_user_target from data.payload",
  parsed !== null && parsed.telnyx_end_user_target === "+15551234567",
);
check(
  "carries call_control_id and assistant_id",
  parsed !== null &&
    parsed.call_control_id === "v3:u5OAKGEPT3Dx8SZSSDRWEMdNH2OripQhO" &&
    parsed.assistant_id === "assistant_12345678-90ab-cdef-1234-567890abcdef",
);
check("rejects non-initialization event types", parseInitializationEvent({ data: { event_type: "message.received" } }) === null);
check("rejects envelope without target", parseInitializationEvent({ data: { event_type: "assistant.initialization", payload: {} } }) === null);

check("normalizes E.164 with formatting", normalizePhoneDigits("+1 (555) 123-4567") === "15551234567");
check("rejects short numbers", normalizePhoneDigits("555123") === null);

// ─── 3. Ed25519 webhook signature verification ───────────────────────

const { webcrypto } = (await import("node:crypto")) as { webcrypto: Crypto };
const subtle = webcrypto.subtle;

const keyPair = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const pubRaw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
const publicKeyB64Url = base64UrlEncode(pubRaw);

const rawBody = JSON.stringify(docsPayload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const signedPayload = new TextEncoder().encode(`${timestamp}|${rawBody}`);
const signatureBytes = new Uint8Array(await subtle.sign({ name: "Ed25519" }, keyPair.privateKey, signedPayload));

const goodHeaders = new Headers({
  "telnyx-timestamp": timestamp,
  "telnyx-signature-ed25519": base64UrlEncode(signatureBytes),
});
check("accepts a valid Ed25519 signature", await verifyTelnyxSignature(rawBody, goodHeaders, publicKeyB64Url));

const tamperedBody = rawBody.replace("15551234567", "15559999999");
check("rejects a tampered body", !(await verifyTelnyxSignature(tamperedBody, goodHeaders, publicKeyB64Url)));

const staleHeaders = new Headers({
  "telnyx-timestamp": Math.floor(Date.now() / 1000 - 3600).toString(),
  "telnyx-signature-ed25519": base64UrlEncode(signatureBytes),
});
check("rejects a stale (replayed) timestamp", !(await verifyTelnyxSignature(rawBody, staleHeaders, publicKeyB64Url)));

check(
  "rejects missing signature headers",
  !(await verifyTelnyxSignature(rawBody, new Headers(), publicKeyB64Url)),
);

const wrongKeyPair = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const wrongPubRaw = new Uint8Array(await subtle.exportKey("raw", wrongKeyPair.publicKey));
check(
  "rejects a signature from the wrong key",
  !(await verifyTelnyxSignature(rawBody, goodHeaders, base64UrlEncode(wrongPubRaw))),
);

// ─── 4. Per-caller credential encryption (docs scheme) ───────────────
// base64url( nonce(12 bytes) || AES-256-GCM ciphertext+tag ), key = 32 bytes.

const encKey = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
const plaintextToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));

const ciphertext = await encryptPortalToken(plaintextToken, encKey);
check("ciphertext is base64url (no +, /, or padding)", !/[+/=]/.test(ciphertext));
const decoded = base64UrlDecode(ciphertext);
check(
  "decoded envelope is nonce(12) + tag(16) + plaintext",
  decoded.length === 12 + new TextEncoder().encode(plaintextToken).length + 16,
);

const roundTrip = await decryptPortalToken(ciphertext, encKey);
check("AES-GCM round trip restores the plaintext token", roundTrip === plaintextToken);

const wrongKey = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
let wrongKeyFailed = false;
try {
  await decryptPortalToken(ciphertext, wrongKey);
} catch {
  wrongKeyFailed = true;
}
check("decryption with a wrong key fails closed (GCM auth)", wrongKeyFailed);

let shortKeyFailed = false;
try {
  await encryptPortalToken(plaintextToken, base64UrlEncode(new Uint8Array(16)));
} catch {
  shortKeyFailed = true;
}
check("rejects a non-32-byte key", shortKeyFailed);

// ─── Result ──────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke tests passed");
