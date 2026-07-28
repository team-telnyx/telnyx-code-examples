---
name: send-sms-go
title: "Send SMS (Go)"
description: "Send an SMS message using the Telnyx Messaging API and Go SDK, exposed over a Gin HTTP endpoint."
language: go
framework: gin
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS (Go)

Send an SMS message using the Telnyx Messaging API and Go SDK, exposed over a Gin HTTP endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Number reputation, 10DLC registration, and deliverability monitoring are built in, so a single Go SDK call reaches carriers worldwide without stitching together multiple vendors.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` (via `client.Messages.Send`) -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  POST /sms/send  (Gin)
        │
        ▼
  ┌────────────────────┐
  │ SendSMS() helper    │
  │ - validate E.164    │
  │ - read from-number  │
  └─────────┬──────────┘
            │  Messages.Send
            ▼
  ┌────────────────────┐
  │ Telnyx Messaging    │
  └─────────┬──────────┘
            │
            └──► SMS delivered to recipient
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-go
cp .env.example .env    # ← fill in your credentials
go mod download
go run .                # starts on http://localhost:5000
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
  "message_id": "msg-f5d7a7e0-1234-5678",
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

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Connection refused on port 5000 | App isn't running. | Run `go run .` and confirm no other process is bound to port 5000. |
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing or invalid. | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env` (no quotes or trailing spaces). |
| `400 phone number must be in E.164 format` | The `to` value does not start with `+`. | Use E.164: `+` + country code + number, e.g. `+15551234567`. |
| `TELNYX_PHONE_NUMBER environment variable not set` | `.env` not loaded or variable missing. | Ensure `.env` sits next to `main.go`, is named exactly `.env`, and defines `TELNYX_PHONE_NUMBER`. |
| `429 Rate limit exceeded` | Too many requests in a short window. | Slow down request rate or batch sends; see [bulk SMS example](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md). |

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
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Same example in Node.js
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Same example in Ruby
- [send-bulk-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md) - Send SMS to many recipients
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Receive inbound SMS via webhooks

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
