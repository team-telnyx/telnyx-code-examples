---
name: route-phone-calls-to-ai-agent
title: "Route Phone Calls to AI Agent"
description: "Receive inbound call webhooks from the Telnyx Voice API and answer calls programmatically with an Express server using Call Control."
language: nodejs
framework: express
telnyx_products: [Voice]
channel: [voice]
---

# Route Phone Calls to AI Agent

Receive inbound call webhooks from the Telnyx Voice API and answer calls programmatically with an Express server using Call Control.

## Telnyx API Endpoints Used

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/answer-call)

## Architecture

```
  Inbound PSTN call
        │
        ▼
  ┌──────────────────────┐
  │  Telnyx Voice API     │
  │  (Call Control App)   │
  └──────────┬───────────┘
             │  call.initiated webhook
             ▼
  ┌──────────────────────┐
  │  Express server       │
  │  POST /webhooks/      │
  │       inbound-call    │
  └──────────┬───────────┘
             │  answer(call_control_id)
             ▼
  ┌──────────────────────┐
  │  Telnyx Voice API     │  ──► call answered
  └──────────────────────┘
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that puts voice, messaging, SIP, AI, and IoT on one private, global network - so inbound calls reach your Call Control webhook with low latency and you answer them programmatically through a single API instead of stitching together multiple vendors.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API v2 key used to authenticate Call Control actions | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-nodejs
cp .env.example .env    # ← fill in your TELNYX_API_KEY
npm install
node server.js          # starts on http://localhost:5000 (or $PORT)
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

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/inbound-call`
   - Assign your Telnyx phone number to that Call Control Application.

## API Reference

### `POST /webhooks/inbound-call`

Receives inbound call webhooks from Telnyx. On a `call.initiated` event it answers the call via Call Control; for any other event type it acknowledges the event without taking action.

```bash
curl -X POST http://localhost:5000/webhooks/inbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "call_control_id": "v3:abc123",
      "from": "+12125551234",
      "to": "+13105557890"
    }
  }'
```

**Response (call answered):**

```json
{
  "call_control_id": "v3:abc123",
  "status": "answered",
  "from": "+12125551234",
  "to": "+13105557890"
}
```

For any other `event_type` (e.g. `call.answered`, `call.hangup`) the event is acknowledged:

```json
{
  "call_control_id": "v3:abc123",
  "status": "acknowledged",
  "event_type": "call.hangup"
}
```

### `GET /health`

Health check endpoint for monitoring.

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
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, malformed, or revoked. | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env`, remove any quotes/spaces, and restart the server. |
| `400 {"error": "Invalid webhook payload"}` | The request body has no `data` object. | Ensure the webhook is sent by Telnyx (or that test payloads include a top-level `data` object). |
| `400 {"error": "Missing call_control_id in webhook event"}` | The `data` object has no `call_control_id`. | Confirm the Call Control Application is linked to your number so Telnyx includes `call_control_id` in the payload. |
| Webhook never fires | Call Control Application webhook URL is wrong or not public. | Point the Call Control Application webhook URL at `https://<id>.ngrok.io/webhooks/inbound-call` over HTTPS and verify the ngrok tunnel is active. |
| `429 {"error": "Rate limit exceeded..."}` | Too many Call Control actions in a short window. | Back off and retry; reduce concurrent answer requests. |
| `503 {"error": "Network error connecting to Telnyx"}` | The server could not reach the Telnyx API. | Check outbound network connectivity and Telnyx status, then retry. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [build-voice-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) - Connect answered calls to a Telnyx AI voice agent
- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) - Place outbound calls with Call Control
- [record-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-nodejs/README.md) - Record calls via Call Control actions
- [build-ivr-phone-menu-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-nodejs/README.md) - Build an IVR menu on inbound calls

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Voice API / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Answer Call API reference](https://developers.telnyx.com/api-reference/call-commands/answer-call)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice AI Agents](https://telnyx.com/products/voice-ai-agents)
- [Voice pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
