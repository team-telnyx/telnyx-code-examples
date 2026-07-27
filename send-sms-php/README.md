---
name: send-sms
title: "Send SMS"
description: "Send an SMS message using the Telnyx Messaging API and the Telnyx PHP SDK, exposed through a vanilla PHP front controller."
language: php
framework: vanilla
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS

Send an SMS message using the Telnyx Messaging API and the Telnyx PHP SDK, exposed through a vanilla PHP front controller.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.
- **One SDK** - the same `telnyx/telnyx-php` client covers messaging, voice, SIP, and AI.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` - [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌──────────────────────┐
  │  index.php            │
  │  (Telnyx\Client)      │
  └──────────┬───────────┘
             │  $client->messages->send(to:, from:, text:)
             ▼
  ┌──────────────────────┐
  │  Telnyx Messaging     │
  └──────────┬───────────┘
             │
             └──► SMS delivered
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx sending number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `o7gT...base64...` | no | Base64 Ed25519 public key for verifying inbound webhooks | [Portal](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-php
cp .env.example .env    # ← fill in your credentials
composer install
php -S localhost:8080 index.php   # starts the local PHP web server
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


`index.php` is a single front controller that routes `POST /sms/send` to the Telnyx Messaging API.

## API Reference

### `POST /sms/send`

Sends a single SMS through the Telnyx Messaging API.

```bash
curl -X POST http://localhost:8080/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response:**

```json
{
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-php/API.md) for the full typed request/response reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error":"Invalid API key"}` (401) | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart the server - env vars load at boot |
| `{"error":"Phone number must be in E.164 format (e.g., +15551234567)"}` (400) | The `to` value does not start with `+` | Send the number in E.164 form, e.g. `+12125551234` |
| `{"error":"Missing required fields: 'to' and 'message'"}` (400) | The request body omitted `to` or `message` | Include both fields in the JSON body |
| `{"error":"TELNYX_PHONE_NUMBER environment variable not set"}` (500) | `TELNYX_PHONE_NUMBER` is not exported | Set it in `.env` and restart the server |
| `{"error":"Rate limit exceeded. Please slow down."}` (429) | Too many requests in a short window | Back off and retry; batch sends with a queue |
| `Class "Telnyx\Client" not found` | Dependencies are not installed | Run `composer install` and restart the server |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Send SMS with Python / Flask
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Send SMS with Node.js
- [send-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-go/README.md) - Send SMS with Go
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Send SMS with Ruby
- [send-bulk-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md) - Send SMS to many recipients
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Handle inbound SMS webhooks

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
