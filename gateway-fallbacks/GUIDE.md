# AI Gateway Fallback & Resilience Desk — Developer Guide

A hands-on walkthrough of `gateway-fallbacks`, a Python/Flask sample that hardens a production LLM call path with **AI Gateway token-group policy**: model allow-lists, ordered fallback chains, retry budgets, and the two observable signals (`x-ltg-served-model`, `x-ltg-attempts`) that prove failover actually happened — verified against the spend ledger.

This guide assumes you have the repo checked out and are reading `app.py` alongside it. Every section references `app.py` by feature, not line number, so the guide survives refactors.

---

## 1. What you are building (and why it matters)

Most "LLM failover" demos are fiction: they catch an exception, call a second model, and call it resilience. That is not what a gateway does. A gateway encodes the failover policy **server-side**, executes it **inside a single request**, and then tells you what it did via response headers and a ledger row.

This sample makes that contract visible:

- You provision a **token group** with `allowed_models`, a `fallbacks` map, and a `retries` block.
- You issue a **token key** scoped to that group. The secret is shown exactly once.
- You send Chat Completions through `https://llm.telnyx.com/v1` with the OpenAI SDK, `max_retries=0`.
- You read `x-ltg-served-model` and `x-ltg-attempts` off every response.
- You **force** a primary-model failure and assert the gateway served the fallback.
- You confirm the same story from `GET /spend/events`, where `requested_model` differs from the serving `model`.

The whole point is the last two bullets. Headers are the live signal; the ledger is the durable one. If they disagree, you have a bug — and this sample is written so that disagreement is loud.

### Two planes, one observation layer

The single most common source of gateway confusion is mixing up the two API planes. They have different base URLs and **different credentials**.

| Plane | Base URL | Credential | What it does |
|---|---|---|---|
| Management | `api.telnyx.com/v2/llm_token_gateway` | Telnyx **account** API key | Group/key lifecycle, spend reports, revocation |
| Inference | `llm.telnyx.com/v1` | **Token key** only | OpenAI-compatible Chat Completions |

The gateway **rejects account keys on the inference plane**. That is deliberate: a token key is scoped to one group, one budget, one allow-list. Your account key can create and destroy groups; it cannot spend against them.

In `app.py` this split is enforced structurally. `_mgmt_headers()` and `_mgmt_request()` are the only functions that touch the management plane, and they always attach `Authorization: Bearer {ACCOUNT_KEY}`. `_openai_client()` is the only function that touches the inference plane, and it always takes a `token_key` argument. There is no code path where the two credentials cross.

The **observation layer** is not a third API — it is two read paths over the same events:

1. Response headers on the live call (`x-ltg-served-model`, `x-ltg-attempts`).
2. `GET /spend/events` with a `token_key_id` filter (`requested_model`, `model`, `attempts`, `status`, `cache_hit`).

---

## 2. Prerequisites

- Python 3.10 or newer (the code uses `X | None` union syntax in annotations).
- A Telnyx account with AI Gateway access.
- A Telnyx **account API key** (`KEY...`) with permission to manage token groups and keys.
- Network access to both `api.telnyx.com` and `llm.telnyx.com`.

You do **not** need a Telnyx phone number, a messaging profile, or any voice infrastructure. This sample is inference-only.

---

## 3. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

The variables `app.py` reads, and what each one does:

| Variable | Default | Purpose |
|---|---|---|
| `TELNYX_API_KEY` | *(empty)* | Account key for the **management plane**. Required for provisioning, ledger reads, and teardown. |
| `TELNYX_MGMT_BASE` | `https://api.telnyx.com/v2/llm_token_gateway` | Management-plane base URL. Override only for staging. |
| `TELNYX_INFER_BASE` | `https://llm.telnyx.com/v1` | Inference-plane base URL. Override only for staging. |
| `PRIMARY_MODEL` | `Kimi-K3` | The model you want to serve. Must be in the group's `allowed_models`. |
| `FALLBACK_MODEL` | `GLM-5.3-Flash` | The model the gateway moves to when the primary fails. |
| `DEMO_MODE` | `true` | See the next section. |
| `PORT` | `8080` | Flask bind port. |

### Demo mode vs live mode

`DEMO_MODE` defaults to `true`. In demo mode the sample is safe to run repeatedly: it provisions a group with a **$10 / 1-day budget**, sends short prompts with `max_tokens: 256`, and the forced-failure run uses a 1-second timeout overlay so the primary is tripped cheaply. No long generations, no runaway spend.

To run against real production parameters — real budgets, real prompts, real spend — set:

```bash
DEMO_MODE=false
```

The flag is surfaced on `GET /health` so you can always tell which mode a running instance is in:

```json
{"status": "ok", "demo_mode": true}
```

**Start in demo mode.** The forced-failure run is designed to be cheap, but it is still real inference against real models, and it still bills. Get the flow working end-to-end before you point it at a production budget.

---

## 4. Running the sample

```bash
pip install -r requirements.txt
python app.py
```

The service listens on `PORT` (default `8080`). The five demo steps map to five HTTP endpoints, in order:

```bash
# 1. Provision the group and issue a token key.
curl -s -X POST localhost:8080/provision | jq

# 2. Run inference: list models, normal call, forced-failure call.
curl -s -X POST localhost:8080/inference \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "<TOKEN_KEY_FROM_STEP_1>"}' | jq

# 3. Read the ledger for the key.
curl -s "localhost:8080/ledger?token_key_id=<KEY_ID>&start_date=2026-07-01&end_date=2026-07-31" | jq

# 4. Apply the per-request overlay.
curl -s -X POST localhost:8080/policy \
  -H 'Content-Type: application/json' \
  -d '{"token_key": "<TOKEN_KEY_FROM_STEP_1>"}' | jq

# 5. Revoke the key and delete the group.
curl -s -X POST localhost:8080/teardown \
  -H 'Content-Type: application/json' \
  -d '{"key_id": "...", "key_etag": "...", "group_id": "...", "group_etag": "..."}' | jq
```

The token secret is printed to **stdout exactly once**, by `route_provision()`, in the form:

```
[SECRET] token_key=KEY...
```

It is never written to disk, never logged, and never returned in an HTTP response body. If you lose it, revoke the key and provision a new one — that is the intended recovery path, and it is why the create response is the only place the secret appears.

---

## 5. Step 1 — Provisioning the policy (`provision_group`, `provision_key`)

### The group payload

`provision_group()` builds this payload and POSTs it to `/token_groups`:

```python
{
    "name": "gateway-fallbacks-demo",
    "allowed_models": ["Kimi-K3", "GLM-5.3-Flash"],
    "fallbacks": {"Kimi-K3": ["GLM-5.3-Flash"]},
    "retries": {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"},
    "max_budget": 10,
    "budget_duration": "1d",
}
```

Read that carefully, because every field is load-bearing:

- **`allowed_models`** is the universe of models this group may ever touch. Fallback targets must appear here. A fallback to a model outside the allow-list is a config error, not a runtime surprise.
- **`fallbacks`** maps a primary model to an **ordered list** of 1–3 substitutes. Order matters: the gateway walks the list in sequence. The list must not contain duplicates, must not contain the primary itself, and every entry must be in `allowed_models`.
- **`retries.max_attempts`** is 1–5. `retry_delay_ms` is 0–5000 (default 250). `backoff` is `constant`, `linear`, or `exponential`.
- **`max_budget` + `budget_duration`** cap spend. `"1d"` means the budget resets daily.

### The policy validator

Before any HTTP call, `validate_policy()` asserts the constraints in code. This is not decoration — it is the acceptance criterion that says "policy constraints are asserted in code." It checks:

- Every fallback primary is in `allowed_models`.
- Every fallback chain is at most `MAX_CHAIN_DEPTH` (3) long.
- No chain self-references the primary.
- No chain contains duplicates.
- Every fallback target is in `allowed_models`.
- `max_attempts` is between 1 and `MAX_ATTEMPTS` (5).
- **`max_attempts * (1 + longest_chain) <= MAX_TOTAL_ATTEMPTS` (8).**

That last one is the ceiling that matters. If you configure `max_attempts: 5` with a 3-deep fallback chain, the gateway could make 5 × (1 + 3) = 20 provider calls for one client request. The docs cap this at 8. The validator refuses to let you build a config that exceeds it, and the group PATCH endpoint will reject it with a `400` if you try to bypass the validator.

### Issuing the key

`provision_key()` POSTs `{"name": ..., "token_group_id": group_id}` to `/token_keys`. The response contains the secret **once**. `route_provision()` prints it to stdout and returns only `group_id`, `key_id`, and `secret_shown_once: true` in the HTTP body.

---

## 6. Step 2 — Inference and the forced-failure proof (`chat_completion`, `forced_failure_run`)

### Why `max_retries=0`

`_openai_client()` constructs the OpenAI SDK client with `max_retries=0`. This is not a style choice — it is the docs' explicit guidance, and getting it wrong causes **double billing**.

Here is the failure mode. The gateway already retries and falls back according to your group policy. If the SDK *also* retries, then a single logical request becomes N gateway requests, each of which may itself retry and fall back. You pay for every provider call the gateway makes, and the SDK's retries are invisible to your ledger reconciliation because they look like separate client requests. The gateway's retry layer must be the only retry layer.

The README states this explicitly, and the code enforces it in exactly one place so there is no way to accidentally construct a client with retries enabled.

### Reading the observability headers

`chat_completion()` sends the request and then pulls two headers off the raw response object:

```python
served = getattr(resp, "response", None)
headers = dict(served.headers) if served is not None else {}
return {
    "model": resp.model,
    "x-ltg-served-model": headers.get("x-ltg-served-model"),
    "x-ltg-attempts": headers.get("x-ltg-attempts"),
    "streamed": False,
}
```

- **`model`** is the OpenAI-compatible field — what the client asked for, echoed back.
- **`x-ltg-served-model`** is what actually produced the tokens. On a clean call these match. On a failover they do not, and this header is the proof.
- **`x-ltg-attempts`** is how many provider attempts the gateway made. `1` means first try. `>= 2` means something went wrong and the gateway recovered.

The SDK exposes the underlying HTTP response via `resp.response`. That is where the `x-ltg-*` headers live — they are gateway headers, not OpenAI headers, so they will not appear on the parsed completion object.

### The forced-failure mechanism

This is the part people ask about, so here is the reasoning in full.

You cannot reliably force a model to fail. You can send a malformed request, but that is a *definite* failure and the gateway treats it differently from an *uncertain* one. The docs are specific about the distinction:

- **Definite no-work failures** (pre-dispatch errors, `429`, `529`) → **retry the same model**.
- **Uncertain failures** (timeout, `408`, `500`, `502`, `503`, `504`) → **move to the next fallback**.
- **Context-length rejection** → **terminal**, no retry, no fallback.

So to demonstrate failover, you need an *uncertain* failure. The cleanest deterministic one is a **timeout**, and the gateway gives you a per-request overlay header to set one: `x-ltg-request-timeout`, valid range 1,000–60,000 ms, and it applies to **streaming** attempts until their first provider event.

`forced_failure_run()` exploits exactly that:

```python
result = chat_completion(
    token_key, PRIMARY_MODEL, prompt,
    extra_headers={"x-ltg-request-timeout": "1000"},
    stream=True,
)
```

Three things are happening:

1. **`stream=True`** — the timeout overlay only applies to streaming attempts, so the request must stream. The OpenAI SDK returns an iterator; `chat_completion()` consumes the first chunk to trigger the provider event and then reads the headers off `stream_resp.response`.
2. **`x-ltg-request-timeout: 1000`** — the primary has one second to produce its first provider event.
3. **A deliberately heavy prompt** — `"Write a very long detailed essay about distributed systems. " * 40` — so the primary is very unlikely to emit a first token inside one second.

The primary misses the deadline → timeout → the gateway moves to `GLM-5.3-Flash`. The function then asserts:

```python
if served == FALLBACK_MODEL and attempts >= 2:
    return {"ok": True, "result": result, "tries": attempt}
```

If the primary happens to answer inside one second anyway (fast model, warm cache, lucky day), the loop retries up to **3 times** with progressively heavier prompts (`heavy * attempt`). If the fallback still never fires, the function returns `{"ok": False, ...}` — it reports honestly rather than pretending. A demo that lies about its own result is worse than no demo.

### Model discovery

Before any chat call, `route_inference()` calls `list_models(token_key)`, which hits `GET /v1/models` on the inference plane. This is scoped to the calling key, so it returns exactly the group's `allowed_models`. It is a cheap sanity check that the model names you configured are real and reachable before you spend anything on completions.

---

## 7. Step 3 — The ledger (`spend_events`, `usage_summary`)

Headers prove failover happened *now*. The ledger proves it happened *at all*, durably.

`spend_events()` calls `GET /spend/events` with:

```python
{
    "start_date": start_date,
    "end_date": end_date,
    "token_key_id": token_key_id,
    "page[size]": 50,
}
```

Two details worth internalizing:

- **The date range is half-open UTC: `[start_date, end_date)`.** The end date is exclusive. If you want a single day, pass that day as `start_date` and the next day as `end_date`.
- **`token_key_id` scopes the query to one key.** This is how you reconcile a specific workload rather than the whole account.

Each returned row carries `requested_model`, `model`, `attempts`, `status`, and `cache_hit`. The failover story from step 2 appears here as a row where **`requested_model` is `Kimi-K3` and `model` is `GLM-5.3-Flash`**, with `attempts >= 2`. Same event, two views.

### The usage summary (and its permission caveat)

`usage_summary()` calls `GET /usage/summary` for a combined dashboard: `data.totals`, `data.by_day`, `data.by_model`, and guardrail counts.

This endpoint requires the `llm_token_gateway.usage.read` permission. If your account key lacks it, the endpoint returns `403`, and the sample treats that as a **documented, non-fatal warning**:

```python
if resp.status_code == 403:
    app.logger.warning("usage/summary requires llm_token_gateway.usage.read — skipping")
    return {"warning": "permission_denied"}
```

The spend-events table remains the canonical demo output. The summary is a bonus view. Do not let a missing permission block the core walkthrough.

---

## 8. Step 4 — Per-request overlays and the cache demo (`per_request_overlay`, `patch_cache_ttl`)

### Tightening policy for one request

`per_request_overlay()` sends a normal completion with three overlay headers:

```python
extra_headers={
    "x-ltg-max-attempts": "1",
    "x-ltg-retry-delay": "100",
    "x-ltg-backoff": "constant",
}
```

These **override the group policy for this one request only**, with no group PATCH and no persistent state change. This is how you handle a latency-sensitive caller: the group might allow 2 attempts with exponential backoff, but this particular request says "one shot, no retries, fail fast."

The overlay headers are:

| Header | Effect |
|---|---|
| `x-ltg-max-attempts` | Overrides `retries.max_attempts` for this request |
| `x-ltg-retry-delay` | Overrides `retries.retry_delay_ms` |
| `x-ltg-backoff` | Overrides `retries.backoff` |
| `x-ltg-request-timeout` | Streaming-only timeout, 1,000–60,000 ms |

### The `cache_ttl` PATCH

`patch_cache_ttl()` demonstrates the mutation-safety pattern you will use everywhere on the management plane:

```python
resp = _mgmt_request(
    "PATCH", f"/token_groups/{group_id}",
    json={"cache_ttl": ttl},
    headers={"If-Match": etag, "Idempotency-Key": f"cache-ttl-{int(time.time())}"},
)
```

- **`If-Match: <ETag>`** is an optimistic-concurrency precondition. If the group changed since you read its ETag, the PATCH fails rather than clobbering someone else's edit.
- **`Idempotency-Key`** makes the mutation safe to retry. If the response is lost in transit, replaying the same key does not apply the change twice.

After setting `cache_ttl: 60`, an identical repeat request is served from cache. You can see it in two places: `x-ltg-attempts: 0` on the response (zero provider attempts — nothing was dispatched), and `cache_hit: true` on the ledger row.

### The reservation model

The gateway reserves budget and TPM capacity for **planned** attempts up front, then releases the unused portion at settlement. `inference.py` prints the raw budget and reservation fields from a group GET after each call so you can watch the reservation appear and release. The sample prints whatever fields the API returns rather than assuming exact field names — the behavior is visible regardless of naming.

---

## 9. Step 5 — Teardown (`revoke_key`, `delete_group`)

Teardown is two DELETEs, both using the same `If-Match` + `Idempotency-Key` pattern:

```python
def revoke_key(key_id: str, etag: str) -> None:
    resp = _mgmt_request(
        "DELETE", f"/token_keys/{key_id}",
        headers={"If-Match": etag, "Idempotency-Key": f"revoke-key-{key_id}"},
    )
```

Order matters: **revoke the key first, then delete the group.** A group with live keys is not something you want to leave behind, and revoking the key first means the credential is dead before the policy container disappears.

The acceptance criterion is that teardown **verifies revocation** — not just that the DELETE returned `200`, but that the next inference call with that key is **rejected**. A `200` on a DELETE tells you the API accepted the request; it does not tell you the credential stopped working. Confirm the rejection.

---

## 10. The Flask surface

`app.py` exposes the five steps as HTTP endpoints so the sample runs as a service, and the same functions are importable for CLI use.

| Route | Method | Maps to | Notes |
|---|---|---|---|
| `/health` | GET | — | Returns `{"status": "ok", "demo_mode": <bool>}` |
| `/provision` | POST | `provision_group` + `provision_key` | Prints the secret to stdout once |
| `/inference` | POST | `list_models` + `chat_completion` + `forced_failure_run` | Requires `token_key` in the body |
| `/ledger` | GET | `spend_events` | Requires `token_key_id`, `start_date`, `end_date` |
| `/policy` | POST | `per_request_overlay` | Requires `token_key` in the body |
| `/teardown` | POST | `revoke_key` + `delete_group` | Requires `key_id`, `key_etag`, `group_id`, `group_etag` |

Every route wraps its work in `try/except` and returns a **generic** error message on failure:

```python
except Exception:
    app.logger.exception("inference failed")
    return {"error": "inference failed"}, 500
```

The full exception goes to `app.logger.exception()`; the HTTP response says only that the operation failed. This keeps stack traces, request bodies, and any incidental credential material out of client-visible output.

---

## 11. Troubleshooting

**`token_groups create failed: 400`**
Your policy config is invalid. The most common causes: a fallback target not in `allowed_models`, a chain longer than 3, a self-referencing chain, or `max_attempts * (1 + longest_chain) > 8`. `validate_policy()` catches all of these locally before the HTTP call, so if you are seeing a `400` from the API, you bypassed the validator.

**`token_keys create failed: 400`**
The `token_group_id` is wrong or the group was deleted. Re-run `/provision`.

**Inference returns `401` or `403`**
You are almost certainly using the account key on the inference plane. The gateway rejects account keys at `llm.telnyx.com/v1`. Use the token key from `/provision`.

**`x-ltg-served-model` equals the primary on the forced-failure run**
The primary answered inside the 1-second deadline. `forced_failure_run()` already retries up to 3 times with heavier prompts. If it still does not fire, the function returns `{"ok": False, ...}` — that is honest reporting, not a bug. Try a heavier prompt or check whether the primary model is unusually fast for your account.

**`usage/summary` returns `403`**
Your account key lacks `llm_token_gateway.usage.read`. This is non-fatal by design — the sample logs a warning and continues. The spend-events table is the canonical output.

**Ledger returns no rows for a call you just made**
Check the half-open range: `end_date` is **exclusive**. If you queried `start_date=2026-07-01&end_date=2026-07-01`, you asked for an empty interval. Also confirm `token_key_id` matches the key you actually used.

**`DELETE` returns `412 Precondition Failed`**
Your `If-Match` ETag is stale — the resource changed since you read it. Re-read the resource, take the fresh ETag, and retry. This is the precondition doing its job.

---

## 12. Next steps

- [AI Gateway overview](https://developers.telnyx.com/docs/inference/ai-gateway) — the two-plane model and the credential boundary.
- [Quickstart](https://developers.telnyx.com/docs/inference/ai-gateway/quickstart) — first group, first key, first call.
- [Controls: fallback models and retries](https://developers.telnyx.com/docs/inference/ai-gateway/controls) — the authoritative source for the definite-vs-uncertain failure semantics, the max-8 attempt ceiling, and the per-request overlay headers.
- [Inference API](https://developers.telnyx.com/docs/inference/ai-gateway/inference-api) — Chat Completions, `x-ltg-served-model`, `x-ltg-attempts`.
- [Management API](https://developers.telnyx.com/docs/inference/ai-gateway/management-api) — token groups, token keys, ETag preconditions.
- [Usage reporting](https://developers.telnyx.com/docs/inference/ai-gateway/usage) — spend events and the half-open date range.
- [Get gateway usage summary](https://developers.telnyx.com/api-reference/ai-gateway/get-gateway-usage-summary) — the combined dashboard endpoint.
- [Export gateway usage](https://developers.telnyx.com/api-reference/ai-gateway/export-gateway-usage) — bulk export for reconciliation pipelines.

### Where to take this next

- **Wire the ledger into a reconciliation job.** Poll `/spend/events` on a schedule and alert when `requested_model != model` exceeds a threshold — that is your failover rate, and it is a leading indicator of primary-model degradation.
- **Add a second fallback hop.** Extend the chain to `[GLM-5.3-Flash, <third-model>]` and confirm the attempt math still fits under 8. The validator will stop you if it does not.
- **Tune the overlay per caller.** Route latency-sensitive traffic through `x-ltg-max-attempts: 1` and batch traffic through the group default. Same group, different resilience profiles.
- **Track reservation behavior.** Log the group GET after each call and chart reserved-versus-settled spend to see how much capacity your retry budget is holding.
