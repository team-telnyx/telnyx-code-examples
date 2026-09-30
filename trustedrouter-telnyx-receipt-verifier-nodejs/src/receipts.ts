/**
 * Receipt extraction, attestation resolution, and local verification.
 *
 * Verification uses the official TrustedRouter JavaScript verifier
 * (`verifyReceipt` from @lore-hex/trusted-router/receipts). No custom
 * cryptographic verification is implemented here; the only local crypto is
 * diagnostic (comparing SHA-256 digests to decide which hash check failed).
 *
 * Attestation resolution follows the documented flow: the compact receipt
 * pins an attestation document by SHA-256; the control-plane key log
 * (/.well-known/inference-receipt-keys?kid=...) retains every observed
 * attestation version, and the gateway's /receipt-attestation endpoint
 * serves the per-instance document as a fallback.
 */
import { createHash } from "node:crypto";
import {
  MissingAttestationError,
  ReceiptAttestationError,
  ReceiptClaimsError,
  ReceiptHashError,
  ReceiptIssuerError,
  ReceiptNonceError,
  ReceiptSignatureError,
  ReceiptStructureError,
  ReceiptHeaderError,
  ReceiptTimeError,
  ReceiptUpstreamError,
  MissingBindingError,
  verifyReceipt,
  type ReceiptClaims,
} from "@lore-hex/trusted-router/receipts";

export interface ReceiptEnvelope {
  header: { kid?: string; alg?: string; typ?: string; [key: string]: unknown };
  payload: Record<string, unknown>;
}

export type VerificationFailureCode =
  | "MISSING_RECEIPT"
  | "MALFORMED_RECEIPT"
  | "SIGNATURE"
  | "HASH_MISMATCH"
  | "NONCE_MISMATCH"
  | "STALE_OR_SKEW"
  | "ISSUER_MISMATCH"
  | "ATTESTATION_UNAVAILABLE"
  | "ATTESTATION"
  | "MISSING_BINDING"
  | "CLAIMS"
  | "UPSTREAM_CLAIMS"
  | "UNKNOWN";

export interface SafeReceiptClaims {
  rv: number | null;
  issuer: string | null;
  route: string | null;
  requestedModel: string | null;
  selectedModel: string | null;
  provider: string | null;
  endpoint: string | null;
  upstreamTier: string | null;
  upstreamPolicy: string | null;
  attestationStatus: string | null;
  attSha256: string | null;
  nonceEchoed: string | null;
  responseId: string | null;
  generationId: string | null;
  requestHash: string | null;
  responseHash: string | null;
}

export interface ReceiptCheckResult {
  verified: boolean;
  nonceMatched: boolean | null;
  requestHashMatched: boolean | null;
  responseHashMatched: boolean | null;
  signatureValid: boolean | null;
  fresh: boolean | null;
  attestationValid: boolean | null;
  issuedAt: string | null;
  verifiedAt: string;
  failureCode: VerificationFailureCode | null;
  failureMessage: string | null;
  claims: SafeReceiptClaims | null;
}

export interface VerifyInferenceReceiptOptions {
  receipt: string | null;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
  expectedNonce: string;
  maxAgeSeconds: number;
  expectedIssuer: string;
  /** The bytes of the pinned attestation document, when already resolved. */
  attestationBytes?: Uint8Array | null;
  /**
   * Pass-through to the official verifier. The application always requires
   * attestation; tests use false for offline signature/hash checks.
   */
  requireAttestation?: boolean;
  /** Overrides for tests. */
  verifyReceiptImpl?: typeof verifyReceipt;
  now?: number | null;
}

function b64urlDecodeJson(segment: string): unknown {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  const bytes = Buffer.from(padded, "base64url");
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function decodeReceiptEnvelope(receipt: string): ReceiptEnvelope | null {
  try {
    const parts = receipt.split(".");
    if (parts.length !== 3) return null;
    const header = b64urlDecodeJson(parts[0] as string);
    const payload = b64urlDecodeJson(parts[1] as string);
    if (typeof header !== "object" || header === null) return null;
    if (typeof payload !== "object" || payload === null) return null;
    return {
      header: header as ReceiptEnvelope["header"],
      payload: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function sha256Base64Url(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function toSafeClaims(claims: ReceiptClaims): SafeReceiptClaims {
  return {
    rv: typeof claims.rv === "number" ? claims.rv : null,
    issuer: claims.iss ?? null,
    route: claims.route ?? null,
    requestedModel: claims.model?.requested ?? null,
    selectedModel: claims.model?.selected ?? null,
    provider: claims.model?.provider ?? null,
    endpoint: claims.model?.endpoint ?? null,
    upstreamTier: claims.upstream?.tier ?? null,
    upstreamPolicy: claims.upstream?.policy ?? null,
    attestationStatus: claims.attestationStatus ?? null,
    attSha256: claims.attSha256 ?? null,
    nonceEchoed: claims.nonce ?? null,
    responseId: claims.jti ?? null,
    generationId: claims.gen ?? null,
    requestHash: claims.req?.hash ?? null,
    responseHash: claims.resp?.hash ?? null,
  };
}

function successResult(claims: ReceiptClaims, verifiedAt: string): ReceiptCheckResult {
  const issuedAt = new Date(claims.iat * 1000).toISOString();
  return {
    verified: true,
    nonceMatched: true,
    requestHashMatched: true,
    responseHashMatched: true,
    signatureValid: true,
    fresh: true,
    attestationValid: true,
    issuedAt,
    verifiedAt,
    failureCode: null,
    failureMessage: null,
    claims: toSafeClaims(claims),
  };
}

function failureResult(
  verifiedAt: string,
  failureCode: VerificationFailureCode,
  failureMessage: string,
  flags: Partial<Pick<ReceiptCheckResult, "nonceMatched" | "requestHashMatched" | "responseHashMatched" | "signatureValid" | "fresh" | "attestationValid">> | null = null,  envelope: ReceiptEnvelope | null = null
): ReceiptCheckResult {
  const payload = envelope?.payload ?? null;
  let claims: SafeReceiptClaims | null = null;
  if (payload !== null) {
    // Diagnostics only: these values come from the (possibly untrusted)
    // payload and are displayed as technical details, never as proof.
    const model = (payload.model ?? null) as Record<string, unknown> | null;
    const upstream = (payload.upstream ?? null) as Record<string, unknown> | null;
    const req = (payload.req ?? null) as Record<string, unknown> | null;
    const resp = (payload.resp ?? null) as Record<string, unknown> | null;
    claims = {
      rv: typeof payload.rv === "number" ? payload.rv : null,
      issuer: typeof payload.iss === "string" ? payload.iss : null,
      route: typeof payload.route === "string" ? payload.route : null,
      requestedModel: typeof model?.requested === "string" ? model.requested : null,
      selectedModel: typeof model?.selected === "string" ? model.selected : null,
      provider: typeof model?.provider === "string" ? model.provider : null,
      endpoint: typeof model?.endpoint === "string" ? model.endpoint : null,
      upstreamTier: typeof upstream?.tier === "string" ? upstream.tier : null,
      upstreamPolicy: typeof upstream?.policy === "string" ? upstream.policy : null,
      attestationStatus: null,
      attSha256: typeof payload.att_sha256 === "string" ? payload.att_sha256 : null,
      nonceEchoed: typeof payload.nonce === "string" ? payload.nonce : null,
      responseId: typeof payload.jti === "string" ? payload.jti : null,
      generationId: typeof payload.gen === "string" ? payload.gen : null,
      requestHash: typeof req?.hash === "string" ? req.hash : null,
      responseHash: typeof resp?.hash === "string" ? resp.hash : null,
    };
  }
  return {
    verified: false,
    nonceMatched: flags?.nonceMatched ?? null,
    requestHashMatched: flags?.requestHashMatched ?? null,
    responseHashMatched: flags?.responseHashMatched ?? null,
    signatureValid: flags?.signatureValid ?? null,
    fresh: flags?.fresh ?? null,
    attestationValid: flags?.attestationValid ?? null,
    issuedAt: null,
    verifiedAt,
    failureCode,
    failureMessage,
    claims,
  };
}

export async function verifyInferenceReceipt(
  options: VerifyInferenceReceiptOptions
): Promise<ReceiptCheckResult> {
  const {
    receipt,
    requestBytes,
    responseBytes,
    expectedNonce,
    maxAgeSeconds,
    expectedIssuer,
    attestationBytes = null,
    requireAttestation = true,
  } = options;
  const verifiedAt = new Date().toISOString();
  const verify = options.verifyReceiptImpl ?? verifyReceipt;

  if (receipt === null || receipt.trim() === "") {
    return failureResult(verifiedAt, "MISSING_RECEIPT", "The upstream response carried no signed receipt header.");
  }
  const envelope = decodeReceiptEnvelope(receipt);
  if (envelope === null) {
    return failureResult(verifiedAt, "MALFORMED_RECEIPT", "The receipt header is not a parseable JWS.");
  }

  try {
    const claims = await verify(receipt, {
      expectedIssuer,
      requestBody: requestBytes,
      responseBody: responseBytes,
      expectedNonce,
      maxAgeSeconds,
      now: options.now ?? null,
      attestation: attestationBytes ?? null,
      requireAttestation,
    });
    const result = successResult(claims, verifiedAt);
    if (!requireAttestation) {
      // Attestation was not evaluated in this mode; never fabricate a claim.
      result.attestationValid = claims.attestationStatus === "verified" ? true : null;
    }
    return result;
  } catch (error) {
    if (error instanceof ReceiptHashError) {
      // Diagnose which digest mismatched by recomputing hashes against the
      // payload claims. This is display logic, not a verification decision.
      const claimedReq = typeof envelope.payload.req === "object" && envelope.payload.req !== null
        ? (envelope.payload.req as { hash?: unknown }).hash
        : null;
      const claimedResp = typeof envelope.payload.resp === "object" && envelope.payload.resp !== null
        ? (envelope.payload.resp as { hash?: unknown }).hash
        : null;
      const requestMatches = claimedReq === sha256Base64Url(requestBytes);
      const responseMatches = claimedResp === sha256Base64Url(responseBytes);
      const flags: Partial<ReceiptCheckResult> = {};
      if (!requestMatches) flags.requestHashMatched = false;
      if (!responseMatches) flags.responseHashMatched = false;
      return failureResult(
        verifiedAt,
        "HASH_MISMATCH",
        "The receipt's request or response digest does not match the exact bytes exchanged.",
        flags,
        envelope
      );
    }
    if (error instanceof ReceiptSignatureError) {
      return failureResult(verifiedAt, "SIGNATURE", "The receipt signature is invalid.", { signatureValid: false }, envelope);
    }
    if (error instanceof ReceiptNonceError) {
      return failureResult(verifiedAt, "NONCE_MISMATCH", "The receipt nonce does not match this request.", { nonceMatched: false }, envelope);
    }
    if (error instanceof ReceiptTimeError) {
      return failureResult(verifiedAt, "STALE_OR_SKEW", "The receipt is stale or outside the allowed clock skew.", { fresh: false }, envelope);
    }
    if (error instanceof ReceiptIssuerError) {
      return failureResult(verifiedAt, "ISSUER_MISMATCH", "The receipt issuer does not match the expected gateway origin.", null, envelope);
    }
    if (error instanceof MissingAttestationError) {
      return failureResult(verifiedAt, "ATTESTATION_UNAVAILABLE", "The attestation document pinned by this receipt could not be resolved.", { attestationValid: false }, envelope);
    }
    if (error instanceof ReceiptAttestationError) {
      return failureResult(verifiedAt, "ATTESTATION", "The receipt's attestation binding failed validation.", { attestationValid: false }, envelope);
    }
    if (error instanceof MissingBindingError) {
      return failureResult(verifiedAt, "MISSING_BINDING", "The receipt could not be bound to the exact request and response bytes.", null, envelope);
    }
    if (error instanceof ReceiptUpstreamError) {
      return failureResult(verifiedAt, "UPSTREAM_CLAIMS", "The receipt's upstream verification tier is not acceptable.", null, envelope);
    }
    if (error instanceof ReceiptClaimsError) {
      return failureResult(verifiedAt, "CLAIMS", "The receipt claims failed validation.", null, envelope);
    }
    if (error instanceof ReceiptStructureError || error instanceof ReceiptHeaderError) {
      return failureResult(verifiedAt, "MALFORMED_RECEIPT", "The receipt structure is invalid.", null, envelope);
    }
    return failureResult(verifiedAt, "UNKNOWN", "Receipt verification failed for an unrecognized reason.", null, envelope);
  }
}

export interface FetchAttestationOptions {
  apiKey: string | null;
  keyLogUrl: string;
  gatewayAttestationUrl: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
}

/**
 * Resolve the attestation document pinned by a compact receipt.
 *
 * 1. Control-plane key log lookup by signing-key id (all retained versions).
 * 2. Fallback: retry the gateway's per-instance /receipt-attestation with
 *    Connection: close until the SHA-256 matches the pinned claim.
 */
export async function fetchReceiptAttestation(
  receipt: string,
  options: FetchAttestationOptions
): Promise<Uint8Array | null> {
  const envelope = decodeReceiptEnvelope(receipt);
  if (envelope === null) return null;
  const kid = typeof envelope.header.kid === "string" ? envelope.header.kid : null;
  const attSha256 = typeof envelope.payload.att_sha256 === "string" ? envelope.payload.att_sha256 : null;
  if (kid === null || attSha256 === null) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const encoder = new TextEncoder();

  // 1. Control-plane key log.
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = `${options.keyLogUrl}?kid=${encodeURIComponent(kid)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    let payload: { keys?: Array<{ att?: unknown; att_sha256?: unknown }>; next_cursor?: unknown };
    try {
      const response = await fetchImpl(url, {
        headers: {
          ...(options.apiKey !== null ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) break;
      payload = (await response.json()) as typeof payload;
    } catch {
      break;
    }
    const rows = Array.isArray(payload.keys) ? payload.keys : [];
    for (const row of rows) {
      if (row.att_sha256 === attSha256 && typeof row.att === "string" && row.att.length > 0) {
        return encoder.encode(row.att);
      }
    }
    const next = payload.next_cursor;
    if (typeof next === "string" && next.length > 0) {
      cursor = next;
    } else {
      break;
    }
  }

  // 2. Gateway per-instance fallback.
  const attempts = options.attempts ?? 6;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let bytes: ArrayBuffer;
    try {
      const response = await fetchImpl(options.gatewayAttestationUrl, {
        headers: { Connection: "close", Accept: "application/jwt" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      bytes = await response.arrayBuffer();
    } catch {
      continue;
    }
    const candidate = new Uint8Array(bytes);
    if (sha256Base64Url(candidate) === attSha256) {
      return candidate;
    }
  }
  return null;
}
