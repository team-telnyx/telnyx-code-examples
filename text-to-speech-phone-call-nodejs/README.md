---
name: text-to-speech-phone-call
title: "Text-to-Speech Phone Call"
description: "Initiate an outbound voice call and play a text-to-speech message on answer using the Telnyx Call Control API."
language: nodejs
framework: express
telnyx_products: [Voice]
channel: [voice]
---

# Text-to-Speech Phone Call

Initiate an outbound voice call and play a text-to-speech (TTS) message on answer using the Telnyx Call Control API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Voice calls traverse the Telnyx-owned IP backbone for lower latency and higher reliability, with Call Control commands like TTS playback exposed through a single REST API and webhook event model.

## Telnyx API Endpoints Used

- **Dial (initiate call)**: `POST /v2/calls` - via `client.calls.dial()` - [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Speak text (TTS)**: `POST /v2/calls/{call_control_id}/actions/speak` - via `client.calls.actions.speak()` - [API reference](https://developers.telnyx.com/api-reference/call-commands/speak-text)

## Architecture

```
  API Request (POST /calls/initiate)
        │
        ▼
  ┌──────────────────────┐
  │ Express server.js     │
  │  client.calls.dial()  │──────► Telnyx Voice (outbound call)
  └──────────┬───────────┘
             │
  Telnyx ────┘  webhook: call.answered
   POST /webhooks/call
             │
             ▼
  client.calls.actions.speak() ──► TTS audio played on the call
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number used as caller ID (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `your_connection_id_here` | **yes** | Call Control App connection ID | [Call Control Apps](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `string` | `5000` | no | Port the server listens on (defaults to `3000`) | - |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhook` | no | Public webhook URL logged on startup | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000 (PORT) or :3000 by default
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

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/call`

When a `call.answered` event arrives at `/webhooks/call`, the server automatically plays a TTS greeting on the call.

## API Reference

### `POST /calls/initiate`

Initiates an outbound call from your Telnyx number and returns the `call_control_id`.

```bash
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response:**

```json
{
  "call_control_id": "v2:abc123...",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /calls/:callControlId/speak`

Plays a text-to-speech message on an active call. Pass the `call_control_id` in the path.

```bash
curl -X POST http://localhost:5000/calls/v2:abc123.../speak \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Your appointment is confirmed.",
    "language": "en-US"
  }'
```

**Response:**

```json
{
  "call_control_id": "v2:abc123...",
  "status": "ok"
}
```

### `POST /webhooks/call`

Receives Call Control events from Telnyx. On `call.answered` it auto-plays a TTS greeting; on `call.hangup` it logs the end of the call. Always returns `200` to acknowledge receipt.

```bash
curl -X POST http://localhost:5000/webhooks/call \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.answered",
      "call_control_id": "v2:abc123..."
    }
  }'
```

**Response:**

```json
{
  "status": "received"
}
```

### `GET /health`

Health check for monitoring.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Invalid API key` (401) | `TELNYX_API_KEY` is wrong or revoked | Generate a new key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and update `.env`, then restart the server. |
| `TELNYX_CONNECTION_ID environment variable not set` | No connection ID configured | Add `TELNYX_CONNECTION_ID` to `.env` from your [Call Control Application](https://portal.telnyx.com/call-control/applications). |
| `Phone number must be in E.164 format` (400) | `to` or `from` number not in E.164 | Use the `+<countrycode><number>` format, e.g. `+15551234567`. |
| Webhook never fires | Call Control App webhook URL not set or not public | Point the app's Webhook URL to `https://<id>.ngrok.io/webhooks/call`. |
| Call connects but no audio | TTS not played / call not active | Confirm the `call_control_id` is current and the `message` is non-empty; check server logs for Telnyx API errors. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> telnyx call-control-applications list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [text-to-speech-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-python/README.md) - same example in Python
- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) - initiate outbound calls
- [record-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-nodejs/README.md) - record call audio
- [build-ivr-phone-menu-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-nodejs/README.md) - interactive voice menus

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Speak Text API reference](https://developers.telnyx.com/api-reference/call-commands/speak-text)
- [Dial API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice product](https://telnyx.com/products/voice-ai-agents)
- [Telnyx pricing](https://telnyx.com/pricing/call-control)
