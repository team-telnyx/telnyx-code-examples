/**
 * Opt-in live smoke test against the real TrustedRouter gateway.
 *
 * Requires TRUSTEDROUTER_API_KEY (and optionally DEMO_ACCESS_TOKEN is not
 * needed here — this test talks to the gateway directly, not to this app).
 *
 * The test FAILS unless every condition holds:
 *   - TrustedRouter returns a successful completion
 *   - the selected provider is telnyx
 *   - the selected route satisfies the required ZDR filter
 *   - a signed receipt is present
 *   - local receipt verification succeeds
 *   - request and response hashes match
 *   - the nonce matches
 *   - the result contains non-empty generated text
 *
 * The printed summary never contains the API key, the prompt, the
 * completion, or the full compact receipt.
 */
import process from "node:process";
import { generateReceiptNonce } from "../src/nonce.js";
import { buildChatRequest } from "../src/requestBuilder.js";
import { CatalogService } from "../src/catalog.js";
import {
  fetchReceiptAttestation,
  verifyInferenceReceipt,
} from "../src/receipts.js";
import { loadConfig } from "../src/config.js";

const SMOKE_MODEL = process.env.SMOKE_MODEL ?? "z-ai/glm-5.3-flash";
const SMOKE_PROMPT =
  process.env.SMOKE_PROMPT ?? "Reply with the single word: OK only, no explanation.";

function fail(reason: string): never {
  console.error(`SMOKE TEST FAILED: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.trustedRouterApiKey === null) {
    fail("TRUSTEDROUTER_API_KEY is not set in the environment.");
  }

  // 1. The selected model must be in the live Telnyx ZDR catalog.
  const catalog = new CatalogService({ ttlSeconds: config.modelCacheTtlSeconds });
  const catalogResult = await catalog.getCatalog();
  if (catalogResult.source !== "live") {
    fail(`catalog is not live (source=${catalogResult.source}); cannot confirm ZDR eligibility.`);
  }
  const entry = catalogResult.models.find((m) => m.id === SMOKE_MODEL);
  if (entry === undefined) {
    fail(`model ${SMOKE_MODEL} is not in the live Telnyx ZDR catalog.`);
  }

  // 2. Send one low-token request with a fresh nonce.
  const built = buildChatRequest(SMOKE_MODEL, SMOKE_PROMPT, 64);
  const nonce = generateReceiptNonce();
  const response = await fetch(config.inferenceUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.trustedRouterApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-inference-receipt": nonce,
    },
    body: built.bodyBytes,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) {
    fail(`upstream returned HTTP ${response.status}.`);
  }
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  const receiptHeader = response.headers.get("x-inference-receipt");
  if (receiptHeader === null) {
    fail("response carried no x-inference-receipt header.");
  }

  const parsed = JSON.parse(new TextDecoder().decode(responseBytes)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    model?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  };
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    fail("completion text is empty; increase max_tokens if the model spent the budget on reasoning.");
  }

  // 3. Resolve the attestation and verify the receipt locally.
  const attestationBytes = await fetchReceiptAttestation(receiptHeader as string, {
    apiKey: config.trustedRouterApiKey,
    keyLogUrl: config.keyLogUrl,
    gatewayAttestationUrl: config.gatewayAttestationUrl,
  });
  const verification = await verifyInferenceReceipt({
    receipt: receiptHeader,
    requestBytes: built.bodyBytes,
    responseBytes,
    expectedNonce: nonce,
    maxAgeSeconds: config.receiptMaxAgeSeconds,
    expectedIssuer: config.expectedIssuer,
    attestationBytes,
  });

  if (!verification.verified) {
    fail(`receipt verification failed (${verification.failureCode}: ${verification.failureMessage ?? "n/a"}).`);
  }
  if (verification.requestHashMatched !== true || verification.responseHashMatched !== true) {
    fail("hash binding did not match the exact bytes exchanged.");
  }
  if (verification.nonceMatched !== true) {
    fail("nonce did not match the freshly generated value.");
  }
  const claims = verification.claims;
  if (claims?.provider !== "telnyx") {
    fail(`verified provider is ${claims?.provider ?? "unknown"}, not telnyx.`);
  }
  if (claims?.selectedModel !== SMOKE_MODEL) {
    fail(`verified model is ${claims?.selectedModel ?? "unknown"}, not ${SMOKE_MODEL}.`);
  }

  // 4. Safe summary only.
  const usage = parsed.usage ?? {};
  console.log("SMOKE TEST PASSED");
  console.log(`  model (requested):        ${SMOKE_MODEL}`);
  console.log(`  model (verified receipt): ${claims?.selectedModel ?? "?"}`);
  console.log(`  provider (verified):      ${claims?.provider ?? "?"}`);
  console.log(`  endpoint (verified):      ${claims?.endpoint ?? "?"}`);
  console.log(`  upstream tier (verified): ${claims?.upstreamTier ?? "?"}`);
  console.log(`  catalog source:           ${catalogResult.source}`);
  console.log(`  receipt verified:         yes (signature, hashes, nonce, freshness, attestation)`);
  console.log(`  receipt issued at:        ${verification.issuedAt ?? "?"}`);
  console.log(`  tokens:                   prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`);
  console.log(`  completion length:        ${content.length} chars (not printed)`);
  console.log(`  receipt header length:    ${receiptHeader.length} chars (not printed)`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
});
