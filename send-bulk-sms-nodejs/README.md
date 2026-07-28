---
name: send-bulk-sms
title: "Send Bulk SMS"
description: "Send bulk SMS messages to many recipients with rate limiting and per-message error tracking using the Telnyx Messaging API and Express."
language: nodejs
framework: express
telnyx_products: [Messaging]
channel: [sms]
---

# Send Bulk SMS

Send bulk SMS messages to many recipients with rate limiting and per-message error tracking using the Telnyx Messaging API and Express.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.
- **Pay-as-you-go** - no minimums, contracts, or per-seat fees.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  POST /sms/send-bulk
        │
        ▼
  ┌──────────────────┐
  │ Express server    │
  │ sendBulkSMS()     │──► loop over recipients
  └────────┬─────────┘     (delay between each)
           │
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │  POST /v2/messages (one per recipient)
  └────────┬─────────┘
           │
           └──► { summary, successful[], failed[] }
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000`) | - |
| `RATE_LIMIT_DELAY_MS` | `number` | `100` | no | Delay in milliseconds between each send (defaults to `100`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:3000 (or PORT)
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

### `POST /sms/send-bulk`

Send SMS to multiple recipients. Each recipient is sent individually with a delay between calls, and the response reports per-message success and failure.

```bash
curl -X POST http://localhost:3000/sms/send-bulk \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      { "to": "+12125551234", "message": "Hello from Telnyx!" },
      { "to": "+13105556789", "message": "Second message" }
    ]
  }'
```

**Response:**

```json
{
  "summary": {
    "total": 2,
    "successful": 1,
    "failed": 1
  },
  "successful": [
    {
      "message_id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "status": "queued",
      "from": "+15551234567",
      "to": "+12125551234"
    }
  ],
  "failed": [
    {
      "to": "13105556789",
      "error": "Phone number must be in E.164 format (e.g., +15551234567)",
      "index": 1
    }
  ]
}
```

### `POST /sms/send-single`

Send a single SMS message. Useful for testing credentials before running a bulk batch.

```bash
curl -X POST http://localhost:3000/sms/send-single \
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

### `GET /health`

Health check.

```bash
curl http://localhost:3000/health
```

**Response:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace. | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys), update `.env`, and restart the server. |
| `400 Phone number must be in E.164 format` | A `to` value does not start with `+`. | Use E.164: `+` then country code and number, no spaces or dashes (e.g. `+15551234567`). |
| `429 {"error": "Rate limit exceeded. Please slow down."}` | Messages are being sent faster than Telnyx allows. | Increase `RATE_LIMIT_DELAY_MS` in `.env` (try `200`–`500`) and restart. |
| `TELNYX_PHONE_NUMBER environment variable not set` | `.env` missing or not loaded before `process.env` is read. | Confirm `.env` exists in this folder and is named exactly `.env`; restart `node server.js`. |
| Some recipients fail while others succeed | One or more entries had an invalid number or were rejected by Telnyx. | Inspect the `failed` array - each entry has the `to`, `index`, and `error`. Re-submit just those recipients. |

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

- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Send a single SMS with Node.js
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Receive inbound SMS via webhook
- [sms-two-factor-auth-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-nodejs/README.md) - SMS-based 2FA / OTP
- [send-bulk-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md) - The same bulk-send example in Python

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
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
