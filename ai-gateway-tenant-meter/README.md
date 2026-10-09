---
name: ai-gateway-tenant-meter
title: "Multi-Tenant AI Spend Ledger with Telnyx AI Gateway"
description: "A durable per-tenant billing ledger that meters AI usage, enforces budgets, and blocks secret leakage via Telnyx AI Gateway guardrails."
language: typescript
framework: edge
telnyx_products: [AI Gateway, Messaging, Edge Compute, Stateful Actors]
---

# ai-gateway-tenant-meter

A durable per-tenant billing ledger that meters AI usage, enforces budgets, and blocks secret leakage via Telnyx AI Gateway guardrails — with 80%/100% budget alerts by SMS and findings surfaced with codes only.

## The Story

A managed IT support desk serves dozens of small clinics, each running an AI assistant that triages inquiries, schedules appointments, and answers billing questions. The desk bills each clinic monthly for AI usage, but without per-tenant spend controls a runaway conversation could blow a fixed budget — and a support agent pasting a patient's card number into the assistant could leak it to a model.

The actor IS the tenant's billing ledger. Born when a clinic is onboarded via `POST /provision`, it creates a Telnyx AI Gateway token group (30-day budget, secret-blocking guardrails) plus a token key, then runs a durable rollup — an immediate first run at provision time, then on the `ROLLUP_INTERVAL_SECONDS` cadence (60s in this sample for a watchable demo; 3600 is the production default) — that pulls gateway usage and guardrail findings into SQL. At 80% of budget it sends exactly one admin SMS; at 100% it flips the tenant view to read-only while the gateway itself denies further requests with `403 budget_exceeded`. If the platform reboots mid-month, the actor restarts with durable state intact: the SQL rollup resumes, the `alerted80` flag prevents duplicate alerts, and the next budget period resets the guards automatically.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a unified platform where AI inference, messaging, and durable stateful compute converge. The Telnyx AI Gateway meters per-tenant spend and enforces budgets in the same plane as the model, its guardrails inspect prompts and responses for credentials at the boundary, Edge Compute stateful actors give the ledger restart-safe durable state, and the `[telnyx]` binding sends admin SMS with zero credential plumbing — all managed through one API surface.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/llm_token_gateway/token_groups` | POST | Create a per-tenant token group with `max_budget`, `budget_duration: 30d`, and guardrails |
| `/v2/llm_token_gateway/token_keys` | POST | Create the tenant's gateway credential (`token_group_id` in body; one-time secret in `data.token`) |
| `/v2/llm_token_gateway/token_groups/{id}` | GET | Read live `spend`, `resets_at`, and `version` (ETag) |
| `/v2/llm_token_gateway/token_groups/{id}` | PATCH | Adjust `max_budget` (requires `If-Match` precondition) |
| `/v2/llm_token_gateway/usage/summary` | GET | Pull `data.totals`, `data.by_day`, `data.by_model`, and guardrail counts |
| `/v2/llm_token_gateway/guardrail_events` | GET | Pull detector findings — codes and counts only, never matched text |
| `https://llm.telnyx.com/v1/chat/completions` | POST | The tenant assistant calls the model through the gateway with its token key |
| `TELNYX.messages.send` | — | Send admin SMS warnings via the `[telnyx]` binding |

Every gateway mutation (`POST`, `PATCH`, `DELETE`) requires an `Idempotency-Key` header, and every read is wrapped in a `data` envelope. Both are handled by the `GatewayClient` in `src/index.ts`.

## Architecture

```
 Tenant assistant ──(OpenAI-compatible call, Bearer ltg_sk_...)──> https://llm.telnyx.com/v1
                                                                       │
                                                        token_group per tenant:
                                                        max_budget + budget_duration "30d"
                                                        guardrails: secrets block,
                                                        dlp financial flag, streaming buffered
                                                                       │
                                     ┌─────────────────────────────────┴───────────────┐
                                     │              Telnyx Edge Compute                │
                                     │   ┌─────────────────────────────────────────┐   │
                                     │   │        SpendLedger actor (per tenant)   │   │
                                     │   │  @rpc provision()  → POST /token_groups │   │
                                     │   │                      → POST /token_keys │   │
                                     │   │  @rpc spendView()  → GET /usage/summary │   │
                                     │   │                    → GET /guardrail_events  │
                                     │   │  @rpc adjustBudget() → PATCH (If-Match) │   │
                                     │   │  rollup() every hour: usage → SQL,      │   │
                                     │   │    80% → 1 SMS, 100% → SMS + read-only  │   │
                                     │   └─────────────────────────────────────────┘   │
                                     │   ctx.storage.sql: spend_days, alerts,          │
                                     │   guardrail_events (findings keyed by event id) │
                                     └─────────────────────────────────────────────────┘
```

The gateway meters and enforces (spend tracking, `403 budget_exceeded` at 100%, guardrail blocking); the actor remembers (alert history, read-only flag, findings, budget audit). State survives restarts; `resets_at` from the gateway marks the 30-day budget period, and the actor resets its once-per-period alert guards when the period rolls over.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` (secret) | `your_telnyx_api_key_here` | **yes** | Account API key for the AI Gateway management API | [Portal API keys](https://portal.telnyx.com/developer/api-keys) |
| `ADMIN_SMS_TO` | `string` (env) | `+1555XXXXXXX` | **yes** | Ops phone number that receives budget alerts | Your own phone |
| `ADMIN_SMS_FROM` | `string` (env) | `+1555XXXXXXX` | **yes** | Telnyx SMS-capable number to send from | [Numbers](https://portal.telnyx.com/#/numbers/list) |
| `DEMO_MODE` | `string` (secret) | `true` | no | `true` (default) logs SMS to console instead of sending | — |
| `API_TOKEN` | `string` (secret) | `your_shared_api_token_here` | no | When set, `POST /provision`, `GET /spend` and `POST /adjust` require `Authorization: Bearer <token>` | Any random string |
| `ALLOWED_MODELS` | `string` (env) | `Kimi-K2.6,Meta-Llama-3.1-8B-Instruct` | no | Comma-separated model allowlist for new token groups | Defaults to Telnyx-hosted models |
| `ROLLUP_INTERVAL_SECONDS` | `string` (env) | `60` | no | Rollup cadence. `60s` keeps the demo watchable; use `3600` in production | Code default `3600`, clamped 30s–1d |
| `WARN_PCT` | `string` (env) | `80` | no | Budget percentage that triggers the warning SMS | Default `80` |
| `HARD_PCT` | `string` (env) | `100` | no | Budget percentage that flips the tenant view read-only | Default `100` |

> **Agent / CLI access:** Use `telnyx numbers list` to find an SMS-capable `ADMIN_SMS_FROM` and `telnyx messaging-profiles create --name spend-alerts` to route outbound SMS. `TELNYX_API_KEY`, `DEMO_MODE` and `API_TOKEN` are deployed as Edge secrets with `telnyx-edge secrets add <name> <value>`; the `[telnyx]` binding injects messaging at runtime with no key in code.

## Setup

Requires Node.js 22+ and npm.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-gateway-tenant-meter

npm install
cp .env.example .env

# Verify the wire contract offline (no API key needed)
npm run smoke

# Type-check against the real Agent SDK types
npm run typecheck
```

<details><summary>Programmatic / CLI setup</summary>

Inspect the Edge CLI's account, binding and secret commands before deploying:

```bash
telnyx-edge status
telnyx-edge bindings --help
telnyx-edge secrets --help
telnyx-edge ship --help
```

`telnyx.toml` declares the `LEDGERS` actor namespace, the `TELNYX` communications binding, the `TELNYX_API_KEY` / `DEMO_MODE` / `API_TOKEN` secrets and the `ADMIN_SMS_FROM` / `ADMIN_SMS_TO` / `ALLOWED_MODELS` / `WARN_PCT` / `HARD_PCT` env vars. Set `TELNYX_API_KEY` and `ADMIN_SMS_*` before shipping; keep `DEMO_MODE=true` for the first deployed check. Then:

```bash
npm run deploy
curl -s https://<your-deployment>/health
```

</details>

To prove the flow end-to-end against the real gateway, deploy, then seed two tenants — one under budget, one driven over:

```bash
curl -X POST https://<your-deployment>/provision \
  -H 'Content-Type: application/json' \
  -d '{"tenantId": "demo-under", "monthlyBudget": 100}'

curl -X POST https://<your-deployment>/provision \
  -H 'Content-Type: application/json' \
  -d '{"tenantId": "demo-over", "monthlyBudget": 0.00001}'
```

Then spend through `demo-over`'s token key (point an OpenAI-compatible client at `https://llm.telnyx.com/v1` with the returned token key) and watch `GET /spend?tenantId=demo-over` cross the thresholds: the admin SMS fires once per threshold, `readOnly` becomes `true`, and further gateway calls return `403 budget_exceeded`. Note the reservation semantics: a tenant whose budget is smaller than the reservation for a single request is denied *before* spending anything — so seed `demo-over` with a budget a handful of completions can cross (e.g. `0.002`), or lower an existing budget with `POST /adjust` once spend has accrued.

## API Reference

The typed reference lives in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-gateway-tenant-meter/API.md); the walkthrough in [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-gateway-tenant-meter/GUIDE.md). Summary:

### `POST /provision`

```json
{ "tenantId": "acme-clinic", "monthlyBudget": 500.0 }
```

Creates the token group (budget + guardrails) and token key. Returns the gateway base URL, the group/key ids, and the **one-time** token key secret:

```json
{
  "gatewayBaseUrl": "https://llm.telnyx.com/v1",
  "tokenGroupId": "b1946ac9-...",
  "tokenKeyId": "6f2ba101-...",
  "tokenKey": "ltg_sk_...",
  "allowedModels": ["Kimi-K2.6", "Meta-Llama-3.1-8B-Instruct"],
  "alreadyProvisioned": false
}
```

Point the tenant assistant at `gatewayBaseUrl` with `tokenKey` as its API key. Every request the assistant makes is metered against the group budget and inspected by the guardrails policy.

### `GET /spend?tenantId=<tenantId>`

```json
{
  "tenantId": "acme-clinic",
  "monthToDate": 410.5,
  "budget": 500.0,
  "pct": 82,
  "byModel": { "Kimi-K2.6": { "spend": 410.5, "inputTokens": 912340, "outputTokens": 401277 } },
  "guardrails": {
    "blocked": 1,
    "flagged": 3,
    "findings": [{ "day": "2026-10-05", "stage": "prompt", "outcome": "blocked", "detector": "secrets", "code": "stripe_key", "count": 1 }]
  },
  "alerts": [{ "level": "80", "at": "2026-10-05T10:00:00Z" }],
  "readOnly": false,
  "budgetPeriod": { "startedAt": "2026-10-05T22:12:28Z", "resetsAt": "2026-11-04T22:12:28Z" },
  "lastRollupAt": "2026-10-05T23:00:00Z"
}
```

### `POST /adjust`

ETag-preconditioned budget change, audited in actor state:

```json
{ "tenantId": "acme-clinic", "monthlyBudget": 750.0 }
```

```json
{ "ok": true, "maxBudget": 750.0, "groupVersion": 2, "audit": [{ "at": "2026-10-05T23:10:00Z", "from": 500.0, "to": 750.0 }] }
```

### `GET /health`

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `GatewayError` `idempotency_conflict` on retry | Same `Idempotency-Key` reused with a different body | The client generates a fresh UUID per mutation; only reuse a key when retrying the identical request |
| `precondition_failed` (412) on `/adjust` | Another writer changed the group between read and PATCH | Retry: the client re-reads the current version each call |
| `model_not_in_catalog` on provision | Model name not available to the account | Use Telnyx-hosted model names (see the [inference API docs](https://developers.telnyx.com/docs/inference/ai-gateway/inference-api)); BYOK models (e.g. `gpt-4o`) require an attached provider key |
| `Ledger not provisioned for tenant` | `GET /spend` before `POST /provision` | Provision the tenant first |
| SMS not received | `DEMO_MODE` is `true` (default) | SMS is logged to console; set `DEMO_MODE=false` for live sends |
| Spend always `0` in the view | API key lacks `llm_token_gateway.usage.read` | Grant the usage-read permission to the key used by the worker |
| No duplicate alerts after restart | Working as intended | Alert-once guards live in durable state and reset when the gateway's `resets_at` rolls into a new 30-day period |
| `403 budget_exceeded` on inference | Tenant hit 100% of budget | Expected enforcement; `POST /adjust` a higher budget or wait for the period reset |

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

- [KV-Backed Rate Limiter](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/kv-backed-rate-limiter/README.md) — request shaping at the gateway edge (rate, not spend)
- [Edge Cache Invalidation Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cache-invalidation-agent/README.md) — cache hygiene for gateway-served inference
- [Edge Customer Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — the one-actor-per-customer durable pattern
- [Edge Cron Scheduler](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cron-scheduler/README.md) — durable `every()` schedules and SQL history

## Resources

- [AI Gateway Management API](https://developers.telnyx.com/docs/inference/ai-gateway/management-api)
- [AI Gateway Usage Reporting](https://developers.telnyx.com/docs/inference/ai-gateway/usage)
- [AI Gateway Guardrails](https://developers.telnyx.com/docs/inference/ai-gateway/guardrails)
- [AI Gateway Inference API](https://developers.telnyx.com/docs/inference/ai-gateway/inference-api)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Messaging API](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx AI Inference Pricing](https://telnyx.com/pricing/inference-api)
- [Telnyx Edge Compute](https://telnyx.com/edge-compute)
