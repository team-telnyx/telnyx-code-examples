# AI Gateway Fallback & Resilience Desk — Walkthrough

A step-by-step tutorial for the `gateway-fallbacks` sample: provision a token group with policy-driven fallbacks and retries, prove failover on the live path with observable headers, confirm the same story in the spend ledger, and tear everything down safely.

This guide assumes you have the repo checked out and are reading the five scripts (`provision.py`, `inference.py`, `ledger.py`, `policy.py`, `teardown.py`) alongside it, with `gateway.py` as the shared helper module. Every section references the code by feature, not line number, so the guide survives refactors.

## Prerequisites

- Python 3.10+
- A Telnyx [account API key](https://portal.telnyx.com/#/app/api-keys) (management plane)
- The AI Gateway is API-only — no CLI verbs exist for `token_groups`/`token_keys`, so this sample provisions through the Python SDK

## The Two-Plane Boundary

The most common gateway confusion is credential placement, and this sample enforces the split structurally:

- **Management plane** (`api.telnyx.com/v2/llm_token_gateway`, Telnyx **account** API key) owns provisioning and reporting: group and key lifecycle, spend/usage reports, revocation with ETag preconditions.
- **Inference plane** (`llm.telnyx.com/v1`, **token key** only — the gateway rejects account keys here) is the OpenAI-compatible Chat Completions path.
- **Observation layer** reads two signals: response headers (`x-ltg-served-model`, `x-ltg-attempts`) on the live path, and `GET /spend/events` (`requested_model`, `model`, `attempts`) as the ledger.

In `gateway.py` this split is enforced structurally: `mgmt_client()` is the only constructor for management-plane calls, `inference_client()` is the only constructor for inference-plane calls, and only the latter takes a token key. There is no code path where the two credentials cross.

## Step 0 — Configure

```bash
cp .env.example .env          # then set TELNYX_API_KEY
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest smoke_test.py -v   # optional: verify the contracts offline
```

## Step 1 — `provision.py`: the policy, encoded at creation

The group carries the entire failover policy, validated locally *before* any API call (`gateway.validate_policy`):

- `allowed_models`: `["Kimi-K3", "GLM-5.3-Flash"]` — every fallback step must live here.
- `fallbacks`: `{"Kimi-K3": ["GLM-5.3-Flash"]}` — the primary maps to an ordered chain of 1-3 models, no duplicates, no self-reference.
- `retries`: `{"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"}` — same-route retries for definite no-work failures; the attempt ceiling `max_attempts × (1 + longest chain) ≤ 8` is asserted locally and enforced server-side with a 400.
- `max_budget: 10` over `budget_duration: "1d"` — a hard demo budget.

`provision.py` then issues a token key scoped to the group and prints the secret **to stdout exactly once**. It is never written to disk, never logged, and never returned again — copy it immediately:

```bash
export GATEWAY_TOKEN_KEY="<paste the secret>"
```

The script records the group and key IDs in `.gateway_state.json` (IDs only, never the secret) for the later steps.

## Step 2 — `inference.py`: the failover proof

1. **Model discovery.** `GET /v1/models` with the token key proves the group's `allowed_models` names are real before any chat call — a typo'd alias is caught here, not mid-demo.
2. **A normal completion.** Non-streaming against the primary; the headers show the primary served with one attempt. The script also GETs the token group and prints the raw budget/reservation fields — `spend` and `reserved_spend` — so the reservation-release behavior is visible regardless of exact field naming.
3. **The forced-failure run.** The mechanism is doc-grounded and near-deterministic: a **streaming** request against the primary with the per-request overlay `x-ltg-request-timeout: 1000` and a deliberately heavy long-form prompt. The overlay bounds each streaming attempt's time to its *first provider event*, so the primary's first event misses the 1 s deadline → timeout → the gateway classifies an uncertain failure and moves to the fallback. The script asserts `x-ltg-served-model == GLM-5.3-Flash` and `x-ltg-attempts >= 2`; if the primary happens to answer inside 1 s it retries up to 3 times with progressively heavier prompts, and reports honestly (`ok: false`) if the fallback never fired.

## Step 3 — `ledger.py`: the same story, independently verifiable

`GET /spend/events` is read over a half-open UTC window `[start_date, end_date)` filtered by `token_key_id`, with snapshot pagination (the `page_snapshot` cursor is threaded from `meta`). Each printed row puts `requested_model` (what the caller asked for) next to `model` (what actually served) with `attempts`, `status`, and `cache_hit` — when the two model fields differ, that row is the ledger's record of the failover the headers showed.

The step finishes with `GET /usage/summary` (the combined group dashboard: `data.totals`, `data.by_day`, `data.by_model`, guardrail counts). That endpoint requires the dedicated `llm_token_gateway.usage.read` permission; a 403 is a documented, non-fatal warning — the spend-events table remains the canonical demo output.

## Step 4 — `policy.py`: the policy knobs, demonstrated

1. **Per-request overlay.** One request carrying `x-ltg-max-attempts: 1`, `x-ltg-retry-delay: 100`, `x-ltg-backoff: constant` — the group policy tightened for a single request without a group PATCH.
2. **Invalid config is rejected with 400.** A PATCH with `retries.max_attempts: 9` (outside 1..5) is sent with a fresh ETag; the gateway responds 400 and the group is unchanged. This is the same constraint contract `gateway.validate_policy` asserts locally — enforced by the server, proven live.
3. **`cache_ttl` PATCH demo.** PATCH `cache_ttl: 60` (with `If-Match` + `Idempotency-Key`), then send one identical request twice: the second is served from cache — `x-ltg-attempts: 0` — and the ledger row will show `cache_hit: true`. Every PATCH reads a fresh ETag first; a stale one yields 412, which is the docs' read-before-mutate pattern in action.

## Step 5 — `teardown.py`: revoke, delete, and *prove* it

1. Read fresh ETags for the key and the group via GET.
2. `DELETE /token_keys/{id}` with `If-Match` + `Idempotency-Key` — revocation blocks new admissions with the key; requests already admitted may complete.
3. `DELETE /token_groups/{id}` the same way.
4. **Verify the revocation** by re-issuing an inference call with the (now revoked) token key and confirming the gateway rejects it with `401`. Only then is the state file removed.

## Why `max_retries=0`

The OpenAI client is built with `max_retries=0` (`gateway.inference_client`). The gateway's retries and fallbacks are a *policy* with observability — headers, attempt counting, ledger rows. SDK retries are additional requests on top: they double-bill, inflate attempt counts, and break the `x-ltg-attempts` contract. One retry layer, one bill, one story.

## Optional: live dashboard

`python dashboard.py` opens the same demo in a browser at `http://127.0.0.1:8079`: the call log renders `requested_model` vs served model with failover rows highlighted, a budget/reservation gauge shows the reservation model live, and the two action buttons fire the normal call and the forced-failure run server-side (the token key is read from the environment only — never from HTTP input, never returned). The ledger lags a few seconds behind the live header story; the dashboard polls every 3 s so the failover row appears shortly after *FAILOVER PROVEN* is rendered.

## The Semantics Cheat-Sheet

| Failure class | Gateway behavior |
|---------------|------------------|
| Pre-dispatch failure, `429`, `529` | Retry the same step (definite no-work) |
| Timeout, `408`, `500`, `502`, `503`, `504` | Move to the next fallback step (uncertain) |
| Context-length rejection | Terminal — no fallback |
| `max_attempts` ceiling | `max_attempts × (1 + longest chain) ≤ 8`, else 400 |
| Chain rules | 1-3 ordered steps, all in `allowed_models`, no duplicates/self-reference |
| Cache hits | `x-ltg-attempts: 0`, `cache_hit: true` in the ledger |

## Cleaning Up

`teardown.py` is the documented path — it revokes the key, deletes the group, and verifies revocation. If you lose the secret mid-demo, revoke directly (the state file has the IDs) and re-provision: the secret is never retrievable again.
