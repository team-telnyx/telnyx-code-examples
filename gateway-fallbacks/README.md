---
name: gateway-fallbacks
title: "AI Gateway Fallback & Resilience Desk — Policy-Driven Model Failover with Observable Headers"
description: "Provision an AI Gateway token group with fallbacks and retries, prove failover via x-ltg-served-model / x-ltg-attempts headers, and confirm the same story in the spend ledger."
language: python
framework: flask
telnyx_products: [AI Gateway, Inference, Token Groups, Token Keys, Spend Events]
---

# AI Gateway Fallback & Resilience Desk

Policy-driven model failover with observable headers — provision a token group with `fallbacks` and `retries`, trip the primary on purpose, and prove the gateway served the fallback from both the response headers and the spend ledger.

## The Story

A regional telehealth network runs an after-hours triage assistant that drafts nurse-reviewed summaries of patient intake calls. When a patient describes chest tightness at 2 a.m., the summary has to be in front of a clinician in seconds — not minutes — and a stalled model call is not an inconvenience, it is a patient-safety event and a compliance exposure under the network's clinical documentation policy. The network's engineers cannot control which hosted model has a bad night, but they can control what happens when one does.

The actor IS the triage assistant's inference path. It is born when the platform team provisions a token group that names an allowed model set and declares which model takes over when the primary stalls; it evolves as every intake summary flows through the gateway, quietly retrying definite no-work failures and stepping down the fallback chain on uncertain ones; and it completes each request by reporting which model actually served it and how many attempts it took. When the primary model's first token misses a one-second deadline mid-shift, the path does not die — it hands the request to the fallback model, the clinician still gets the summary, and the ledger records the exact substitution for the next audit. The rest of this README is the API surface of that story.

## Why Telnyx

Failover you cannot observe is failover you cannot trust. Telnyx AI Gateway makes resilience a first-class, policy-driven property of the inference path rather than something you bolt on with client-side retry loops — and it makes that resilience **legible**. Every response carries `x-ltg-served-model` and `x-ltg-attempts`, so the model that actually answered and the number of attempts it took are right there in the headers, not buried in a vendor dashboard. The same story is then independently verifiable in `GET /spend/events`, where `requested_model`, `model`, and `attempts` sit side by side on the ledger row.

This is **AI Communications Infrastructure**: the management plane (`api.telnyx.com/v2/llm_token_gateway`) owns group and key lifecycle, budgets, and reporting; the inference plane (`llm.telnyx.com/v1`) is OpenAI-compatible and takes only a token key; and the observation layer stitches the two together with headers on the live path and spend events on the ledger. Because the gateway owns retries and fallbacks, the sample sets the OpenAI SDK's `max_retries=0` — SDK retries are *additional requests* on top of gateway attempts, which double-bills you and inflates your attempt counts. One retry layer, one bill, one story.

## Telnyx API Endpoints Used

| Plane | Method & Path | Purpose |
|-------|---------------|---------|
| Management | `POST /v2/llm_token_gateway/token_groups` | Create the group: `allowed_models`, `fallbacks`, `retries`, `max_budget`, `budget_duration` |
| Management | `POST /v2/llm_token_gateway/token_keys` | Issue a key scoped to the group (`token_group_id`); secret returned once |
| Management | `PATCH /v2/llm_token_gateway/token_groups/{id}` | `cache_ttl` demo (with `If-Match` + `Idempotency-Key`) |
| Management | `GET /v2/llm_token_gateway/spend/events` | Ledger: `requested_model` vs `model`, `attempts`, `status`, `cache_hit` |
| Management | `GET /v2/llm_token_gateway/usage/summary` | Combined group dashboard (`data.totals`, `data.by_day`, `data.by_model`) |
| Management | `DELETE /v2/llm_token_gateway/token_keys/{id}` | Revoke the key with `If-Match` ETag |
| Management | `DELETE /v2/llm_token_gateway/token_groups/{id}` | Delete the group with `If-Match` ETag |
| Inference | `GET /v1/models` | Model discovery scoped to the calling token key |
| Inference | `POST /v1/chat/completions` | Chat Completions; returns `model` + `x-ltg-served-model` / `x-ltg-attempts` |

**Response headers:** `x-ltg-served-model`, `x-ltg-attempts`
**Per-request overlay headers:** `x-ltg-max-attempts`, `x-ltg-retry-delay`, `x-ltg-backoff`, `x-ltg-request-timeout`

## Architecture

Two planes and one observation layer. The boundary between the planes is where most gateway confusion lives: the management plane takes your Telnyx **account** API key, the inference plane takes only a **token key** and rejects account keys.

```
                    ┌──────────────────────────────────────────────┐
                    │            MANAGEMENT PLANE                  │
                    │  api.telnyx.com/v2/llm_token_gateway         │
                    │  auth: TELNYX_API_KEY (account key)          │
                    │                                              │
                    │  POST /token_groups   ──► group + policy     │
                    │  POST /token_keys     ──► secret (once)      │
                    │  PATCH /token_groups/{id}  (cache_ttl)       │
                    │  GET  /spend/events   ──► ledger rows        │
                    │  GET  /usage/summary  ──► dashboard          │
                    │  DELETE /token_keys/{id}   (If-Match)        │
                    │  DELETE /token_groups/{id} (If-Match)        │
                    └───────────────────┬──────────────────────────┘
                                        │ provisions
                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │            INFERENCE PLANE                   │
                    │  llm.telnyx.com/v1                           │
                    │  auth: token key ONLY (account keys rejected)│
                    │                                              │
                    │  OpenAI SDK  (max_retries=0)                 │
                    │    GET  /models                              │
                    │    POST /chat/completions                    │
                    │                                              │
                    │  gateway owns retries + fallbacks:           │
                    │    Kimi-K3 ──(uncertain failure)──► GLM-5.3  │
                    └───────────────────┬──────────────────────────┘
                                        │ emits
                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │           OBSERVATION LAYER                  │
                    │                                              │
                    │  live path : x-ltg-served-model              │
                    │              x-ltg-attempts                  │
                    │                                              │
                    │  ledger    : GET /spend/events               │
                    │              requested_model vs model        │
                    │              attempts / status / cache_hit   │
                    └──────────────────────────────────────────────┘
```

**Resilience semantics encoded as asserts in `app.py`:**

- Same-model retry only on *definite no-work* failures (pre-dispatch, `429`, `529`).
- *Uncertain* failures (timeout, `408`, `500`, `502`, `503`, `504`) move to the next fallback.
- `max_attempts × (1 + longest chain) ≤ 8` — the attempt ceiling.
- Fallback chain depth ≤ 3, `max_attempts` in `1..5`, no self-reference, no duplicates, every fallback model present in `allowed_models`.
- Context-length rejection is terminal — it does not fall back.

**Reservation model:** budget and TPM capacity for planned attempts are reserved up front and released at settlement. `inference.py` prints the raw budget/reservation fields from a group `GET` after each call so reservation-release behavior is visible regardless of exact field naming.

**Forced-failure mechanism (deterministic, doc-grounded):** the forced-failure run reuses the same group and key. It sends a **streaming** request against the primary with the per-request overlay `x-ltg-request-timeout: 1000` and a deliberately heavy long-form prompt. The overlay applies to streaming attempts until their first provider event, so the primary's first event misses the 1s deadline → timeout → the gateway moves to the fallback. The script asserts `x-ltg-served-model == GLM-5.3-Flash` and `x-ltg-attempts >= 2`; if the primary happens to answer inside 1s, it retries up to 3 times with progressively heavier prompts and reports honestly if the fallback never fired.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `FALLBACK_MODEL` | `string` | `your_fallback_model_here` | **yes** | FALLBACK_MODEL | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `PRIMARY_MODEL` | `string` | `your_primary_model_here` | **yes** | PRIMARY_MODEL | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_INFER_BASE` | `string` | `your_telnyx_infer_base_here` | **yes** | TELNYX_INFER_BASE | — |
| `TELNYX_MGMT_BASE` | `string` | `your_telnyx_mgmt_base_here` | **yes** | TELNYX_MGMT_BASE | — |

## Setup

Clone the repo and move into the sample folder:

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/gateway-fallbacks
```

Create your environment file and fill in your Telnyx account API key:

```bash
cp .env.example .env
```

```dotenv
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_MGMT_BASE=https://api.telnyx.com/v2/llm_token_gateway
TELNYX_INFER_BASE=https://llm.telnyx.com/v1
PRIMARY_MODEL=Kimi-K3
FALLBACK_MODEL=GLM-5.3-Flash
DEMO_MODE=true
PORT=8080
```

Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the smoke test (verifies the module loads and the Flask routes are registered):

```bash
python smoke_test.py
```

Start the service:

```bash
python app.py
```

The five demo steps map to HTTP endpoints. Run them in order:

```bash
# 1. Provision the group + key. The token secret is printed ONCE to stdout.
curl -s -X POST http://localhost:8080/provision

# 2. Inference: list key-scoped models, send a normal call, then force a failure.
curl -s -X POST http://localhost:8080/inference \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "<token key from step 1>"}'

# 3. Ledger: compare requested_model vs model for the key and date range.
curl -s "http://localhost:8080/ledger?token_key_id=<key id>&start_date=2026-01-01&end_date=2026-01-02"

# 4. Policy overlay: tighten attempts/retry/backoff for one request.
curl -s -X POST http://localhost:8080/policy \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "<token key from step 1>"}'

# 5. Teardown: revoke the key, delete the group, confirm revocation.
curl -s -X POST http://localhost:8080/teardown \
  -H 'Content-Type: application/json' \
  -d '{"key_id": "<key id>", "key_etag": "<etag>", "group_id": "<group id>", "group_etag": "<etag>"}'
```

The same logic is importable as plain functions (`provision_group`, `provision_key`, `chat_completion`, `forced_failure_run`, `spend_events`, `per_request_overlay`, `patch_cache_ttl`, `revoke_key`, `delete_group`) if you prefer to drive it from a script instead of HTTP.

**Demo mode vs live mode:** `DEMO_MODE=true` (the default) is safe — no real spend is incurred and the forced-failure run reports honestly if the fallback never fires. Set `DEMO_MODE=false` to run against live models with real budget consumption. See `GUIDE.md` for the full walkthrough.

## API Reference

### `GET /health`

Liveness probe.

```json
{ "status": "ok", "demo_mode": true }
```

### `POST /provision`

Creates the token group (`allowed_models`, `fallbacks`, `retries`, `max_budget: 10`, `budget_duration: "1d"`), validates the policy locally, then issues a token key scoped to the group. The token secret is printed **exactly once** to stdout and never returned in the HTTP body.

```json
{ "group_id": "grp_...", "key_id": "key_...", "secret_shown_once": true }
```

### `POST /inference`

Body: `{ "token_key": "<token key>" }`

Lists the key-scoped models (proves the group's `allowed_models` names are real before any chat call), sends a normal chat completion, then runs the forced-failure path.

```json
{
  "models": ["Kimi-K3", "GLM-5.3-Flash"],
  "normal": { "model": "Kimi-K3", "x-ltg-served-model": "Kimi-K3", "x-ltg-attempts": "1", "streamed": false },
  "forced_failure": {
    "ok": true,
    "tries": 1,
    "result": { "model": "GLM-5.3-Flash", "x-ltg-served-model": "GLM-5.3-Flash", "x-ltg-attempts": "2", "streamed": true }
  }
}
```

### `GET /ledger?token_key_id=&start_date=&end_date=`

Reads `GET /spend/events` over the half-open UTC range `[start_date, end_date)` filtered by `token_key_id`. Each row carries `requested_model`, `model`, `attempts`, `status`, and `cache_hit` — the ledger's record of the same failover the headers showed.

```json
{ "events": [ { "requested_model": "Kimi-K3", "model": "GLM-5.3-Flash", "attempts": 2, "status": "success" } ] }
```

### `POST /policy`

Body: `{ "token_key": "<token key>" }`

Sends one request with the per-request overlay headers `x-ltg-max-attempts: 1`, `x-ltg-retry-delay: 100`, `x-ltg-backoff: constant` — tightening the group policy for a single request without a group `PATCH`.

```json
{ "overlay": { "model": "Kimi-K3", "x-ltg-served-model": "Kimi-K3", "x-ltg-attempts": "1", "streamed": false } }
```

### `POST /teardown`

Body: `{ "key_id", "key_etag", "group_id", "group_etag" }`

Revokes the token key via `DELETE /token_keys/{id}` with `If-Match: <ETag>` and an `Idempotency-Key`, then deletes the group the same way. Confirm revocation by re-running `/inference` with the revoked key — the gateway rejects it.

```json
{ "revoked": true }
```

**Status codes:** `200` success · `400` missing/invalid body fields · `403` `/usage/summary` permission denied (non-fatal warning) · `500` upstream failure (details logged server-side only).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` on `/token_groups` | Account key missing or wrong | Set `TELNYX_API_KEY` in `.env` to your Telnyx **account** API key |
| `401` on `/chat/completions` | Account key used on the inference plane | The inference plane takes the **token key** only — pass the secret from `/provision` |
| Forced-failure run reports `ok: false` | Primary answered inside the 1s deadline | Expected occasionally; the script retries up to 3× with heavier prompts. Lower `x-ltg-request-timeout` or lengthen the prompt |
| `x-ltg-attempts` higher than expected | SDK retries stacked on gateway retries | Confirm the client is built with `max_retries=0` — SDK retries are additional requests and double-bill |
| `400` on group create | Invalid policy config | Check chain depth ≤ 3, `max_attempts` in `1..5`, no self-reference/duplicates, all fallbacks in `allowed_models`, `max_attempts × (1 + longest chain) ≤ 8` |
| `403` on `/usage/summary` | Missing `llm_token_gateway.usage.read` permission | Non-fatal — the spend-events table remains the canonical demo output |
| `412` on `DELETE` | Stale `If-Match` ETag | Re-`GET` the resource and use the fresh ETag |
| Ledger rows empty | Wrong date range or key id | `start_date`/`end_date` are half-open UTC `[start, end)`; verify `token_key_id` |
| Token secret lost | Secret is shown exactly once on create | Revoke the key and issue a new one — the secret is never retrievable again |

## Agent Discovery

- Agent signup: <https://telnyx.com/agent-signup.md>
- Telnyx AI examples: <https://github.com/team-telnyx/ai>
- `llms.txt`: <https://telnyx.com/llms.txt>

## Related Examples

- [Sprint 18 — Multi-Tenant AI Spend Ledger](https://linear.app/telnyx/issue/DEV-1227) — the spend-accounting side of the gateway (DEV-1227); this sample is the resilience side.
- AI Gateway quickstart — provisioning a group and key from scratch.
- AI Gateway usage reporting — `GET /spend/events` and `GET /usage/summary` in depth.

## Resources

- [AI Gateway overview](https://developers.telnyx.com/docs/inference/ai-gateway)
- [Quickstart](https://developers.telnyx.com/docs/inference/ai-gateway/quickstart)
- [Controls: fallback models and retries](https://developers.telnyx.com/docs/inference/ai-gateway/controls)
- [Inference API](https://developers.telnyx.com/docs/inference/ai-gateway/inference-api)
- [Management API](https://developers.telnyx.com/docs/inference/ai-gateway/management-api)
- [Usage reporting](https://developers.telnyx.com/docs/inference/ai-gateway/usage)
- [Get gateway usage summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-usage-summary)
- [Export gateway usage](https://developers.telnyx.com/api-reference/ai-gateway/export-gateway-usage)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx AI Gateway pricing](https://telnyx.com/pricing/inference)
