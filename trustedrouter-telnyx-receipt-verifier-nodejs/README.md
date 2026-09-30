---
name: trustedrouter-telnyx-receipt-verifier-nodejs
title: "TrustedRouter → Telnyx Receipt Explorer"
description: "Browser receipt explorer: send a prompt through TrustedRouter pinned to Telnyx-only zero-data-retention routes, then locally verify the signed inference receipt (signature, exact request/response hashes, nonce, freshness, attestation). Deployable to Telnyx Edge Compute."
language: typescript
framework: edge
telnyx_products: [Edge Compute, AI Inference]
---

# TrustedRouter → Telnyx Receipt Explorer

A small Node.js service and browser UI that sends an OpenAI-compatible inference request through [TrustedRouter](https://trustedrouter.com) pinned to Telnyx-only, zero-data-retention (ZDR) routes, then verifies the signed inference receipt locally — offline, byte-for-byte.

## What this example demonstrates

- **Provider pinning, fail-closed**: every request carries `provider.only = ["telnyx"]`, `provider.min_privacy = "zdr"`, and `provider.allow_fallbacks = false`. If no Telnyx route satisfies the ZDR floor, TrustedRouter returns `400` before inference — the app never silently degrades to another provider.
- **Signed receipts per request**: each call sends a fresh cryptographically random nonce in the `x-inference-receipt` header and stores the compact JWS receipt from the response header.
- **Local receipt verification**: the official TrustedRouter JavaScript verifier (`@lore-hex/trusted-router/receipts`) checks the Ed25519 signature, the SHA-256 digests over the **exact request and response bytes**, the nonce echo, receipt freshness (≤ 300 s), and the hardware-attestation binding of the signing key.
- **Fail-closed routing checks**: after verification, the app rejects responses whose verified receipt reports a provider other than `telnyx` or a model other than the one requested.
- **Telnyx Edge Compute deployment**: the same service ships to Edge Compute's buildpack mode (`func.toml`), starts its own HTTP server on the platform-provided port, and keeps both secrets server-side.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — voice, messaging, and AI inference on one private global network, with its own GPUs for hosted inference. This example demonstrates the property that matters most for sensitive workloads: a hard, verifiable routing constraint (Telnyx-only + ZDR floor) instead of a soft preference, plus a signed receipt that lets *you* — not the vendor's dashboard — prove where your bytes went.

## Telnyx API Endpoints Used

| Route | Purpose |
| --- | --- |
| TrustedRouter `POST https://api.trustedrouter.com/v1/chat/completions` | OpenAI-compatible inference with the Telnyx-only ZDR routing object and receipt nonce header |
| TrustedRouter `GET https://api.trustedrouter.com/v1/models` (public) | Live model catalog filtered server-side to Telnyx ZDR-eligible endpoints |
| TrustedRouter control plane `GET https://trustedrouter.com/.well-known/inference-receipt-keys?kid=…` | Resolve the attestation document pinned by a compact receipt |
| TrustedRouter gateway `GET https://api.trustedrouter.com/receipt-attestation` | Per-instance attestation fallback |
| Telnyx Inference `POST /v2/ai/openai/chat/completions` | The upstream Telnyx-hosted model that actually serves each pinned request (via TrustedRouter) |
| Telnyx Edge Compute | Container/buildpack deployment target (`telnyx-edge ship`) |

The application never calls Telnyx APIs directly in the prepaid v1 path — the TrustedRouter key covers billing. Telnyx API keys are not required.

## Architecture

```
┌──────────────┐   model + prompt    ┌────────────────────────────┐
│  Browser UI  │ ──────────────────▶ │  Node.js service           │
│  (static)    │   POST /api/inference│  - validates model vs live │
└──────────────┘                     │    Telnyx ZDR catalog      │
                                     │  - builds exact JSON bytes │
                                     │  - fresh receipt nonce     │
                                     └───────┬────────────────────┘
                                             │  provider: only ["telnyx"]
                                             │  min_privacy: "zdr"
                                             │  allow_fallbacks: false
                                             │  x-inference-receipt: <nonce>
                                             ▼
                                     ┌────────────────────────────┐
                                     │  TrustedRouter gateway     │
                                     │  (attested)                │
                                     └───────┬────────────────────┘
                                             │ pinned route
                                             ▼
                                     ┌────────────────────────────┐
                                     │  Telnyx Inference          │
                                     │  POST /v2/ai/openai/       │
                                     │  chat/completions          │
                                     └───────┬────────────────────┘
                                             │
              x-inference-receipt (compact JWS) ◀──────────┘
                                             │
        ┌────────────────────────────────────┘
        ▼
┌────────────────────────────┐     ┌───────────────────────────────────┐
│  Verify receipt locally    │     │  Attestation resolution           │
│  @lore-hex/trusted-router  │     │  key log ?kid= → /receipt-attestation│
│  exact request bytes       │     │  SHA-256 must equal att_sha256    │
│  exact response bytes      │     └───────────────────────────────────┘
│  nonce · ≤300 s · Ed25519  │
│  attestation key binding   │
└──────────────┬─────────────┘
               ▼
        Browser shows: model output + verification evidence
        (or a prominent Verification failed state)
```

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TRUSTEDROUTER_API_KEY` | **Yes** | Server-side TrustedRouter authentication. Never sent to the browser. Use a dedicated key with a hard daily spend limit for demos. |
| `DEMO_ACCESS_TOKEN` | Recommended for deployments | Protects the paid `/api/inference` endpoint. The browser stores it in `sessionStorage` only. |
| `PORT` | No | HTTP port (Telnyx Edge provides it; default `8080`). |
| `PROMPT_MAX_CHARS` | No | Maximum prompt length, default `4000`. |
| `MODEL_CACHE_TTL_SECONDS` | No | Public catalog cache lifetime, default `300`. |
| `REQUEST_TIMEOUT_MS` | No | TrustedRouter request timeout, default `90000`. |

> **Agent / CLI access** — provision this example's Edge deployment and secrets with the Telnyx CLI:
>
> ```bash
> telnyx-edge auth login
> telnyx-edge new-func --from-dir=. --name=trustedrouter-telnyx-receipt-verifier
> telnyx-edge secrets add TRUSTEDROUTER_API_KEY "<your key>"
> telnyx-edge secrets add DEMO_ACCESS_TOKEN "<your token>"
> telnyx-edge ship
> ```
>
> The Telnyx API key (`TELNYX_API_KEY`) is not required for the prepaid v1 path; it is reserved for a future bring-your-own-key extension. Browse the [Telnyx CLI reference](https://developers.telnyx.com/development/cli) and the [Edge Compute CLI](https://github.com/team-telnyx/edge-compute).

## Privacy, ZDR, and what the receipt proves

This section is the contract; the app repeats it in the UI.

- The selected Telnyx route is **required** to satisfy TrustedRouter's provider-level ZDR classification. A missing route fails closed with `400` — never a downgrade.
- TrustedRouter currently describes eligible Telnyx hosted-chat routes as **policy-backed ZDR**: per [Telnyx's published policy](https://telnyx.com/privacy-policy), content for `/v2/ai/openai/chat/completions` is processed in memory and discarded after the response, while request metadata may still be retained. This is a policy claim, not a hardware-attested guarantee, and it is not confidential compute or provider E2EE.
- A signed receipt proves **integrity and origin**: that this exact request produced this exact response on the named model, provider, and endpoint, signed by a key committed inside a measured, debug-disabled Confidential Space workload, and (with your nonce) that the receipt was minted for your request rather than replayed.
- A receipt does **not** prove confidentiality. This application's server receives the prompt before TrustedRouter does; the receipt never covers the browser-to-server hop, and a relay holding a valid receipt can also read everything.
- The application does not intentionally persist or log prompt or completion content. Logs carry only request IDs, route, status, duration, model/provider names, token counts, and verification status.

## Setup

### Prerequisites

- Node.js 20 or later
- A [TrustedRouter API key](https://trustedrouter.com) with credits and a hard daily spend limit
- (For deployment) the [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.3+ and a Telnyx account

### 1. Clone and configure

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/trustedrouter-telnyx-receipt-verifier-nodejs
cp .env.example .env
# Edit .env — set TRUSTEDROUTER_API_KEY (and DEMO_ACCESS_TOKEN for a shared deployment)
```

<details>
<summary>Programmatic / CLI setup</summary>

Provision the Edge deployment from the command line — no portal clicking:

```bash
# Authenticate the Edge CLI (interactive OAuth, or headless with an API key)
telnyx-edge auth login
# or: telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>

# Register this project as an Edge function (writes func_id into func.toml)
telnyx-edge new-func --from-dir=. --name=trustedrouter-telnyx-receipt-verifier

# Store secrets — they are injected as environment variables at runtime
telnyx-edge secrets add TRUSTEDROUTER_API_KEY "sk-tr-v1-..."
telnyx-edge secrets add DEMO_ACCESS_TOKEN "$(openssl rand -hex 16)"

# Inspect status, logs, and revisions
telnyx-edge list
telnyx-edge logs trustedrouter-telnyx-receipt-verifier --tail
telnyx-edge deployments trustedrouter-telnyx-receipt-verifier
```

The [Agent CLI](https://github.com/team-telnyx/ai/tree/main/cli) can drive the same steps non-interactively.
</details>

### 2. Install, test, run

```bash
npm install
npm test          # 57 unit + mocked integration tests (2 network-guarded skips)
npm run typecheck
npm start         # serves the UI at http://localhost:8080
```

### 3. Optional: live smoke test (spends a few credits)

```bash
export TRUSTEDROUTER_API_KEY="sk-tr-v1-..."
npm run smoke
```

The smoke test sends one low-token request and **fails** unless: a completion is returned, the verified provider is `telnyx`, the selected model is in the live Telnyx ZDR catalog, a receipt is present, local verification succeeds (signature, hashes, nonce, freshness, attestation), and the text is non-empty. It prints a safe summary only — never the key, the prompt, the completion, or the full compact receipt.

### 4. Deploy to Telnyx Edge Compute

```bash
telnyx-edge ship
# wait for: ✅ Func '...' is now deployed!  → https://<func-name>-<id>.telnyxcompute.com
curl https://<your-url>.telnyxcompute.com/health
```

`ship` uploads the project, builds it with the buildpack, and deploys an immutable revision. The TypeScript entrypoint (`index.ts` at the project root) starts its own HTTP server on `process.env.PORT || 8080` and answers `/health` for platform probes.

## Expected successful result

`GET /api/inference` returns the model output plus verification evidence:

```json
{
  "output": "Edge inference runs the model near the user.",
  "requestedModel": "z-ai/glm-5.3-flash",
  "selectedModel": "z-ai/glm-5.3-flash",
  "provider": "telnyx",
  "durationMs": 3570,
  "usage": { "promptTokens": 30, "completionTokens": 295, "totalTokens": 325 },
  "verification": {
    "verified": true,
    "nonceMatched": true,
    "requestHashMatched": true,
    "responseHashMatched": true,
    "signatureValid": true,
    "fresh": true,
    "attestationValid": true,
    "issuedAt": "2026-09-29T23:07:51.000Z",
    "verifiedAt": "2026-09-29T23:07:54.000Z",
    "failureCode": null,
    "failureMessage": null
  },
  "receipt": {
    "compact": "eyJhbGciOiJFZERTQSIsInR5cCI6ImluZmVyZW5jZS1yZWNlaXB0K2p3cyJ9…",
    "claims": { "rv": 1, "route": "chat.completions", "upstreamTier": "tls-webpki", "attestationStatus": "verified" }
  }
}
```

A verified receipt must name `provider: "telnyx"`; any other value is rejected with `PROVIDER_MISMATCH` even if the model response succeeded.

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/trustedrouter-telnyx-receipt-verifier-nodejs/API.md) for the typed endpoint reference and [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/trustedrouter-telnyx-receipt-verifier-nodejs/GUIDE.md) for a step-by-step walkthrough.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NO_TELNYX_ROUTE` (upstream 400) | No Telnyx endpoint currently satisfies the ZDR floor for that model | Pick another model from the live `/api/models` list; the catalog changes as routes are published |
| `MISSING_SERVER_KEY` | `TRUSTEDROUTER_API_KEY` not set in the server environment | Set it in `.env` locally or via `telnyx-edge secrets add` |
| `MISSING_TOKEN` / `INVALID_TOKEN` | Deployment requires `DEMO_ACCESS_TOKEN` | Paste the token into the form (stored in `sessionStorage`) |
| `UPSTREAM_RATE_LIMITED` | TrustedRouter spend-window limit hit | Honor `Retry-After`; raise the key's budget or slow down |
| `INSUFFICIENT_CREDITS` | TrustedRouter key out of credits | Top up the key |
| `VERIFICATION_FAILED: ATTESTATION_UNAVAILABLE` | Attestation document could not be resolved (key log unreachable) | Retry; the gateway fallback re-resolves per instance |
| `VERIFICATION_FAILED: STALE_OR_SKEW` | Receipt older than 300 s or clock skew | Don't cache and replay receipts; check system clock |
| `TIMEOUT` | Model spent the token budget on reasoning | Use a faster model (e.g. `z-ai/glm-5.3-flash`) or a shorter prompt |
| `403 FORBIDDEN_ORIGIN` | Cross-origin request | Serve the UI from the same origin as the API |
| `429 RATE_LIMITED` | App-level in-memory limiter (per instance) | Not a billing control — configure key spend limits for real cost control |
| Empty completion text | Reasoning models can spend `max_tokens` before visible text | The default `max_tokens` is 512; try `z-ai/glm-5.3-flash`, which answers directly |
| Edge build fails on `npm test` | The buildpack runs the entrypoint, not the tests | Tests are local-only; `telnyx-edge ship` needs only `npm install` + `index.ts` |

## Security and cost controls

- The TrustedRouter API key stays server-side; browser bundles never embed it.
- Deployed paid inference is protected by `DEMO_ACCESS_TOKEN` (constant-time comparison).
- The in-memory rate limiter is **per instance** and best-effort — it is not a global billing control. Use a TrustedRouter key with a hard daily spend limit for real cost control.
- Strict security headers (CSP with `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `no-referrer`), same-origin enforcement, 64 KB body cap, finite upstream timeouts, and `Cache-Control: no-store` on API routes.
- Logging never contains authorization headers, tokens, prompts, completions, raw bodies, or receipts.

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [Multi-Model Inference Switcher (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/README.md)
- [Edge Customer Agent (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md)
- [Edge URL Summarizer (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-url-summarizer/README.md)
- [Chat with AI Assistant (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md)

## Resources

- [TrustedRouter signed inference receipts](https://trustedrouter.com/docs/receipts) — receipt format, claims, attestation chain
- [TrustedRouter provider routing and pinning](https://trustedrouter.com/docs/provider-routing) — `only`, `min_privacy`, `allow_fallbacks` semantics
- [TrustedRouter Telnyx provider page](https://trustedrouter.com/providers/telnyx) — current routes, ZDR posture, policy sources
- [TrustedRouter JavaScript SDK](https://www.npmjs.com/package/@lore-hex/trusted-router) — `verifyReceipt`, attestation helpers
- [Telnyx privacy policy](https://telnyx.com/privacy-policy) — the ZDR policy source cited by the router
- [Telnyx Inference product page](https://telnyx.com/products/inference) and [Inference pricing](https://telnyx.com/pricing/inference-api)
- [Telnyx Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) — `new-func`, `ship`, secrets
- [Telnyx JavaScript SDK](https://developers.telnyx.com/development/sdk/javascript) — for the broader Telnyx API surface
- [Telnyx Developer Docs](https://developers.telnyx.com) · [Telnyx Portal](https://portal.telnyx.com)
