import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyReceipt } from "@lore-hex/trusted-router/receipts";
import {
  fetchReceiptAttestation,
  verifyInferenceReceipt,
  type ReceiptCheckResult,
} from "../src/receipts.js";

interface Fixture {
  model: string;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  nonce: string;
  issuer: string;
  requestBytes: string;
  responseBytes: string;
  receipt: string;
  attestation: string;
  claims: {
    kid: string;
    jwk: { kty: string; crv: string; x: string };
    selected: string;
    provider: string;
    endpoint: string;
    tier: string;
    iat: number;
    attSha256: string;
  };
}

let fixture: Fixture | null = null;

async function loadFixture(): Promise<Fixture> {
  if (fixture !== null) return fixture;
  const raw = await readFile(new URL("./fixtures/receipt-fixture.json", import.meta.url), "utf8");
  fixture = JSON.parse(raw) as Fixture;
  return fixture;
}

function fixtureBytes(f: Fixture) {
  return {
    requestBytes: new Uint8Array(Buffer.from(f.requestBytes, "base64")),
    responseBytes: new Uint8Array(Buffer.from(f.responseBytes, "base64")),
    attestationBytes: new Uint8Array(Buffer.from(f.attestation, "utf8")),
  };
}

async function networkAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    await fetch("https://trustedrouter.com/", { signal: controller.signal, method: "HEAD" });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

test("official verifier accepts the captured live fixture (network-guarded)", async (t) => {
  const f = await loadFixture();
  if (!(await networkAvailable())) {
    t.skip("network unavailable; skipping attestation-chained verification");
    return;
  }
  const { requestBytes, responseBytes, attestationBytes } = fixtureBytes(f);
  try {
  const claims = await verifyReceipt(f.receipt, {
    expectedIssuer: f.issuer,
    requestBody: requestBytes,
    responseBody: responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    attestation: attestationBytes,
    now: f.claims.iat + 1,
  });
  assert.equal(claims.rv, 1);
  assert.equal(claims.model.provider, "telnyx");
  assert.equal(claims.model.selected, f.model);
  assert.equal(claims.nonce, f.nonce);
  assert.equal(claims.attestationStatus, "verified");
  assert.ok(claims.upstream.tier === "tls-webpki" || claims.upstream.tier === "tee-verified");
  } catch (error) {
    if (error instanceof Error && error.message.includes("JWT expired")) {
      t.skip("fixture attestation JWT expired; the live smoke test covers attestation-chained verification");
      return;
    }
    throw error;
  }
});

test("official verifier without attestation still checks signature, hashes, nonce, freshness", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const claims = await verifyReceipt(f.receipt, {
    expectedIssuer: f.issuer,
    requestBody: requestBytes,
    responseBody: responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(claims.attestationStatus, "unverified_by_this_sdk");
  assert.equal(claims.nonce, f.nonce);
});

test("wrapper: successful verification maps every flag to true (attestation provided, network-guarded)", async (t) => {
  const f = await loadFixture();
  if (!(await networkAvailable())) {
    t.skip("network unavailable; skipping full attestation verification");
    return;
  }
  const { requestBytes, responseBytes, attestationBytes } = fixtureBytes(f);
  try {
    await verifyReceipt(f.receipt, {
      expectedIssuer: f.issuer,
      requestBody: requestBytes,
      responseBody: responseBytes,
      expectedNonce: f.nonce,
      maxAgeSeconds: 300,
      attestation: attestationBytes,
      now: f.claims.iat + 1,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("JWT expired")) {
      t.skip("fixture attestation JWT expired; the live smoke test covers attestation-chained verification");
      return;
    }
    throw error;
  }
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, true);
  assert.equal(result.nonceMatched, true);
  assert.equal(result.requestHashMatched, true);
  assert.equal(result.responseHashMatched, true);
  assert.equal(result.signatureValid, true);
  assert.equal(result.fresh, true);
  assert.equal(result.attestationValid, true);
  assert.equal(result.failureCode, null);
  assert.equal(result.claims?.provider, "telnyx");
  assert.ok(result.issuedAt !== null);
});

test("wrapper: offline signature/hash/nonce/freshness success marks attestation as not established", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, true);
  assert.equal(result.attestationValid, null);
  assert.equal(result.signatureValid, true);
});

test("wrapper: missing receipt fails as MISSING_RECEIPT", async () => {
  const result = await verifyInferenceReceipt({
    receipt: null,
    requestBytes: new Uint8Array(0),
    responseBytes: new Uint8Array(0),
    expectedNonce: "n",
    maxAgeSeconds: 300,
    expectedIssuer: "https://api.trustedrouter.com",
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "MISSING_RECEIPT");
});

test("wrapper: nonce mismatch fails as NONCE_MISMATCH", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: "different-nonce",
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "NONCE_MISMATCH");
  assert.equal(result.nonceMatched, false);
});

test("wrapper: modified request bytes fail as HASH_MISMATCH on the request hash", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const mutated = new Uint8Array(requestBytes);
  mutated[mutated.length - 2] = mutated[mutated.length - 2] === 125 ? 126 : 125;
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes: mutated,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "HASH_MISMATCH");
  assert.equal(result.requestHashMatched, false);
});

test("wrapper: modified response bytes fail as HASH_MISMATCH on the response hash", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const mutated = new Uint8Array(responseBytes);
  mutated[0] = mutated[0] === 123 ? 124 : 123;
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes: mutated,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "HASH_MISMATCH");
  assert.equal(result.responseHashMatched, false);
});

test("wrapper: stale receipt fails as STALE_OR_SKEW", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 601,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "STALE_OR_SKEW");
  assert.equal(result.fresh, false);
});

test("wrapper: tampered signature fails as SIGNATURE", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const parts = f.receipt.split(".");
  const signature = parts[2] ?? "";
  const flipped = signature.charAt(0) === "A" ? "B" + signature.slice(1) : "A" + signature.slice(1);
  const result = await verifyInferenceReceipt({
    receipt: `${parts[0]}.${parts[1]}.${flipped}`,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    requireAttestation: false,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "SIGNATURE");
  assert.equal(result.signatureValid, false);
});

test("wrapper: wrong attestation bytes fail as ATTESTATION", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const wrongBytes = new TextEncoder().encode(f.attestation.slice(0, -4) + "AAAA");
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: wrongBytes,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "ATTESTATION");
  assert.equal(result.attestationValid, false);
});

test("wrapper: unresolvable attestation fails as ATTESTATION_UNAVAILABLE", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: f.issuer,
    attestationBytes: null,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "ATTESTATION_UNAVAILABLE");
  assert.equal(result.attestationValid, false);
});

test("wrapper: issuer mismatch fails as ISSUER_MISMATCH", async () => {
  const f = await loadFixture();
  const { requestBytes, responseBytes } = fixtureBytes(f);
  const result = await verifyInferenceReceipt({
    receipt: f.receipt,
    requestBytes,
    responseBytes,
    expectedNonce: f.nonce,
    maxAgeSeconds: 300,
    expectedIssuer: "https://evil.example.com",
    attestationBytes: null,
    requireAttestation: false,
    now: f.claims.iat + 1,
  });
  assert.equal(result.verified, false);
  assert.equal(result.failureCode, "ISSUER_MISMATCH");
});

test("fetchReceiptAttestation: key-log match returns the attestation bytes", async () => {
  const f = await loadFixture();
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({ keys: [{ kid: f.claims.kid, att_sha256: "nope", att: "" }, { kid: f.claims.kid, att_sha256: f.claims.attSha256, att: f.attestation }] }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  const bytes = await fetchReceiptAttestation(f.receipt, {
    apiKey: "test-key",
    keyLogUrl: "https://trustedrouter.test/.well-known/inference-receipt-keys",
    gatewayAttestationUrl: "https://api.trustedrouter.test/receipt-attestation",
    fetchImpl,
  });
  assert.ok(bytes !== null);
  assert.equal(Buffer.from(bytes).toString("utf8"), f.attestation);
  assert.equal(calls.length, 1);
});

test("fetchReceiptAttestation: falls back to gateway retries until the digest matches", async () => {
  const f = await loadFixture();
  let gatewayCalls = 0;
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).includes("inference-receipt-keys")) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    gatewayCalls += 1;
    const body = gatewayCalls < 3 ? "wrong-attestation" : f.attestation;
    return new Response(body, { status: 200, headers: { "Content-Type": "application/jwt" } });
  }) as unknown as typeof fetch;
  const bytes = await fetchReceiptAttestation(f.receipt, {
    apiKey: "test-key",
    keyLogUrl: "https://trustedrouter.test/.well-known/inference-receipt-keys",
    gatewayAttestationUrl: "https://api.trustedrouter.test/receipt-attestation",
    fetchImpl,
    attempts: 5,
  });
  assert.ok(bytes !== null);
  assert.equal(gatewayCalls, 3);
});

test("fetchReceiptAttestation: returns null when nothing matches", async () => {
  const f = await loadFixture();
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).includes("inference-receipt-keys")) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    return new Response("still-wrong", { status: 200 });
  }) as unknown as typeof fetch;
  const bytes = await fetchReceiptAttestation(f.receipt, {
    apiKey: "test-key",
    keyLogUrl: "https://trustedrouter.test/.well-known/inference-receipt-keys",
    gatewayAttestationUrl: "https://api.trustedrouter.test/receipt-attestation",
    fetchImpl,
    attempts: 2,
  });
  assert.equal(bytes, null);
});
