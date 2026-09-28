# API Reference — Order Status Self-Service

This document describes the HTTP endpoints exposed by the `order-status-self-service` Edge Worker. All routes are handled by the default `fetch` export in `src/index.ts`, which routes incoming requests to the appropriate `OrderAgent` method via the `CUSTOMERS` actor namespace.

---

## Routes Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/rpc/linkOrder` | Links a customer's order to their durable `OrderAgent` (one actor per customer E.164). |
| `POST` | `/webhook/carrier` | Receives carrier status webhooks (shipped / delayed / delivered) and updates durable order state. |
| `POST` | `/webhook/inbound` | Receives Telnyx `inbound-message` callbacks and answers the customer from durable state. |

---

## POST /rpc/linkOrder

Creates or retrieves the `OrderAgent` for the given customer and links an order ID to it.

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `customer` | string | Yes | Customer phone number in E.164 format (e.g. `+15551234567`). |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `orderId` | string | Yes | Unique order identifier from the storefront. |
| `carrier` | string | Yes | Carrier name (e.g. `"fedex"`, `"ups"`). Stored for reference; not used in routing. |

### Example Request

```bash
curl -X POST \
  'https://<worker-subdomain>.telnyx.net/rpc/linkOrder?customer=%2B15551234567' \
  -H 'Content-Type: application/json' \
  -d '{
    "orderId": "ORD-12345",
    "carrier": "fedex"
  }'
```

### Response Schema

**Status Code: 200**

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` on success. |

```json
{
  "ok": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Order successfully linked to the customer's actor. |
| 400 | Missing `customer` query parameter or missing `orderId` / `carrier` in body. |
| 500 | Internal error during actor creation or SQL state initialization. |

---

## POST /webhook/carrier

Receives carrier status update webhooks and routes them to the customer's `OrderAgent` via `onCarrier`.

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `customer` | string | Yes | Customer phone number in E.164 format. |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | string | Yes | One of `"shipped"`, `"delayed"`, `"delivered"`. |
| `orderId` | string | Yes | Order identifier matching a previously linked order. |
| `customer` | string | Yes | Customer phone number in E.164 format (must match query param). |
| `eta` | string | Yes | Estimated time of delivery (ISO 8601 or human-readable). |
| `ts` | number | Yes | Unix timestamp (milliseconds) of the carrier event. |
| `reason` | string | No | Optional reason for delay (only populated for `delayed` events). |

### Example Request

```bash
curl -X POST \
  'https://<worker-subdomain>.telnyx.net/webhook/carrier?customer=%2B15551234567' \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "delayed",
    "orderId": "ORD-12345",
    "customer": "+15551234567",
    "eta": "2025-07-15T17:00:00Z",
    "ts": 1752561600000,
    "reason": "weather delay"
  }'
```

### Response Schema

**Status Code: 200**

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` on success. |

```json
{
  "ok": true
}
```

### Behavior

- **Idempotency**: If the incoming webhook's `status` + `ts` matches the existing record in the `orders` SQL table, the request is a no-op (no duplicate SMS).
- **Shipped / Delivered**: Sends a proactive status SMS to the customer immediately.
- **Delayed**: Schedules a `notifyDelay` task via `this.schedule(0, "notifyDelay", ...)` with a deduplication ID of `delay:<orderId>`. The `notifyDelay` handler checks `lastNotified` to guarantee exactly-once delivery.

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Webhook processed; order state updated and/or proactive SMS scheduled. |
| 400 | Missing `customer` query parameter. |
| 500 | Internal error during SQL update or SMS scheduling. |

---

## POST /webhook/inbound

Receives Telnyx `inbound-message` callbacks and routes them to the customer's `OrderAgent` via `onInboundMessage`.

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `from` | string | Yes | Sender phone number in E.164 format (the customer's number). |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender phone number in E.164 format. |
| `text` | string | Yes | The customer's inbound message text (e.g. `"where's my order?"`). |

### Example Request

```bash
curl -X POST \
  'https://<worker-subdomain>.telnyx.net/webhook/inbound?from=%2B15551234567' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "+15551234567",
    "text": "where is my order?"
  }'
```

### Response Schema

**Status Code: 200**

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` on success. |

```json
{
  "ok": true
}
```

### Behavior

- Reads all linked orders from the `orders` SQL table, ordered by `ts DESC`.
- Generates a plain-language answer using either the OpenAI `createCompletion` binding (live mode) or a built-in demo interpretation (demo mode).
- Sends the answer SMS back to the customer via `this.env.TELNYX.messages.send`.

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Inbound message processed; answer SMS sent (or logged in demo mode). |
| 400 | Missing `from` query parameter. |
| 500 | Internal error during SQL read or SMS send. |

---

## Demo Mode

When `DEMO_MODE=true` is set in the environment:

- No real SMS messages are sent. Instead, messages are logged to the console with the prefix `[DEMO] SMS to <number>: <text>`.
- The OpenAI `createCompletion` call is bypassed; a built-in `demoInterpretation` function generates the plain-language answer based on the order status.

To switch to live mode, set `DEMO_MODE=false` (or unset it) and ensure `TELNYX_API_KEY` is configured as a secret.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes (live mode) | Telnyx API key, injected as a secret via `[[secrets]]` in `telnyx.toml`. |
| `DEMO_MODE` | No | Set to `"true"` to enable demo mode (default). Set to `"false"` or unset for live mode. |
| `SMS_FROM` | No | Default sender phone number for outbound SMS. Falls back to `+1555XXXXXXXX` if unset. |

---

## Actor Identity

The `OrderAgent` is a durable actor keyed by the customer's E.164 phone number via `env.CUSTOMERS.idFromName(customerE164)`. This means:

- Each customer gets exactly one durable actor instance.
- The actor's SQL state (`orders` table) and `CustomerState` (including `lastNotified`) persist across evictions and restarts.
- Follow-up messages in the same thread are answered from the actor's existing state — no re-identification is needed.
