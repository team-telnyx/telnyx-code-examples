---
name: receive-sms-webhook
title: "Receive SMS Webhook"
description: "Receive inbound SMS via webhook with Ed25519 signature verification using C# and ASP.NET."
language: csharp
framework: aspnet
telnyx_products: [SMS/MMS]
channel: [sms]
---

# Receive SMS Webhook with C# and ASP.NET

Receive inbound SMS messages via Telnyx webhooks with a minimal ASP.NET (net8.0) server that verifies the Telnyx Ed25519 signature before trusting any payload.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. Inbound SMS is delivered over the Telnyx-owned network with a webhook event model built for low-latency, reliable delivery.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** — every event is signed with Ed25519 so your endpoint can cryptographically prove it came from Telnyx.
- **Developer-first** — official SDKs (including the `Telnyx.net` .NET SDK), a comprehensive webhook event model, and a portal for testing.

## Telnyx API Endpoints Used

This example does not call the Telnyx REST API — it receives webhook events that Telnyx sends to your server when an SMS arrives.

- **Inbound Message webhook**: `POST /webhooks/sms` (your endpoint, called by Telnyx) — [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-message)

## Architecture

```
  Inbound SMS
        │
        ▼
  ┌──────────────────┐
  │  Telnyx Messaging │
  └────────┬─────────┘
           │ POST webhook (signed Ed25519)
           ▼
  ┌──────────────────────────┐
  │  ASP.NET minimal API      │
  │  POST /webhooks/sms        │
  └────────┬─────────────────┘
           │
           ├─► read RAW body
           ├─► verify Ed25519 over "<timestamp>|<raw body>"
           ├─► read data.payload
           └─► store → 200 OK
```

Signature verification uses the official SDK helper `Telnyx.net.Infrastructure.Public.Webhook.ConstructEvent`, which Ed25519-verifies the signature and enforces a timestamp tolerance.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to configure the SDK | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o4i...base64...=` | **yes** | Base64 account public key used to verify the Ed25519 webhook signature | [Portal → Account → Public Key](https://portal.telnyx.com) |
| `ASPNETCORE_URLS` | `string` | `http://localhost:5000` | no | Bind address/port for the server (ASP.NET default is `http://localhost:5000`) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-csharp
cp .env.example .env       # ← fill in your credentials
dotnet restore
dotnet run                 # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Assign your inbound-enabled phone number to that Messaging Profile.

4. Confirm the public key under **Account → Public Key** matches `TELNYX_PUBLIC_KEY` in your `.env`.

## API Reference

Full typed reference in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-csharp/API.md).

### `POST /webhooks/sms`

Receives inbound SMS webhook events from Telnyx. Verifies the Ed25519 signature over `"<telnyx-timestamp>|<raw body>"`, reads the message from `data.payload`, stores it, and returns `200 OK` so Telnyx stops retrying. Requests with a missing or invalid signature get `401`.

Telnyx normally calls this endpoint. To verify routing locally you can send an unsigned request; without valid `telnyx-signature-ed25519` and `telnyx-timestamp` headers it returns `401` by design.

**Response (verified `message.received`):**

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

### `GET /health`

Liveness check.

```bash
curl http://localhost:5000/health
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` on every webhook | `TELNYX_PUBLIC_KEY` is wrong, or the body was altered before verification. | Copy the public key from Portal → Account → Public Key into `.env`. The signed message is `"<telnyx-timestamp>|<raw body>"`, so do not put a JSON/body parser ahead of the route — this example reads the raw stream directly. |
| `503 Service Unavailable` on webhook | `TELNYX_PUBLIC_KEY` is not set. | Set `TELNYX_PUBLIC_KEY` in `.env`; the server fails closed rather than trusting unverifiable requests. |
| `400 {"error":"Invalid webhook payload structure"}` | Body passed verification but has no `data.payload`. | Confirm the Messaging Profile sends `message.received`; message fields are nested under `data.payload`. |
| `400 {"error":"Missing sender or recipient phone number"}` | `from.phone_number` or `to[0].phone_number` is absent. | Inspect the payload — `from` is at `data.payload.from.phone_number`, `to` at `data.payload.to[0].phone_number`. |
| No webhook requests arrive | Webhook URL not reachable or not assigned. | Verify the HTTPS URL (use ngrok locally), confirm it ends in `/webhooks/sms`, and assign your number to the Messaging Profile. Check Portal webhook delivery logs. |
| `dotnet` command not found | .NET SDK not installed. | Install the [.NET 8 SDK](https://dotnet.microsoft.com/download). |

## Related Examples

- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) — Same webhook receiver in Node.js
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) — Same webhook receiver in Python
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) — Send an SMS with Node.js
- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) — Send an SMS with Python

## Resources

- [Receive a Message guide](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Webhook signing overview](https://developers.telnyx.com/docs/messaging/webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [.NET SDK](https://developers.telnyx.com/development/sdk/dotnet)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
