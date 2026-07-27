---
name: send-sms-java
title: "Send SMS (Java)"
description: "Send an SMS message using the Telnyx Messaging API and Java SDK, exposed over a JDK HttpServer endpoint."
language: java
framework: jdk-httpserver
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS (Java)

Send an SMS message using the Telnyx Messaging API and Java SDK, exposed over a built-in JDK `HttpServer` endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Number reputation, 10DLC registration, and deliverability monitoring are built in, so a single Java SDK call reaches carriers worldwide without stitching together multiple vendors.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` (via `client.messages().send(params)`) -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Architecture

```
  POST /sms/send  (JDK HttpServer)
        │
        ▼
  ┌─────────────────────────┐
  │ SendSmsHandler          │
  │ - parse JSON body       │
  │ - validate E.164        │
  │ - read from-number      │
  └────────────┬────────────┘
               │  client.messages().send(params)
               ▼
  ┌─────────────────────────┐
  │ Telnyx Messaging API    │
  └────────────┬────────────┘
               │
               └──► SMS delivered to recipient
```

## Environment Variables

The JDK `HttpServer` reads configuration from process environment variables. Copy
`.env.example` to `.env`, fill it in, then export it into your shell (see [Setup](#setup)).

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API v2 key, read by `TelnyxOkHttpClient.fromEnv()` | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `PORT` | `integer` | `5000` | no | Port the local server binds to (defaults to `5000`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-java
cp .env.example .env          # ← fill in your credentials

# Load .env into the current shell (HttpServer reads process env, not a file)
set -a && . ./.env && set +a

mvn -q compile                # download deps and compile
mvn -q exec:java              # starts on http://localhost:5000
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


Requires JDK 17+ and Maven 3.6+.

## API Reference

### `POST /sms/send`

Send a single SMS. Requires a JSON body with `to` and `message`.

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
  "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

**Response `400`** (missing fields or non-E.164 number):

```json
{
  "error": "Missing required fields: 'to' and 'message'"
}
```

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-java/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection refused on port 5000 | App isn't running. | Run `mvn -q exec:java` and confirm no other process is bound to port 5000 (or set `PORT`). |
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing or invalid. | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and re-export `.env` (no quotes or trailing spaces). |
| `400 Phone number must be in E.164 format` | The `to` value does not start with `+`. | Use E.164: `+` + country code + number, e.g. `+15551234567`. |
| `IllegalStateException: TELNYX_PHONE_NUMBER environment variable not set` | `.env` not loaded into the shell or variable missing. | Run `set -a && . ./.env && set +a` before `mvn exec:java`; confirm `TELNYX_PHONE_NUMBER` is defined. |
| `429 Rate limit exceeded` | Too many requests in a short window. | Slow down the request rate or batch sends; see the [bulk SMS example](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md). |

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

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Same example in Python (Flask)
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Same example in Node.js (Express)
- [send-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-go/README.md) - Same example in Go (Gin)
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Same example in Ruby
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Receive inbound SMS via webhooks

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Java SDK](https://developers.telnyx.com/development/sdk/java)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
