# API Reference — Text-Back Front Desk

This document describes the HTTP endpoints exposed by the `text-back-front-desk` Edge Function. All routes are webhook receivers that forward events to the durable `FrontDesk` actor via the Telnyx Agent SDK.

---

## Table of Contents

1. [POST /webhook/inbound-message](#post-webhookinbound-message)
2. [POST /webhook/delivery-update](#post-webhookdelivery-update)

---

## POST /webhook/inbound-message

Receives an inbound SMS from a customer and dispatches it to the `FrontDesk` actor for that customer's phone number (one actor per E.164 thread).

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.from.phone_number` | string | Yes | The customer's E.164 phone number (used as the thread ID). |
| `data.payload.to[0].phone_number` | string | Yes | The clinic's Telnyx phone number receiving the message. |
| `data.payload.message.text` | string | Yes | The body of the customer's inbound SMS. |
| `data.payload.message.id` | string | No | Telnyx message ID for the inbound message. |
| `data.payload.message.timestamp` | string | No | ISO 8601 timestamp of the inbound message. |

### Example Request (curl)

```bash
curl -X POST https://<edge-function-url>/webhook/inbound-message \
  -H "Content-Type: application/json" \
  -H "User-Agent: Telnyx-Webhook" \
  -d '{
    "data": {
      "payload": {
        "from": { "phone_number": "+15551234567" },
        "to": [{ "phone_number": "+15559998888" }],
        "message": {
          "id": "msg_abc123",
          "text": "I need a cleaning next week",
          "timestamp": "2025-07-28T10:30:00Z"
        }
      }
    }
  }'
```

### Response Schema

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "ok" }` | Message forwarded to the actor successfully. |
| `400` | `{ "error": "Bad Request" }` | Missing required fields (`from`, `text`). |
| `404` | `{ "error": "Not Found" }` | Unknown route. |
| `500` | `{ "error": "Internal Server Error" }` | Unexpected error during dispatch. |

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Inbound message accepted and forwarded to the `FrontDesk` actor. |
| 400 | Request body missing required fields (`from.phone_number` or `message.text`). |
| 404 | Route not recognized. |
| 500 | Internal error — logged server-side; no details returned to caller. |

---

## POST /webhook/delivery-update

Receives delivery status updates for outbound SMS messages (confirmations, reminders, offers). If a message is marked `undelivered` or `failed`, the function triggers a single retry by forwarding the event to the `FrontDesk` actor for the recipient's phone number.

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.message_id` | string | Yes | Telnyx ID of the outbound message. |
| `data.payload.status` | string | Yes | Delivery status: `delivered`, `undelivered`, `failed`, `sending`, or `sent`. |
| `data.payload.to[0].phone_number` | string | Yes | The recipient's E.164 phone number (used to route to the correct actor). |
| `data.payload.from.phone_number` | string | No | The sender's (clinic's) phone number. |
| `data.payload.error_code` | string | No | Telnyx error code if the message failed. |
| `data.payload.error_description` | string | No | Human-readable error description if the message failed. |

### Example Request (curl)

```bash
curl -X POST https://<edge-function-url>/webhook/delivery-update \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "message_id": "msg_xyz789",
        "status": "undelivered",
        "to": [{ "phone_number": "+15551234567" }],
        "from": { "phone_number": "+15559998888" },
        "error_code": "E100",
        "error_description": "Carrier rejected message"
      }
    }
  }'
```

### Response Schema

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "ok" }` | Delivery update processed (or retry dispatched). |
| `400` | `{ "error": "Bad Request" }` | Missing required fields (`status` or `to.phone_number`). |
| `404` | `{ "error": "Not Found" }` | Unknown route. |
| `500` | `{ "error": "Internal Server Error" }` | Unexpected error during processing. |

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Delivery update acknowledged. If `undelivered`/`failed`, a retry was dispatched to the actor. |
| 400 | Request body missing required fields (`status` or `to.phone_number`). |
| 404 | Route not recognized. |
| 500 | Internal error — logged server-side; no details returned to caller. |

---

## Actor Internal RPC Methods

The `FrontDesk` actor exposes the following internal async methods (invoked via the Agent SDK's `schedule()` and `fetch()` dispatch, not directly over HTTP):

### `onMessage(text, from, to)`

Processes an inbound customer message: runs LLM intent extraction, checks availability, offers slots, books, reschedules, or cancels.

### `remind({ kind })`

Fires on the scheduled 24h (`d1`) or 1h (`h1`) reminder tick. Sends an SMS reminder if not already sent (idempotent via `reminded` guard).

### `retrySms({ to, text })`

Re-sends an SMS that was previously undeliverable. Invoked once per failed delivery-update.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Telnyx API key (used by the platform-injected `TELNYX` binding for SMS and inference). |
| `FRONT_DESK_NUMBER` | Yes | The clinic's Telnyx phone number (E.164 format) used as the `from` in outbound SMS. |
| `DEMO_MODE` | No | When `true` (default), outbound SMS are logged instead of sent. Set to `false` for live mode. |

---

## Notes

- **Signature verification**: The Edge Function entry point does not perform Ed25519 signature verification on incoming webhooks. In production, verify the `Telnyx-Signature` header using `client.webhooks.unwrap` before forwarding to the actor.
- **Thread isolation**: Each customer's E.164 phone number maps to exactly one `FrontDesk` actor via `idFromName(threadId)`, ensuring conversation + booking + reminder state is durable and isolated per customer.
- **Idempotency**: Reminder tasks use a `reminded: { d1, h1 }` guard in actor state to ensure each fires exactly once, even across restarts.
- **Restart safety**: Scheduled tasks (`remind:<thread>:d1`, `remind:<thread>:h1`) are persisted by the Agent SDK and re-arm automatically after a worker restart.
