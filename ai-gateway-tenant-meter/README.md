---
name: ai-gateway-tenant-meter
title: "Multi-Tenant AI Spend Ledger with Telnyx AI Gateway"
description: "A durable per-tenant billing ledger that meters AI usage, enforces budgets, and blocks secret leakage via Telnyx AI Gateway guardrails."
language: typescript
framework: edge
telnyx_products: [AI Gateway, Messaging, Edge Compute, Stateful Actors]
---

# ai-gateway-tenant-meter

A multi-tenant support desk runs every tenant's AI assistant behind the **Telnyx AI Gateway** — one token group per tenant with `max_budget` + `budget_duration: 30d`, plus a guardrails policy so a support agent pasting a customer's card number never reaches the model. The `SpendLedger` actor is the durable per-tenant ledger: a scheduled rollup pulls `usage/summary` + `spend/events`, keeps month-to-date totals in SQL, warns the tenant admin by SMS at 80% of budget, and flips the group's budget action at 100%.

## The Story

A managed IT support desk serves dozens of small medical clinics, each running an AI assistant that triages patient inquiries, schedules appointments, and answers billing questions. The desk operator bills each clinic monthly for their AI usage, but without per-tenant spend controls, a single runaway conversation or a support agent accidentally pasting a patient's credit card number into the assistant could rack up unexpected charges or trigger a HIPAA violation. What's at stake is real money — clinics have fixed monthly AI budgets — and compliance — patient financial data must never reach a model.

The actor IS the tenant's billing ledger. Born when a clinic is onboarded via `provision(tenantId, monthlyBudget)`, it creates a Telnyx AI Gateway token group with a 30-day budget and secret-detection guardrails, then schedules an hourly rollup that pulls usage summaries and upserts per-day spend into SQL. As the month progresses, it watches the spend percentage climb — at 80% it sends exactly one admin SMS warning, and at 100% it flips the tenant's UI into read-only mode while the gateway itself denies further requests with `403 budget_exceeded`. If the platform reboots mid-month, the actor restarts with its durable state intact: the SQL rollup continues from where it left off, the `alerted80` flag prevents duplicate alerts, and the tenant's spend view is served without interruption. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a unified platform where AI inference, real-time communications, and durable compute converge. The Telnyx AI Gateway meters and enforces per-tenant budgets at the network edge, while Telnyx Edge Compute's stateful actors provide the durable, restart-safe ledger that survives pod reboots. Messaging bindings deliver zero-credential SMS alerts, and the entire stack is managed through a single API surface — no stitching together disparate services.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/llm_token_gateway/token_groups` | POST | Create a per-tenant token group with budget + guardrails |
| `/v2/llm_token_gateway/token_groups/{id}/token_keys` | POST | Create a token key for the tenant's assistant |
| `/v2/llm_token_gateway/token_groups/{id}` | PATCH | Update budget/policy on the token group |
| `/v2/llm_token_gateway/usage/summary` | GET | Pull hourly usage totals, by-day, by-model, guardrail counts |
| `/v2/llm_token_gateway/spend/events` | GET | Pull per-request spend rows (cost, tokens, end_user_id) |
| `/v2/llm_token_gateway/guardrail_events` | GET | Pull secret-detection findings (codes only, no matched text) |
| `TELNYX.messages.send` | — | Send admin SMS warnings via the `[telnyx]` binding |

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │              Telnyx Edge Compute              │
                    │                                              │
  Tenant Assistant  │  ┌────────────────────────────────────────┐  │
  (OpenAI-compatible)│  │         SpendLedger Actor              │  │
       │             │  │  (one per tenant, idFromName)          │  │
       │             │  │                                        │  │
       ▼             │  │  @rpc provision()                      │  │
  ┌──────────┐       │  │    → POST /token_groups {budget,       │  │
  │ AI       │       │  │      guardrails, 30d}                 │  │
  │ Gateway  │       │  │    → POST /token_keys                 │  │
  │          │       │  │    → schedule(rollup, cron)           │  │
  │  token_  │       │  │                                        │  │
  │  group   │       │  │  @rpc spendView()                      │  │
  │  (per    │       │  │    → GET /usage/summary               │  │
  │  tenant) │       │  │    → SQL: spend_days, alerts          │  │
  └──────────┘       │  │                                        │  │
       │             │  │  rollup() (hourly)                     │  │
       │             │  │    → GET /usage/summary               │  │
       │             │  │    → SQL upsert spend_days            │  │
       │             │  │    → if 80% & !alerted80: SMS + alert │  │
       │             │  │    → if 100% & !alerted100: SMS +     │  │
       │             │  │       flip UI read-only                │  │
       │             │  └────────────────────────────────────────┘  │
       │             │                                              │
       │             │  ┌────────────────────────────────────────┐  │
       │             │  │         SQL Storage (Durable)          │  │
       │             │  │  spend_days(tenant, day, spend,        │  │
       │             │  │    input_tokens, output_tokens,       │  │
       │             │  │    blocked, flagged)                  │  │
       │             │  │  alerts(tenant, level, at)            │  │
       │             │  │  guardrail_events(tenant, day,        │  │
       │             │  │    blocked, flagged)                  │  │
       │             │  └────────────────────────────────────────┘  │
       │             │                                              │
       │             │  ┌────────────────────────────────────────┐  │
       │             │  │         [telnyx] Binding               │  │
       │             │  │  TELNYX.messages.send({to, from, text})│  │
       │             │  └────────────────────────────────────────┘  │
       │             └──────────────────────────────────────────────┘
       │
       │  (gateway enforces 403 budget_exceeded at 100%)
       ▼
  ┌──────────┐
  │  Model   │
  │  (LLM)   │
  └──────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-gateway-tenant-meter

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your Telnyx API key and admin SMS numbers

# Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_api_key>

# Generate type definitions from telnyx.toml bindings
npm run types

# Run smoke test
npx tsx smoke_test.ts

# Deploy
npm run deploy
```

## API Reference

### `POST /provision`

Provisions a new tenant ledger with a Telnyx AI Gateway token group and key.

**Request Body:**
```json
{
  "tenantId": "acme-clinic",
  "monthlyBudget": 500.00
}
```

**Response (200):**
```json
{
  "gatewayBaseUrl": "https://api.telnyx.com/v2/llm_token_gateway/token_groups/tg_abc123",
  "tokenGroupId": "tg_abc123",
  "tokenKeyId": "tk_def456"
}
```

### `GET /spend?tenantId=<tenantId>`

Returns the month-to-date spend view for a tenant.

**Response (200):**
```json
{
  "tenantId": "acme-clinic",
  "monthToDate": 410.50,
  "budget": 500.00,
  "pct": 82,
  "byModel": {
    "gpt-4o-mini": { "spend": 210.00, "inputTokens": 50000, "outputTokens": 12000 }
  },
  "guardrails": { "blocked": 1, "flagged": 0 },
  "alerts": [{ "level": "80", "at": "2025-07-15T10:00:00Z" }],
  "readOnly": false
}
```

### `GET /health`

Health check endpoint.

**Response (200):**
```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `TELNYX_API_KEY secret not configured` | API key not set in secrets | Run `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `Token group creation failed: 400` | Invalid budget or tenant ID | Check `monthlyBudget` is positive and `tenantId` is ≤128 chars |
| `Ledger not provisioned for this tenant` | `spendView` called before `provision` | Call `POST /provision` first |
| SMS not received in demo mode | `DEMO_MODE` is `true` | SMS is logged to console; set `DEMO_MODE=false` for live SMS |
| Duplicate alerts after restart | State not persisted | Verify SQL storage is configured in `telnyx.toml` |
| `403 budget_exceeded` from gateway | Tenant hit 100% budget | Budget resets after 30 days; or PATCH token group to increase |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **ai-gateway-rate-limiter** — KV-based request rate limiting (DEV-825)
- **multi-tenant-voice-config** — Multi-tenant voice configuration isolation (DEV-809)
- **semantic-cache-gateway** — Semantic caching for AI inference (DEV-1021)

## Resources

- [AI Gateway Management API Docs](https://developers.telnyx.com/docs/inference/ai-gateway/management-api)
- [AI Gateway Usage API Docs](https://developers.telnyx.com/docs/inference/ai-gateway/usage)
- [AI Gateway Controls Docs](https://developers.telnyx.com/docs/inference/ai-gateway/controls)
- [AI Gateway Guardrails Docs](https://developers.telnyx.com/docs/inference/ai-gateway/guardrails)
- [Stateful Actors Docs](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK SQL Docs](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK Scheduled Tasks Docs](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Edge Compute Product Page](https://telnyx.com/edge-compute)
