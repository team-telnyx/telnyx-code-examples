---
name: gateway-fallbacks
title: "AI Gateway Fallback & Resilience Desk — Policy-Driven Model Failover with Observable Headers"
description: "Provision an AI Gateway token group with fallbacks and retries, prove failover via x-ltg-served-model / x-ltg-attempts headers, and confirm the same story in the spend ledger."
language: python
framework: ""
telnyx_products: [AI Gateway, Inference, Token Groups, Token Keys, Spend Events]
---

# AI Gateway Fallback & Resilience Desk

Policy-driven model failover with observable headers — provision a token group with `fallbacks` and `retries`, trip the primary on purpose, and prove the gateway served the fallback from both the response headers and the spend ledger.

## The Story

A regional telehealth network runs an after-hours triage assistant that drafts nurse-reviewed summaries of patient intake calls. When a patient describes chest tightness at 2 a.m., the summary has to be in front of a clinician in seconds — not minutes — and a stalled model call is not an inconvenience, it is a patient-safety event and a compliance exposure under the network's clinical documentation policy. The network's engineers cannot control which hosted model has a bad night, but they can control what happens when one does.

The path IS the triage assistant's inference path. It is born when the platform team provisions a token group that names an allowed model set and declares which model takes over when the primary stalls; it evolves as every intake summary flows through the gateway, quietly retrying definite no-work failures and stepping down the fallback chain on uncertain ones; and it completes each request by reporting which model actually served it and how many attempts it took. When the primary model's first token misses a one-second deadline mid-shift, the path does not die — it hands the request to the fallback model, the clinician still gets the summary, and the ledger records the exact substitution for the next audit. The rest of this README is the API surface of that story.

## Why Telnyx

Failover you cannot observe is failover you cannot trust. Telnyx AI Gateway makes resilience a first-class, policy-driven property of the inference path rather than something you bolt on with client-side retry loops — and it makes that resilience **legible**. Every response carries `x-ltg-served-model` and `x-ltg-attempts`, so the model that actually answered and the number of attempts it took are right there in the headers, not buried in a vendor dashboard. The same story is then independently verifiable in `GET /spend/events`, where `requested_model`, `model`, and `attempts` sit side by side on the ledger row.

This is **AI Communications Infrastructure**: the management plane (`api.telnyx.com/v2/llm_token_gateway`, via the Telnyx Python SDK) owns group and key lifecycle, budgets, and reporting; the inference plane (`llm.telnyx.com/v1`) is OpenAI-compatible and takes only a token key; and the observation layer stitches the two together with headers on the live path and spend events on the ledger. Because the gateway owns retries and fallbacks, the sample builds the OpenAI client with `max_retries=0` — SDK retries are *additional requests* on top of gateway attempts, which double-bills you and inflates your attempt counts. One retry layer, one bill, one story.

## Telnyx API Endpoints Used

| Plane | Method & Path | Purpose |
|-------|---------------|---------|
| Management | `POST /v2/llm_token_gateway/token_groups` | Create the group: `allowed_models`, `fallbacks`, `retries`, `max_budget`, `budget_duration` |
| Management | `GET /v2/llm_token_gateway/token_groups/{id}` | Read policy + budget/reservation state; fetch the ETag before mutations |
| Management | `PATCH /v2/llm_token_gateway/token_groups/{id}` | `cache_ttl` demo and the invalid-config 400 proof (with `If-Match` + `Idempotency-Key`) |
| Management | `POST /v2/llm_token_gateway/token_keys` | Issue a key scoped to the group (`token_group_id`); secret returned only on the create response |
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
            ┌─────────────────────────────┐   ┌─────────────────────────────┐
   step 1   │       MANAGEMENT PLANE      │   │       INFERENCE PLANE       │   steps 2-4
            │ api.telnyx.com/v2           │   │ llm.telnyx.com/v1           │
            │ auth: TELNYX_API_KEY        │   │ auth: token key ONLY        │
            │ (Telnyx Python SDK)         │   │ (OpenAI SDK, max_retries=0) │
            │                             │   │                             │
            │ POST   /token_groups        │   │ GET  /models                │
            │ POST   /token_keys          │──►│ POST /chat/completions      │
            │ PATCH  /token_groups/{id}   │   │                             │
            │ GET    /spend/events        │   │ gateway owns retries +      │
            │ GET    /usage/summary       │   │ fallbacks:                  │
            │ DELETE /token_keys/{id}     │   │   Kimi-K3 ──timeout──► GLM  │
            │ DELETE /token_groups/{id}   │   │                             │
            └──────────────┬──────────────┘   └──────────────┬──────────────┘
                           │ emits                           │ emits
                           ▼                                 ▼
            ┌────────────────────────────────────────────────────────────┐
            │                   OBSERVATION LAYER                        │
            │  live path : x-ltg-served-model  x-ltg-attempts            │
            │  ledger    : GET /spend/events                             │
            │              requested_model vs model, attempts,           │
            │              status, cache_hit                             │
            └────────────────────────────────────────────────────────────┘
```

**Resilience semantics, asserted in `gateway.py`:**

- Same-model retry only on *definite no-work* failures (pre-dispatch, `429`, `529`).
- *Uncertain* failures (timeout, `408`, `500`, `502`, `503`, `504`) move to the next fallback.
- `max_attempts × (1 + longest chain) ≤ 8` — the attempt ceiling.
- Fallback chain depth ≤ 3, `max_attempts` in `1..5`, no self-reference, no duplicates, every fallback model present in `allowed_models`.
- Context-length rejection is terminal — it does not fall back.

**Reservation model:** budget and TPM capacity for planned attempts are reserved up front and released at settlement. After each call, `inference.py` GETs the token group and prints the raw budget/reservation fields (`spend`, `reserved_spend`, `max_budget`, `budget_duration`) so the reservation-release behavior is visible regardless of exact field naming.

**Forced-failure mechanism (doc-grounded, near-deterministic):** the forced-failure run reuses the provisioned group and key. It sends a **streaming** request against the primary with the per-request overlay `x-ltg-request-timeout: 1000` and a deliberately heavy long-form prompt. The overlay bounds each streaming attempt's time to its first provider event, so the primary's first event misses the 1 s deadline → timeout → the gateway moves to the fallback. `inference.py` asserts `x-ltg-served-model == GLM-5.3-Flash` and `x-ltg-attempts >= 2`; if the primary happens to answer inside 1 s it retries up to 3 times with progressively heavier prompts and reports honestly if the fallback never fired.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx **account** API key for the management plane | [Portal → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `PRIMARY_MODEL` | `string` | `Kimi-K3` | no | Primary model alias (default `Kimi-K3`) | AI Gateway model list |
| `FALLBACK_MODEL` | `string` | `GLM-5.3-Flash` | no | Fallback model alias (default `GLM-5.3-Flash`) | AI Gateway model list |
| `GATEWAY_TOKEN_KEY` | `string` | *(printed once by provision.py)* | **yes** (steps 2-5) | The token key secret for the inference plane | `provision.py` output |
| `PORT` | `string` | `8079` | no | Dashboard server port (dashboard only) | — |
| `START_DATE` / `END_DATE` | `string` | `2026-10-19` | no | Ledger window override; defaults to `[today, tomorrow)` UTC | — |

> **Agent / CLI access**
> The AI Gateway management API is API-only — there is no `telnyx` CLI verb for `token_groups`/`token_keys` yet. Provision programmatically with this sample (`python provision.py`), or drive the REST surface directly; for full API discovery point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

## Setup

Clone the repo and move into the sample folder:

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/gateway-fallbacks
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login
# Note: token_groups / token_keys are not yet CLI verbs — this sample
# provisions through the Python SDK instead.
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

Create your environment file and fill in your Telnyx account API key:

```bash
cp .env.example .env
```

```dotenv
TELNYX_API_KEY=your_telnyx_api_key_here
```

Install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the smoke tests (verify the policy asserts, the secret contract, and the failover logic — no network, no credentials):

```bash
python -m pytest smoke_test.py -v
```

Run the five-step demo live. This incurs real, budget-capped spend (`max_budget: 10` USD over `1d`):

```bash
# 1. Provision the group + key. The token secret is printed ONCE to stdout.
python provision.py

# Export the secret for the remaining steps (paste what provision printed).
export GATEWAY_TOKEN_KEY="<paste the secret>"

# 2. Models list, a normal completion, then the forced-failure proof.
python inference.py

# 3. The ledger: requested_model vs served model, attempts, cache_hit.
python ledger.py

# 4. Per-request overlay, invalid-config 400, cache_ttl patch + cache hit.
python policy.py

# 5. Revoke the key, delete the group, verify the revoked key is rejected.
python teardown.py
```

`provision.py` writes a small state file (`.gateway_state.json`, IDs only — never the secret) that the later steps read; `teardown.py` deletes it when the revocation is verified.

### Optional: live dashboard

`python dashboard.py` serves a single-page UI at `http://127.0.0.1:8079` that makes the failover proof presentable: it polls `GET /spend/events` and the token group every 3 s, renders the call log with `requested_model` vs served model, highlights failover rows (`attempts ≥ 2`) and cache hits, shows a budget/reservation gauge, and fires the two demo calls server-side:

- **Normal call (primary)** — one non-stream completion; headers rendered immediately.
- **Force failure (streaming, 1 s timeout)** — the forced-failure run from `inference.py`; when the fallback fires you see *FAILOVER PROVEN* with the header values, and the ledger row appears on the next poll.

Security contract: the dashboard binds to `127.0.0.1` only, reads the token key from the `GATEWAY_TOKEN_KEY` environment variable (never from HTTP input, never returned in any response), and returns generic error messages. The provisioning/teardown lifecycle stays in the CLI scripts.

## API Reference

`app.py` is a thin CLI dispatcher (`python app.py provision|inference|ledger|policy|teardown`); the five steps live in the sibling scripts. The gateway surface each step touches:

| Script | Gateway calls | Key fields |
|--------|---------------|------------|
| `provision.py` | `POST /token_groups`, `POST /token_keys` | `allowed_models`, `fallbacks`, `retries`, `max_budget`, `budget_duration`; key secret (create response only) |
| `inference.py` | `GET /v1/models`, `POST /v1/chat/completions` (+ stream), `GET /token_groups/{id}` | `x-ltg-served-model`, `x-ltg-attempts`, `x-ltg-request-timeout`, `reserved_spend` |
| `ledger.py` | `GET /spend/events` (snapshot pagination), `GET /usage/summary` | `requested_model`, `model`, `attempts`, `status`, `cache_hit`; `data.totals`, `data.by_day`, `data.by_model` |
| `policy.py` | `PATCH /token_groups/{id}` ×2, `POST /v1/chat/completions` | overlay headers; invalid `retries` → **400**; `cache_ttl: 60` → cache hit (`x-ltg-attempts: 0`, `cache_hit: true`) |
| `teardown.py` | `GET` ×2 (ETag), `DELETE /token_keys/{id}`, `DELETE /token_groups/{id}` | `If-Match`, `Idempotency-Key`; post-revocation call must be **401** |
| `dashboard.py` (optional) | local Flask routes only | `GET /api/state`, `POST /api/actions/normal-call`, `POST /api/actions/force-failure`; localhost-only, token key from env |

The typed request/response shapes for every endpoint above are in [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/gateway-fallbacks/API.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` on `token_groups`/`token_keys` | Account key missing or wrong | Set `TELNYX_API_KEY` in `.env` to your Telnyx **account** API key |
| `401` on `/chat/completions` | Account key used on the inference plane | The inference plane takes the **token key** only — export `GATEWAY_TOKEN_KEY` from provision's single print |
| `GATEWAY_TOKEN_KEY is not set` | Secret was not exported after provision | The secret is never stored — revoke the key (`teardown.py` with IDs in the state file) and re-provision |
| Forced-failure run reports the fallback never fired | Primary answered inside the 1 s deadline | Expected occasionally; the script retries up to 3× with heavier prompts. Rerun, or lower `FORCED_FAILURE_TIMEOUT_MS` |
| `x-ltg-attempts` higher than expected | SDK retries stacked on gateway retries | Confirm the client is built with `max_retries=0` — SDK retries are additional requests and double-bill |
| `400` on group create or PATCH | Invalid policy config | Check chain depth ≤ 3, `max_attempts` in `1..5`, no self-reference/duplicates, all fallbacks in `allowed_models`, `max_attempts × (1 + longest chain) ≤ 8` |
| `412` on PATCH/DELETE | Stale `If-Match` ETag | Re-`GET` the resource and use the fresh ETag (the scripts do this automatically) |
| `403` on `/usage/summary` | Missing `llm_token_gateway.usage.read` permission | Non-fatal — the spend-events table remains the canonical demo output |
| Ledger rows empty | Wrong date range or key id | `start_date`/`end_date` are half-open UTC `[start, end)`; set `START_DATE`/`END_DATE` or verify the key id in `.gateway_state.json` |
| Token secret lost | Secret is shown exactly once on create | Revoke the key and issue a new one — the secret is never retrievable again |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Sprint 18 — Multi-Tenant AI Spend Ledger (DEV-1227)](https://linear.app/telnyx/issue/DEV-1227/sprint-18-multi-tenant-ai-spend-ledger) — the spend-accounting side of the gateway; this sample is the resilience side.
- AI Gateway quickstart — provisioning a group and key from scratch ([docs](https://developers.telnyx.com/docs/inference/ai-gateway/quickstart)).
- AI Gateway usage reporting — `GET /spend/events` and `GET /usage/summary` in depth ([docs](https://developers.telnyx.com/docs/inference/ai-gateway/usage)).

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
