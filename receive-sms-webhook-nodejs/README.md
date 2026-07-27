---
name: receive-sms-webhook
title: "Receive SMS Webhook"
description: "Receive inbound SMS messages via Telnyx webhooks with an Express server. Validates payloads and acknowledges within 5 seconds."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# Receive SMS Webhook

Receive inbound SMS messages via Telnyx webhooks with an Express server. Validates payloads and acknowledges within 5 seconds.

## Telnyx API Endpoints Used

This example does not call the Telnyx REST API - it receives webhook events that Telnyx sends to your server when an SMS arrives.

- **Inbound Message webhook**: `POST /webhooks/sms` (your endpoint, called by Telnyx) -- [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-message)

## Architecture

```
  Inbound SMS
        │
        ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │ POST webhook
           ▼
  ┌──────────────────┐
  │ Express server    │
  │ /webhooks/sms     │
  └────────┬─────────┘
           │
           └──► validate → store → 200 OK
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Inbound SMS is delivered over the Telnyx-owned network with a webhook event model built for low-latency, reliable delivery.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to initialize the SDK client | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Assign your inbound-enabled phone number to that Messaging Profile.

## API Reference

### `POST /webhooks/sms`

Receives inbound SMS webhook events from Telnyx. Validates the payload, extracts the message, stores it in memory, and returns `200 OK` so Telnyx stops retrying. This is normally called by Telnyx, but you can simulate it:

```bash
curl -X POST http://localhost:5000/webhooks/sms \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "id": "msg-f5d7a7e0-1234-5678",
        "from": { "phone_number": "+12125551234" },
        "to": [{ "phone_number": "+13125559876" }],
        "text": "Hello from a real phone",
        "received_at": "2026-06-18T12:00:00Z",
        "direction": "inbound"
      }
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "received"
}
```

### `GET /messages`

Debug endpoint that returns every message received since the server started (in-memory; remove in production).

```bash
curl http://localhost:5000/messages
```

**Response:**

```json
{
  "count": 1,
  "messages": [
    {
      "message_id": "msg-f5d7a7e0-1234-5678",
      "from": "+12125551234",
      "to": "+13125559876",
      "text": "Hello from a real phone",
      "received_at": "2026-06-18T12:00:00Z",
      "direction": "inbound"
    }
  ]
}
```

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-06-18T12:00:00.000Z"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection refused on port 5000 | Server isn't running, or another process holds the port. | Run `node server.js` and confirm no other process uses the port. Note the code defaults to `3000` if `PORT` is unset. |
| `400 {"error":"Invalid webhook payload"}` | Request body is missing `data`. | Send a JSON body with a `data` object. Ensure `body-parser` runs before the route and `Content-Type: application/json` is set. |
| `400 {"error":"Invalid webhook payload structure"}` | Body has `data` but no `data.payload`. | Confirm the Messaging Profile is sending the `message.received` event and the payload nests message fields under `data.payload`. |
| `400 {"error":"Missing sender or recipient phone number in webhook"}` | `from.phone_number` or `to[0].phone_number` is absent. | Inspect the payload - `from` is at `data.payload.from.phone_number`, `to` at `data.payload.to[0].phone_number`. Update accessors if your API version differs. |
| No webhook requests arrive | Webhook URL not reachable or not assigned. | Verify the HTTPS URL (use ngrok locally), confirm it ends in `/webhooks/sms`, and assign your number to the Messaging Profile. Check Portal webhook delivery logs. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Same webhook receiver in Python
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Send an SMS with Node.js
- [send-bulk-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-nodejs/README.md) - Send bulk SMS with Node.js
- [sms-two-factor-auth-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-nodejs/README.md) - SMS-based 2FA with Node.js

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive a Message Guide](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
