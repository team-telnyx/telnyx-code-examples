---
name: receive-sms-webhook
title: "Receive SMS Webhook (Ruby)"
description: "Receive inbound SMS messages via Telnyx webhooks with a Sinatra server, verifying the Telnyx Ed25519 signature before trusting any payload."
language: ruby
framework: sinatra
telnyx_products: [Messaging]
channel: [sms]
---

# Receive SMS Webhook (Ruby)

Receive inbound SMS messages via Telnyx webhooks with a Sinatra server, verifying the Telnyx Ed25519 signature before trusting any payload.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Inbound SMS is delivered over the Telnyx-owned network with a webhook event model built for low-latency, reliable delivery.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.
- **Signed webhooks** - every event is signed with Ed25519 so you can cryptographically verify it came from Telnyx before acting on it.

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
           │ POST webhook (Ed25519-signed)
           ▼
  ┌─────────────────────────────┐
  │ Sinatra server              │
  │ POST /webhooks/sms          │
  │  1. read RAW body           │
  │  2. verify Ed25519 sig      │
  │  3. parse + read payload    │
  │  4. store → 200 OK          │
  └─────────────────────────────┘
```

The signature is verified over `"<telnyx-timestamp>|<raw-body>"` **before** the JSON
is parsed or trusted. Message fields are then read from `data.payload`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to initialize the SDK client | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o5j8...base64...=` | **yes** | Base64 Ed25519 public key used to verify webhook signatures | Portal → Account Settings → Keys & Credentials → Public Key |
| `PORT` | `number` | `5000` | no | Port the Sinatra server listens on (defaults to `5000`) | - |

## Setup

> Requires **Ruby 3.2+**. The Telnyx 5.x SDK is a Stainless rewrite and Ed25519 key
> parsing needs OpenSSL 3.x - it will not run on Ruby 2.x.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-ruby
cp .env.example .env    # ← fill in your credentials
bundle install
bundle exec ruby app.rb # starts on http://localhost:5000
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

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-ruby/API.md) for the full typed endpoint reference.

### `POST /webhooks/sms`

Receives inbound SMS webhook events from Telnyx. Verifies the Ed25519 signature over
the raw body, validates the payload, extracts the message, stores it in memory, and
returns `200 OK` so Telnyx stops retrying. Returns `401` if the signature is invalid.

Telnyx-signed requests carry these headers: `telnyx-signature-ed25519` (base64
signature) and `telnyx-timestamp` (unix seconds). A genuine request looks like:

```json
{
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
}
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

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error":"invalid signature"}` on every request | `TELNYX_PUBLIC_KEY` is missing/wrong, or you are testing with `curl` (which sends no Telnyx signature). | Set `TELNYX_PUBLIC_KEY` to the base64 Ed25519 public key from Portal → Keys & Credentials. Real Telnyx webhooks are signed; plain `curl` requests are correctly rejected. |
| `401 {"error":"invalid signature"}` for real Telnyx events | The raw body was altered before verification, or the timestamp drifted >5 min. | Do not put a body-parsing middleware in front of the route - Sinatra's `request.body.read` must see the unmodified bytes. Check the server clock (NTP). |
| `LoadError: cannot load such file -- standardwebhooks` | `require "telnyx"` loads `standardwebhooks`, but the SDK does not declare it as a dependency. | It is pinned in the `Gemfile` (`gem "standardwebhooks"`). Run `bundle install`. |
| `bundle install` fails / SDK errors on load | Running on Ruby < 3.2 (e.g. system Ruby 2.6). | Install Ruby 3.2+ (`rbenv install 3.2.x` or similar) and re-run `bundle install`. |
| No webhook requests arrive | Webhook URL not reachable or not assigned. | Verify the HTTPS URL (use ngrok locally), confirm it ends in `/webhooks/sms`, and assign your number to the Messaging Profile. Check Portal webhook delivery logs. |
| `400 {"error":"Invalid webhook payload"}` | Body is missing `data` or is not valid JSON. | Confirm the Messaging Profile sends the `message.received` event with fields nested under `data.payload`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Same webhook receiver in Node.js
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Same webhook receiver in Python
- [receive-sms-webhook-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-java/README.md) - Same webhook receiver in Java (Ed25519-verified)
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Send an SMS with Ruby

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive a Message Guide](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Webhook Signing Overview](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
