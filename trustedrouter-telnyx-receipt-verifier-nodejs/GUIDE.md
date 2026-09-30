# Guide: Verifiable Telnyx-only inference with signed receipts

This walkthrough builds up the mental model step by step: pin a request to
Telnyx with a ZDR floor, request a signed receipt, and verify it yourself —
offline — against the exact bytes you exchanged.

## 0. Why this matters

Most "which provider served my request" questions end at a dashboard. This
example goes one step further: the answer is a signed artifact you can check
yourself, months later, with no network access to the vendor.

Three facts stay clearly separated throughout:

1. **TrustedRouter** handled the request through its attested gateway.
2. **TrustedRouter reports** that the route it selected is a Telnyx-hosted
   model under a provider-level ZDR policy.
3. **The receipt proves** integrity and origin of the exact request and
   response bytes — not confidentiality, not legal compliance.

## 1. Prerequisites

- Node.js 20+
- A TrustedRouter API key with credits (create one at trustedrouter.com; set a
  hard daily spend limit for demo keys)
- For deployment: the Telnyx Edge CLI v0.2.3+

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/trustedrouter-telnyx-receipt-verifier-nodejs
cp .env.example .env   # then set TRUSTEDROUTER_API_KEY
npm install
```

## 2. Look at the routing constraint

Open `src/requestBuilder.ts`. Every request the server sends carries:

```json
{
  "provider": {
    "only": ["telnyx"],
    "min_privacy": "zdr",
    "allow_fallbacks": false
  }
}
```

- `only` is an allowlist: candidates outside it are removed; an empty result is
  a `400` from TrustedRouter — inference never starts.
- `min_privacy: "zdr"` is a hard floor: no endpoint with a tracked
  zero-data-retention guarantee means `400`, never a downgrade.
- `allow_fallbacks: false` serves only the single first candidate.

The client cannot change any of this: the browser may choose the model and the
prompt only.

## 3. Run locally

```bash
npm start
# → http://localhost:8080
```

The page loads the live catalog filtered to Telnyx ZDR routes. Today that
includes models such as `z-ai/glm-5.3-flash` (default — it answers directly
without burning tokens on reasoning) and `qwen/qwen3-235b-a22b`. The full list
changes as routes are published; the server always shows what is currently live.

Enter a prompt (or click *Insert sample prompt*) and submit. The browser shows:

1. The model response.
2. Which model and provider the **verified receipt** reports.
3. A verification checklist: nonce, request hash, response hash, signature,
   freshness, attestation binding.
4. An expandable technical section with the safe receipt claims and the compact
   JWS receipt — no secrets.

## 4. What happens on the server

For each submission (`src/server.ts` → `runInference`):

1. Validates the model against the current live Telnyx ZDR catalog.
2. Builds the request body **once** and keeps the exact bytes
   (`Buffer.from(JSON.stringify(bodyObject), "utf8")`).
3. Generates a 32-character nonce from a 64-character alphabet using
   `crypto.randomBytes` — unbiased because 64 is a power of two — within
   TrustedRouter's accepted charset (`A–Z a–z 0–9 _ -`, length 1–88).
4. POSTs to `https://api.trustedrouter.com/v1/chat/completions` with the nonce
   in the `x-inference-receipt` header.
5. Preserves the **raw response bytes** before any parsing.
6. Resolves the attestation document pinned by the receipt (`att_sha256`):
   first via the control-plane key log
   (`GET /.well-known/inference-receipt-keys?kid=…`), then by retrying the
   gateway's per-instance `/receipt-attestation` with `Connection: close`
   until the digest matches.
7. Calls the official verifier (`verifyReceipt` from
   `@lore-hex/trusted-router/receipts`) with the exact request bytes, exact
   response bytes, expected nonce, `maxAgeSeconds: 300`, expected issuer, and
   the attestation bytes.
8. On success, asserts the verified `model.provider === "telnyx"` and
   `model.selected === requested model`. Anything else is rejected — a
   non-Telnyx route is never surfaced as a success.

## 5. Read the receipt claims

Decode the compact receipt (the UI shows this for you). The payload is
`inference-receipt/1`:

```json
{
  "rv": 1,
  "iss": "https://api.trustedrouter.com",
  "iat": 1790718998,
  "nonce": "…your nonce, echoed…",
  "route": "chat.completions",
  "req":  { "alg": "sha256", "hash": "…", "of": "body" },
  "resp": { "alg": "sha256", "hash": "…", "of": "body" },
  "model": { "requested": "…", "selected": "…", "provider": "telnyx", "endpoint": "…@telnyx/prepaid" },
  "upstream": { "tier": "tls-webpki" },
  "att_sha256": "…"
}
```

- `req`/`resp` hashes are unpadded base64url SHA-256 over the **exact bytes**
  you sent and received — that is why the server never re-serializes either side.
- `upstream.tier` names a mechanism (`tls-webpki` or `tee-verified`), never a
  privacy property.
- The signing key lives in a measured, debug-disabled Confidential Space
  workload; the receipt chains to its hardware attestation via `att_sha256`.

## 6. Verify it yourself (fully offline)

```bash
npm run smoke   # live end-to-end: fresh receipt + attestation + verification
```

For manual verification, archive three artifacts together and check them any
time, even years later: the compact receipt, the attestation document bytes
whose SHA-256 equals `att_sha256`, and the exact request/response bytes.

## 7. Deploy to Telnyx Edge Compute

The project is a buildpack-mode Edge function: `index.ts` at the project root
starts its own HTTP server on `process.env.PORT || 8080` and answers `/health`.

```bash
telnyx-edge auth login
telnyx-edge new-func --from-dir=. --name=trustedrouter-telnyx-receipt-verifier
telnyx-edge secrets add TRUSTEDROUTER_API_KEY "sk-tr-v1-..."
telnyx-edge secrets add DEMO_ACCESS_TOKEN "$(openssl rand -hex 16)"
telnyx-edge ship
# → https://trustedrouter-telnyx-receipt-verifier-<id>.telnyxcompute.com
```

Verify the deployment separately — a successful build is not proof of a working
public application:

```bash
curl https://<your-url>.telnyxcompute.com/health
curl -X POST https://<your-url>.telnyxcompute.com/api/inference \
  -H "Authorization: Bearer $DEMO_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Origin: https://<your-url>.telnyxcompute.com" \
  -d '{"model":"z-ai/glm-5.3-flash","prompt":"Say OK."}'
```

## 8. Things that can bite you

- **Reasoning models can return empty text** with a small `max_tokens` — the
  thinking budget consumes it first. `z-ai/glm-5.3-flash` answers directly.
- **The catalog changes.** If a Telnyx route loses its ZDR marking, that model
  disappears from `/api/models` and `/api/inference` rejects it — by design.
- **Receipts cost more**: receipt-enabled managed prepaid requests use a 12%
  total service fee instead of the standard 5.5%.
- **Attestations re-mint on enclave boots.** The key log retains every version,
  so archive the attestation bytes with the receipt if you care about the audit
  trail.
- **The in-memory rate limiter is per instance** and is not a billing control.

## 9. Where to go next

- Read `test/server.test.ts` to see every failure mode covered with mocked
  upstreams, and `test/receiptVerification.test.ts` for the fixture-based
  verification tests.
- Extend with BYOK (`usage: "byok"` routing) to pay Telnyx directly — the
  prepaid v1 path deliberately avoids requiring a Telnyx API key.
- Swap the static UI for your own client; the server contract is the stable
  surface (see `API.md`).
