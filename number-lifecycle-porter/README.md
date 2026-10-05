---
name: number-lifecycle-porter
title: "Number Lifecycle Porter — Durable Phone Number Provisioning with Telnyx Edge Actors"
description: "A stateful actor that owns the full phone number lifecycle — search, order, wire, announce, rollback, retire — with restart-safe durability."
language: typescript
framework: edge
telnyx_products: [Numbers API, Phone Numbers API, Messaging, Edge Compute, Stateful Actors, Agent SDK]
---

# Number Lifecycle Porter

A durable Telnyx Edge actor that owns the full phone number lifecycle — from inventory search through rollback — surviving restarts and keeping an audit trail in SQL.

## The Story

A dental group opens a new clinic in San Francisco and needs a local 415 number live by Friday — their online booking system goes live that day, and every missed call is a lost patient. If the number isn't wired to their Call Control app before the launch email hits inboxes, patients hear dead air, trust erodes, and the clinic's first-week revenue walks out the door.

The actor IS the phone number itself. Born the moment an operator calls `@rpc provision`, it searches the Telnyx inventory, places the order, polls until success, wires the number to the Call Control app, and SMSes the on-call team that the new line is live. If the platform reboots mid-poll — between order and wire-up — the actor wakes up, re-polls the same order ID, and completes the wiring with no duplicate charges. When the clinic moves to a different area code next year, `@rpc rollback` reverts the old number's connection and sends a revert SMS, while `@rpc retire` releases the number from the app. Durability is the point: the actor remembers its order ID, its poll timer, and its rollback plan, so no step is ever orphaned.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global telephony platform with real-time voice, messaging, and number management APIs that are purpose-built for stateful, event-driven applications. Unlike generic cloud providers, Telnyx owns the entire communications stack: from the underlying telecom infrastructure to the edge compute layer where actors like `NumberActor` execute with millisecond latency and built-in durability. This means a phone number provisioning workflow doesn't just call an API — it lives inside the same platform that routes the calls and sends the SMS, eliminating external dependencies and ensuring that every lifecycle transition is atomic, auditable, and restart-safe.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/v2/available_phone_numbers` | Search inventory by area code + features (voice, sms) |
| `POST` | `/v2/number_orders` | Create a number order for a candidate E.164 number |
| `GET` | `/v2/number_orders/{id}` | Poll order status until `success`, `failure`, or `cancelled` |
| `PATCH` | `/v2/phone_numbers/{id}` | Wire the number to the Call Control app (`connection_id`, `tags`) |
| `GET` | `/v2/phone_numbers/{id}` | Verify the number's configuration after wire-up |
| `POST` | `/v2/messages` | Send cutover and revert SMS via the `[telnyx]` binding |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Operator / HTTP Console                          │
│                                                                         │
│   POST /provision?areaCode=415   POST /rollback   POST /retire         │
│         │                          │                    │               │
│         ▼                          ▼                    ▼               │
│  env.NUMBERS.idFromName("415:clinic-north")                             │
│         │                          │                    │               │
│         ▼                          ▼                    ▼               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       NumberActor (Agent SDK)                    │   │
│  │                                                                  │   │
│  │  Durable State: { orderId, e164, stage, announced, oldConnId }   │   │
│  │                                                                  │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │   │
│  │  │   Search     │──▶│   Order      │──▶│   Poll       │         │   │
│  │  │ GET /avail_  │   │ POST /orders │   │ GET /orders/ │         │   │
│  │  │ phone_nums   │   │              │   │ {id}         │         │   │
│  │  └──────────────┘   └──────────────┘   └──────┬───────┘         │   │
│  │                                               │                 │   │
│  │                                               ▼                 │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │   │
│  │  │   Wire       │◀──│   Schedule   │◀──│  this.schedule│         │   │
│  │  │ PATCH /phone │   │  (30s poll)  │   │  (pollOrder)  │         │   │
│  │  │ _numbers/{id}│   │              │   │              │         │   │
│  │  └──────┬───────┘   └──────────────┘   └──────────────┘         │   │
│  │         │                                                       │   │
│  │         ▼                                                       │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │   │
│  │  │  Announce    │──▶│   Rollback   │──▶│   Retire     │         │   │
│  │  │ SMS via      │   │ PATCH old    │   │ PATCH null   │         │   │
│  │  │ [telnyx]     │   │ conn_id      │   │ conn_id      │         │   │
│  │  └──────────────┘   └──────────────┘   └──────────────┘         │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  SQL Storage (ORDERS_DB)                                 │   │   │
│  │  │  ┌────────────┐  ┌────────────┐                          │   │   │
│  │  │  │ orders     │  │ events     │                          │   │   │
│  │  │  │ (order_id, │  │ (number,   │                          │   │   │
│  │  │  │  status,   │  │  stage,    │                          │   │   │
│  │  │  │  at)       │  │  at)       │                          │   │   │
│  │  │  └────────────┘  └────────────┘                          │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  [telnyx] Binding (zero-credential API access)                   │   │
│  │  • this.env.TELNYX.messages.send({to, text})                     │   │
│  │  • this.env.TELNYX_api_key via Secrets                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `CC_APP_CONNECTION_ID` | `string` | `123e4567-e89b-12d3-a456-426614174000` | **yes** | Call Control app resource ID to wire numbers to | [Telnyx Mission Control](https://portal.telnyx.com) → Voice → Applications |
| `OPS_SMS_TO` | `string` | `+1555XXXXXXXX` | **yes** | On-call phone number that receives cutover/revert SMS | Your team's ops phone number |
| `NEW_NUMBER_TAG` | `string` | `clinic-north` | **yes** | Tag applied to the new number for identification | Any descriptive label |
| `POLL_INTERVAL_SECS` | `string` | `30` | no | Seconds between order status polls | Default: `30` |
| `POLL_MAX_MINUTES` | `string` | `60` | no | Maximum minutes to wait for order success before timeout | Default: `60` |
| `AREA_CODE` | `string` | `415` | no | Default area code for number search when not specified in request | Any valid NANP area code |
| `DEMO_MODE` | `string` | `true` | no | When `true`, simulates all API calls without real charges | Default: `true` |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-lifecycle-porter

# 2. Install dependencies
npm install

# 3. Create .env from the example
cp .env.example .env
# Edit .env and fill in your real values (see Environment Variables table above)

# 4. Generate TypeScript types from telnyx.toml bindings
npx telnyx-edge types

# 5. Run the smoke test (verifies module loads and classes/methods exist)
npx tsx smoke_test.ts

# 6. Start the local dev server
npx telnyx-edge dev
```

## API Reference

### `POST /provision`

Provisions a new phone number in the given area code and wires it to the Call Control app.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `areaCode` | `string` | no | `AREA_CODE` env var | 3-digit NANP area code to search in |
| `features` | `string` | no | `voice,sms` | Comma-separated list of features (`voice`, `sms`) |

**Response (200):**

```json
{
  "e164": "+14155550123",
  "orderId": "order_demo_14155550123",
  "stage": "ordered"
}
```

**Response (400):**

```json
{
  "error": "Invalid area code: must be 3 digits"
}
```

### `POST /rollback`

Rolls back the provisioned number — reverts the connection ID and sends a revert SMS.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `areaCode` | `string` | no | `AREA_CODE` env var | Area code of the number to roll back |

**Response (200):**

```json
{
  "success": true,
  "message": "Rolled back number +14155550123"
}
```

### `POST /retire`

Releases the number from the Call Control app (does not delete the number from Telnyx).

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `areaCode` | `string` | no | `AREA_CODE` env var | Area code of the number to retire |

**Response (200):**

```json
{
  "success": true,
  "message": "Retired number +14155550123"
}
```

### `GET /health`

Returns service health status.

**Response (200):**

```json
{
  "status": "ok",
  "service": "number-lifecycle-porter"
}
```

### Actor RPC Methods

Each `NumberActor` instance (one per `areaCode:tag` combination) exposes:

| Method | Signature | Description |
|--------|-----------|-------------|
| `provision` | `provision(areaCode: string, features?: string[]): Promise<{e164, orderId, stage}>` | Search → order → schedule poll |
| `pollOrder` | `pollOrder(): Promise<void>` | Scheduled task — polls order status, wires on success |
| `rollback` | `rollback(): Promise<{success, message}>` | Reverts connection ID, sends revert SMS |
| `retire` | `retire(): Promise<{success, message}>` | Releases number from app |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `No available Numbers in area code 415` | Area code has no inventory with requested features | Try a different area code or fewer features |
| `Order creation failed: 400` | E.164 number not from search results | Always use a number returned by `GET /available_phone_numbers` |
| `Order timed out after 60 minutes` | Order stuck in `pending` | Check Telnyx status page; increase `POLL_MAX_MINUTES` |
| `Phone number lookup failed: 404` | Number not yet provisioned in Telnyx | Wait for order `success` status before wiring |
| `Wire-up failed: 403` | Invalid `CC_APP_CONNECTION_ID` | Verify the Call Control app exists in your Telnyx account |
| `SMS send failed` | Invalid `OPS_SMS_TO` or messaging not enabled | Verify the destination number and Telnyx messaging profile |
| Actor doesn't resume after restart | `telnyx.toml` missing `[[actors]]` binding | Ensure `NUMBERS` actor binding is declared in `telnyx.toml` |
| Duplicate orders created | `DEMO_MODE` SQL state not persisted | Ensure `ORDERS_DB` SQL binding is configured in `telnyx.toml` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent for platform integration
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Explore more AI-powered Telnyx examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for LLM integration

## Related Examples

- **DEV-843**: IoT SIM Lifecycle Porter — Stateful actor managing SIM card provisioning, activation, and deactivation via the Telnyx Wireless API
- **DEV-825**: Rate Limiting with Edge Actors — Demonstrates `RateLimiter` bindings and request throttling patterns
- **DEV-809**: Configuration Isolation — Multi-tenant config management using KV namespaces and actor-scoped state

## Resources

- [Telnyx Number Search Docs](https://developers.telnyx.com/docs/numbers/phone-numbers/number-search)
- [Telnyx Number Orders Docs](https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders)
- [List Available Phone Numbers API Reference](https://developers.telnyx.com/api-reference/phone-number-search/list-available-phone-numbers)
- [Create a Number Order API Reference](https://developers.telnyx.com/api-reference/phone-number-orders/create-a-number-order)
- [Update a Phone Number API Reference](https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number)
- [Send a Message API Reference](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Stateful Actors Docs](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Scheduled Tasks Docs](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Edge Runtime SDK](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Telnyx Pricing](https://telnyx.com/pricing)
