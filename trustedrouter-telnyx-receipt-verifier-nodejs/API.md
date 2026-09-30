# API Reference

Typed endpoint reference for the TrustedRouter → Telnyx Receipt Explorer service.
All responses use `Cache-Control: no-store`. All requests and responses are JSON.

Base URL: `http://localhost:8080` locally, or `https://<func-name>-<id>.telnyxcompute.com` on Telnyx Edge.

---

## `GET /health`

Deployment liveness/readiness probe. Does not test paid inference and exposes no secrets.

**Response — 200**

```json
{
  "status": "ok",
  "service": "trustedrouter-telnyx-receipt-explorer",
  "version": "1.0.0"
}
```

---

## `GET /api/models`

Returns only models with a currently published Telnyx endpoint marked
`provider_zero_data_retention: true`. The full upstream catalog is fetched
server-side, cached for `MODEL_CACHE_TTL_SECONDS` (default 300 s), and filtered;
it is never proxied to the browser.

**Response — 200**

```json
{
  "models": [
    {
      "id": "z-ai/glm-5.3-flash",
      "name": "GLM 5.3 Flash",
      "contextLength": 131072,
      "promptPriceUsdPerMillion": 1.3926,
      "completionPriceUsdPerMillion": 4.1778,
      "usageTypes": ["Credits"],
      "providerPolicyUrl": "https://telnyx.com/privacy-policy",
      "providerPolicySummary": "Telnyx's published policy states zero data retention for …"
    }
  ],
  "source": "live",
  "fetchedAt": "2026-09-29T23:00:00.000Z",
  "routingControls": {
    "providerOnly": ["telnyx"],
    "minPrivacy": "zdr",
    "allowFallbacks": false
  },
  "inferenceAuthRequired": false
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `models[].id` | `string` | TrustedRouter model id |
| `models[].contextLength` | `number \| null` | null when the catalog omits it |
| `models[].promptPriceUsdPerMillion` | `number \| null` | USD per 1M tokens, from the live catalog |
| `models[].usageTypes` | `string[]` | e.g. `["Credits"]` (prepaid) |
| `source` | `"live" \| "cached" \| "fallback"` | `fallback` = labeled hard-coded list, still validated at inference time |
| `inferenceAuthRequired` | `boolean` | true when `DEMO_ACCESS_TOKEN` is configured |

**Errors** — `429 RATE_LIMITED` (with `Retry-After`).

---

## `POST /api/inference`

Runs one non-streaming inference through TrustedRouter pinned to Telnyx-only ZDR
routes, then verifies the signed receipt locally against the exact request and
response bytes.

**Headers**

| Header | Required | Value |
| --- | --- | --- |
| `Authorization` | When `DEMO_ACCESS_TOKEN` is configured | `Bearer <demo access token>` (or `X-Access-Token: <token>`) |
| `Origin` | Enforced when present | Must match the serving origin (same-origin policy) |

**Request body**

```json
{
  "model": "z-ai/glm-5.3-flash",
  "prompt": "Explain edge inference in one sentence."
}
```

| Field | Type | Constraints |
| --- | --- | --- |
| `model` | `string` | Must be in the current eligible Telnyx ZDR catalog; pattern `[A-Za-z0-9._/-]{1,160}` |
| `prompt` | `string` | 1–`PROMPT_MAX_CHARS` (default 4000) characters |

The client cannot influence the upstream routing object. The server always sends:

```json
{
  "model": "<requested model>",
  "messages": [
    { "role": "system", "content": "Answer clearly and concisely." },
    { "role": "user", "content": "<prompt>" }
  ],
  "max_tokens": 512,
  "stream": false,
  "provider": { "only": ["telnyx"], "min_privacy": "zdr", "allow_fallbacks": false }
}
```

**Response — 200** (inference succeeded; verification may still have failed)

```json
{
  "output": "Edge inference runs a model close to where data is produced.",
  "requestedModel": "z-ai/glm-5.3-flash",
  "selectedModel": "z-ai/glm-5.3-flash",
  "provider": "telnyx",
  "durationMs": 1250,
  "usage": { "promptTokens": 18, "completionTokens": 14, "totalTokens": 32 },
  "verification": {
    "verified": true,
    "nonceMatched": true,
    "requestHashMatched": true,
    "responseHashMatched": true,
    "signatureValid": true,
    "fresh": true,
    "attestationValid": true,
    "issuedAt": "2026-09-29T18:00:00Z",
    "verifiedAt": "2026-09-29T18:00:01Z",
    "failureCode": null,
    "failureMessage": null
  },
  "receipt": { "compact": "eyJ…", "claims": { "rv": 1, "route": "chat.completions" } }
}
```

`selectedModel`, `provider`, and every verification flag are `null` when the
verifier could not establish them — never fabricated. When verification fails,
the response is still HTTP 200 with `verification.verified: false` so the UI can
show the model text alongside a prominent failure state.

**Verification failure codes** (`verification.failureCode`)

| Code | Meaning |
| --- | --- |
| `MISSING_RECEIPT` | Upstream response carried no `x-inference-receipt` header |
| `MALFORMED_RECEIPT` | Header is not a parseable JWS |
| `SIGNATURE` | Ed25519 signature invalid |
| `HASH_MISMATCH` | Request or response digest mismatch over exact bytes |
| `NONCE_MISMATCH` | Receipt nonce does not match this request |
| `STALE_OR_SKEW` | Receipt older than 300 s or outside 60 s future skew |
| `ISSUER_MISMATCH` | Signed `iss` differs from the expected gateway origin |
| `ATTESTATION_UNAVAILABLE` | Pinned attestation document could not be resolved |
| `ATTESTATION` | Attestation digest mismatch or key-binding check failed |
| `MISSING_BINDING` | Exact request/response bytes were not supplied for binding |
| `CLAIMS` / `UPSTREAM_CLAIMS` | Receipt claims failed validation |

**Error responses**

| Status | `error.code` | Trigger |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Missing/oversized prompt, malformed model id, non-JSON body |
| 400 | `UNKNOWN_MODEL` | Model not in the current eligible Telnyx ZDR catalog |
| 401 | `MISSING_TOKEN` / `INVALID_TOKEN` | `DEMO_ACCESS_TOKEN` configured; missing or wrong token |
| 403 | `FORBIDDEN_ORIGIN` | Cross-origin `Origin`/`Sec-Fetch-Site` |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 64 KB |
| 429 | `RATE_LIMITED` | App-level in-memory limiter (per instance), `Retry-After` set |
| 500 | `MISSING_SERVER_KEY` | `TRUSTEDROUTER_API_KEY` not configured |
| 500 | `INTERNAL` | Unexpected failure; details logged without request content |
| 502 | `NO_TELNYX_ROUTE` | Upstream 400 — no route meets the Telnyx+ZDR requirements |
| 502 | `AUTH_FAILED` | Upstream 401/403 — server key rejected |
| 502 | `INSUFFICIENT_CREDITS` | Upstream 402 |
| 502 | `UPSTREAM_ERROR` | Upstream 5xx or malformed upstream JSON |
| 502 | `PROVIDER_MISMATCH` / `MODEL_MISMATCH` | Verified receipt named a different provider/model; response rejected (verification object included) |
| 502 | `NETWORK_ERROR` | Request to TrustedRouter failed before a response |
| 504 | `TIMEOUT` | Upstream exceeded `REQUEST_TIMEOUT_MS` (504 status) |

Error bodies never include upstream response bodies or credentials.
