---
name: sms-delivery-receipts
title: "SMS Delivery Receipts"
description: "Track SMS delivery status with Telnyx webhooks. Send messages, receive finalized delivery receipts, and look up per-message status."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Delivery Receipts

Send SMS through Telnyx and track each message's final delivery status using signed `message.finalized` webhooks.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Delivery Receipt Webhook**: `message.finalized` event delivered to your webhook URL -- [webhook reference](https://developers.telnyx.com/api-reference/webhooks/message-finalized)

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌──────────────────┐        POST /v2/messages
  │  Express server   │ ───────────────────────────► Telnyx Messaging
  └────────┬─────────┘
           │  track message_id (in-memory)
           │
           │   message.finalized (signed webhook)
           ▼
  ┌──────────────────┐
  │ POST /webhooks/sms│  verify signature → update receipt status
  └────────┬─────────┘
           │
           ▼
   GET /receipts/:id   GET /receipts
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Real delivery feedback** - finalized webhooks tell you whether each message was actually delivered or failed, with carrier-level error reasons.
- **Signed webhooks** - every inbound event is Ed25519-signed so you can reject spoofed requests.
- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-nodejs/API.md) for the typed endpoint reference and [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-nodejs/GUIDE.md) for a step-by-step tutorial.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/app/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o4i...=` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Account → Public Key](https://portal.telnyx.com/app/account/public-key) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number (E.164) used as the SMS sender | [Portal → My Numbers](https://portal.telnyx.com/app/numbers/my-numbers) |
| `PORT` | `number` | `3000` | no | Port the Express server listens on | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:3000
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
   ngrok http 3000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging → Messaging Profiles** → your profile → **Outbound** → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

   Delivery receipts (`message.finalized`) are sent to the messaging profile's webhook URL.

## API Reference

### `POST /sms/send`

Send an SMS and begin tracking its delivery receipt.

```bash
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /webhooks/sms`

Receives Telnyx delivery-receipt webhooks. The raw body and `telnyx-signature-ed25519` / `telnyx-timestamp` headers are verified against `TELNYX_PUBLIC_KEY` on every request; unsigned or invalid requests get `401`. Telnyx calls this endpoint - you do not call it directly.

```json
{
  "data": {
    "event_type": "message.finalized",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "to": [{ "phone_number": "+12125551234", "status": "delivered" }]
    }
  }
}
```

**Response `200`:**

```json
{ "success": true }
```

### `GET /receipts/:messageId`

Look up the tracked status of a single message.

```bash
curl http://localhost:3000/receipts/40385f64-5717-4562-b3fc-2c963f66afa6
```

**Response `200`:**

```json
{
  "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "from": "+15551234567",
  "to": "+12125551234",
  "status": "delivered",
  "sentAt": "2026-06-18T12:00:00.000Z",
  "deliveredAt": "2026-06-18T12:00:08.000Z",
  "failureReason": null
}
```

### `GET /receipts`

List all tracked delivery receipts.

```bash
curl http://localhost:3000/receipts
```

**Response `200`:** an array of receipt objects.

## Troubleshooting

- **`401 invalid signature` on `/webhooks/sms`**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the key from [Portal → Account → Public Key](https://portal.telnyx.com/app/account/public-key). The key must match the account that owns the messaging profile sending the webhooks.
- **401 Unauthorized on `/sms/send`**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/app/api-keys](https://portal.telnyx.com/app/api-keys).
- **Status stuck at `queued`**: Delivery status is asynchronous and can take 10–30 seconds. Confirm the messaging profile's webhook URL points at your `/webhooks/sms` endpoint and the server is reachable.
- **`Message not found` from `GET /receipts/:messageId`**: The in-memory store is cleared on restart. Use a database for production, and confirm the ID matches the `message_id` returned by `/sms/send`.
- **Invalid phone number format**: Numbers must be E.164 (`+15551234567`). Check both the request `to` and `TELNYX_PHONE_NUMBER`.

## Related Examples

- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - send a single SMS.
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - receive inbound SMS via webhooks.
- [send-bulk-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-nodejs/README.md) - send SMS to many recipients.

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
