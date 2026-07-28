---
name: alphanumeric-sender-id-sms
title: "Alphanumeric Sender ID SMS"
description: "Send SMS messages with a branded alphanumeric sender ID using the Telnyx Messaging API. Validates sender IDs and enforces regional restrictions."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# Alphanumeric Sender ID SMS

Send SMS messages with a branded alphanumeric sender ID (e.g. `ACME Corp`) instead of a phone number, using the Telnyx Messaging API.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

## Architecture

```
  API Request (to, message, sender_id)
        │
        ▼
  ┌───────────────────────────┐
  │ Flask app                  │
  │  • validate sender ID      │
  │  • validate recipient      │
  │  • block +1 (US/CA)        │
  └────────────┬──────────────┘
               │ from_ = "ACME Corp"
               ▼
  ┌───────────────────────────┐
  │ Telnyx Messaging          │
  │ (Messaging Profile)        │
  └────────────┬──────────────┘
               │
               └──► SMS delivered with branded sender ID
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Global reach** - alphanumeric sender IDs are supported across many non-US/Canada regions for branded messaging.
- **Deliverability built in** - number reputation, sender registration, and deliverability monitoring included.
- **Developer-first** - typed SDKs, a comprehensive webhook event model, and a sandbox for testing.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_MESSAGING_PROFILE_ID` | `string` | `40000000-0000-0000-0000-000000000000` | **yes** | Messaging Profile UUID configured for alphanumeric sending | [Portal → Messaging → Profiles](https://portal.telnyx.com/messaging/profiles) |
| `ALPHANUMERIC_SENDER_ID` | `string` | `ACME Corp` | no | Default sender ID (1–11 alphanumeric chars); used when the request omits `sender_id` | - |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug flag | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx messaging-profiles create --name my-profile
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/alphanumeric-sender-id-sms-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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

### `POST /sms/send-alphanumeric`

Send an SMS using an alphanumeric sender ID. If `sender_id` is omitted, the `ALPHANUMERIC_SENDER_ID` environment variable is used.

```bash
curl -X POST http://localhost:5000/sms/send-alphanumeric \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+447700900123",
    "message": "Your ACME order has shipped.",
    "sender_id": "ACME Corp"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40000000-0000-0000-0000-000000000000",
  "status": "queued",
  "from": "ACME Corp",
  "to": "+447700900123",
  "direction": "outbound"
}
```

### `POST /sms/validate-sender-id`

Validate an alphanumeric sender ID format before sending. Does not call the Telnyx API.

```bash
curl -X POST http://localhost:5000/sms/validate-sender-id \
  -H "Content-Type: application/json" \
  -d '{"sender_id": "ACME Corp"}'
```

**Response `200`:**

```json
{
  "sender_id": "ACME Corp",
  "is_valid": true,
  "message": "Valid alphanumeric sender ID"
}
```

## Troubleshooting

- **400 Invalid sender ID**: The sender ID must be 1–11 characters and contain only letters, numbers, and spaces. Remove hyphens, underscores, and punctuation. Validate first with `POST /sms/validate-sender-id`.
- **400 Alphanumeric not supported for US/Canada**: Alphanumeric sender IDs are not allowed for `+1` recipients. Use a phone number as the sender for US/Canada, or send to a supported region (e.g. UK `+447700900123`).
- **400 Invalid recipient number**: Recipients must be in E.164 format - start with `+`, country code, then the number with no spaces or dashes.
- **401 Invalid API key**: Confirm `TELNYX_API_KEY` matches the key in the [Telnyx Portal](https://portal.telnyx.com/api-keys); check for trailing spaces or quotes.
- **API request failed (404)**: Verify `TELNYX_MESSAGING_PROFILE_ID` matches a valid, active Messaging Profile UUID configured for alphanumeric sending.
- **429 Rate limit exceeded**: Slow down request volume; retry with backoff.

## Related Examples

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - send a single SMS from a phone number
- [send-bulk-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md) - send messages to many recipients
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - receive inbound SMS via webhooks

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

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS - Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
