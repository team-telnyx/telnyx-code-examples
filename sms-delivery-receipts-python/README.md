---
name: sms-delivery-receipts
title: "SMS Delivery Receipts"
description: "Track SMS delivery status with Telnyx message.finalized webhooks, store delivery receipts in SQLite, and query message status over HTTP."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Delivery Receipts

Track SMS delivery status with Telnyx `message.finalized` webhooks, store delivery receipts in SQLite, and query message status over HTTP.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Delivery receipts built in** — every outbound message emits `message.sent` and `message.finalized` events with carrier-level status and error codes.
- **Signed webhooks** — inbound events are signed with Ed25519 so you can verify they came from Telnyx before trusting them.
- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Delivery webhooks**: `message.finalized` events delivered to your Messaging Profile webhook URL -- [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌──────────────────┐     POST /v2/messages
  │  Flask app.py    │ ─────────────────────────►  Telnyx Messaging
  └────────┬─────────┘                                     │
           │ INSERT (status=queued)                        │
           ▼                                               │
   ┌────────────────┐                                      │
   │  SQLite         │ ◄──── UPDATE status / INSERT receipt │
   │  receipts.db    │                                      │
   └────────────────┘                                      │
           ▲                                               │
           │  message.finalized (signed webhook)           │
  POST /webhooks/message  ◄────────────────────────────────┘
```

The server holds no in-flight state: outbound sends are written to SQLite immediately, and the asynchronous `message.finalized` webhook updates the row and records a delivery receipt. Receipt writes are idempotent on `message_id`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key for sending messages | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | Ed25519 public key used to verify inbound webhook signatures | [Portal → API Keys → Public Key](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number (E.164) used as the sender | [Portal → My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode (`true`/`false`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # creates receipts.db and starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging → Messaging Profiles** → your profile → **Webhook URL** → `https://<id>.ngrok.io/webhooks/message`

The same profile's API key and public key must match the `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` in your `.env`, otherwise signature verification will reject the webhook with `401`.

## API Reference

### `POST /sms/send`

Send an SMS and begin tracking its delivery.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /webhooks/message`

Receives Telnyx `message.finalized` events. The Ed25519 signature is verified before the body is parsed; an invalid or missing signature returns `401`. Other event types are acknowledged with `{"status": "ignored"}`.

```bash
# Telnyx sends this automatically; shown here for shape only.
curl -X POST http://localhost:5000/webhooks/message \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <unix-ts>" \
  -d '{
    "data": {
      "event_type": "message.finalized",
      "payload": {
        "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
        "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
      }
    }
  }'
```

**Response `200`:**

```json
{ "status": "processed" }
```

### `GET /messages/<message_id>`

Fetch a single message and its delivery receipt (if one has arrived).

```bash
curl http://localhost:5000/messages/40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44
```

**Response `200`:**

```json
{
  "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
  "from": "+15551234567",
  "to": "+12125551234",
  "text": "Hello from Telnyx!",
  "status": "delivered",
  "direction": "outbound",
  "created_at": "2026-06-18 22:40:00",
  "updated_at": "2026-06-18 22:40:03",
  "delivery_receipt": {
    "status": "delivered",
    "error_code": null,
    "error_message": null,
    "received_at": "2026-06-18 22:40:03"
  }
}
```

### `GET /messages`

List tracked messages, newest first. Optional `?status=` filter (e.g. `queued`, `delivered`, `failed`).

```bash
curl "http://localhost:5000/messages?status=delivered"
```

**Response `200`:**

```json
[
  {
    "id": "40017c1a-6a3b-4c8e-9b1d-0f9e3a1c2b44",
    "from": "+15551234567",
    "to": "+12125551234",
    "status": "delivered",
    "direction": "outbound",
    "created_at": "2026-06-18 22:40:00"
  }
]
```

## Troubleshooting

- **`401 invalid signature` on the webhook**: The request did not carry a valid Telnyx Ed25519 signature. Confirm `TELNYX_PUBLIC_KEY` is set and belongs to the same profile/account as `TELNYX_API_KEY`, and that the webhook URL in the Portal points at this app.
- **Message status stuck on `queued`**: The `message.finalized` webhook never reached the app. Verify the Messaging Profile's webhook URL is your public ngrok HTTPS URL ending in `/webhooks/message`, and check the Portal's webhook delivery logs.
- **`401 Invalid API key` on `/sms/send`**: `TELNYX_API_KEY` is wrong or has a trailing space/quote. Regenerate it at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and restart the app.
- **`database is locked`**: SQLite has limited concurrent-write support. For production, move to PostgreSQL or MySQL.
- **No such table: messages**: The database is created on startup by `init_db()`. Make sure you launched the app with `python app.py` (which calls it) and that the process has write access to the folder.

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single SMS with delivery status webhooks.
- [ai-compliance-quiz-phone-python](../ai-compliance-quiz-phone-python/) — another example using signed Telnyx webhooks.

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Receiving Webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)
- [Send a Message — API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
