---
name: record-phone-calls
title: "Record Phone Calls"
description: "Initiate outbound calls and control call recording using the Telnyx Voice API with Express. Handles call lifecycle webhooks and recording start/stop."
language: nodejs
framework: express
telnyx_products: [Voice]
channel: [voice]
---

# Record Phone Calls

Initiate outbound calls and control call recording using the Telnyx Voice API with Express. Handles call lifecycle webhooks and recording start/stop.

## Telnyx API Endpoints Used

- **Dial (initiate call)**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Start recording**: `POST /v2/calls/{call_control_id}/actions/record_start` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/recording-start)
- **Stop recording**: `POST /v2/calls/{call_control_id}/actions/record_stop` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/recording-stop)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────────┐
  │  Express (server.js)  │
  │  activeCalls Map      │
  └──────────┬───────────┘
             │  dial / record_start / record_stop
             ▼
  ┌──────────────────────┐
  │   Telnyx Voice API    │
  └──────────┬───────────┘
             │  call.answered / call.hangup
             │  call.recording.saved
             ▼
   POST /webhooks/call
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT delivered over one private, global network. Programmable call control and recording run on Telnyx-owned infrastructure for lower latency and higher reliability than the public internet.

- **Call Control** - initiate, answer, record, and tear down calls programmatically with a full webhook event model.
- **Recording built in** - start and stop recordings on a live call and receive a download URL when the file is saved.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number used as the caller ID (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `1234567890` | **yes** | Call Control Application (connection) ID | [Call Control Apps](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000`) | - |
| `WEBHOOK_URL` | `string` | `https://your-domain.com/webhook` | no | Public URL Telnyx posts call events to (logged on startup) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-nodejs
cp .env.example .env    # ← fill in your credentials
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

2. Copy the HTTPS URL and configure it on your [Call Control Application](https://portal.telnyx.com/call-control/applications):

   - **Webhook URL** → `https://<id>.ngrok.io/webhooks/call`

## API Reference

### `POST /calls/initiate`

Initiate an outbound call from your Telnyx number. The resulting `call_control_id` is tracked in memory and used by the recording endpoints.

```bash
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234"
  }'
```

**Response:**

```json
{
  "call_control_id": "v3:abc123...",
  "to": "+12125551234",
  "from": "+15551234567",
  "status": "initiated"
}
```

### `POST /calls/:callControlId/recording/start`

Start recording an active call. Records in WAV format.

```bash
curl -X POST http://localhost:5000/calls/v3:abc123.../recording/start
```

**Response:**

```json
{
  "call_control_id": "v3:abc123...",
  "recording_id": "rec-7f9c...",
  "format": "wav",
  "status": "recording"
}
```

### `POST /calls/:callControlId/recording/stop`

Stop recording an active call. Telnyx delivers the finished file via the `call.recording.saved` webhook.

```bash
curl -X POST http://localhost:5000/calls/v3:abc123.../recording/stop
```

**Response:**

```json
{
  "call_control_id": "v3:abc123...",
  "recording_id": "rec-7f9c...",
  "status": "stopped"
}
```

### `GET /calls/:callControlId/status`

Retrieve the tracked status of a call and its recording.

```bash
curl http://localhost:5000/calls/v3:abc123.../status
```

**Response:**

```json
{
  "call_control_id": "v3:abc123...",
  "to": "+12125551234",
  "from": "+15551234567",
  "status": "answered",
  "recording_id": "rec-7f9c...",
  "recording_status": "recording"
}
```

### `POST /webhooks/call`

Receives Telnyx call lifecycle events (`call.answered`, `call.hangup`, `call.recording.saved`) and updates the in-memory call state. Always acknowledges with `200`.

```json
{
  "received": true
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace. | Regenerate the key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys), update `.env`, and restart the server. |
| `400 Phone number must be in E.164 format` | The `to` number does not start with `+`. | Use full E.164, e.g. `+15551234567`. |
| `TELNYX_CONNECTION_ID environment variable not set` | The Call Control Application ID is missing from `.env`. | Copy the connection ID from your [Call Control Application](https://portal.telnyx.com/call-control/applications) into `.env`. |
| `404 Call <id> not found` | The `call_control_id` is not in the in-memory `activeCalls` map (server restarted or call hung up). | Initiate a fresh call; in-memory state is cleared on `call.hangup` and on restart. |
| Recording never starts / "Call not found" on start | Recording attempted before the call was answered. | Wait for the `call.answered` webhook, then call `/recording/start`. |
| Webhooks not received | `WEBHOOK_URL` is not publicly reachable or not configured on the Call Control App. | Run `ngrok http 5000` and set the `https://<id>.ngrok.io/webhooks/call` URL on your Call Control Application. |

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

- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - same example in Python
- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) - initiate outbound calls
- [text-to-speech-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-nodejs/README.md) - speak text on a call
- [call-recording-ai-summarizer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-recording-ai-summarizer-python/README.md) - summarize recordings with AI

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Call Control: Recording Start](https://developers.telnyx.com/api-reference/call-commands/recording-start)
- [Call Control: Dial](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice pricing](https://telnyx.com/pricing/call-control)
