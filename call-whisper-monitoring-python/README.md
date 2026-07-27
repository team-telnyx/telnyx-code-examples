---
name: call-whisper-monitoring
title: "Call Whisper Monitoring"
description: "Monitor calls with whisper prompts for agents."
language: python
framework: flask
telnyx_products: [AI Assistants, SMS/MMS, Voice, Call Recording]
---

# Post-Call Monitoring with Telnyx STT, Inference, and Call Control

Post-call analysis application. Triggers an outbound call, records the audio, transcribes it with Telnyx Speech-to-Text, generates an AI response with Telnyx Inference, and displays everything in a web dashboard. Built with Telnyx AI Assistants, Call Control, Call Recording, and AI Inference — no external AI provider required.

## Telnyx API Endpoints Used

- **Call Control: Dial**: `POST /v2/calls` - [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Call Control: Start Recording**: `POST /v2/calls/{id}/actions/start_recording` - [API reference](https://developers.telnyx.com/api/call-control/start-recording)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` - [API reference](https://developers.telnyx.com/api/call-control/speak)
- **AI Speech-to-Text**: `POST /v2/ai/audio/transcriptions` - [API reference](https://developers.telnyx.com/docs/ai/speech-to-text)
- **AI Inference (Chat)**: `POST /v2/ai/openai/chat/completions` - [API reference](https://developers.telnyx.com/docs/ai/inference)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` - Call connected - app begins interaction
- `call.hangup` - Call ended - app cleans up session, triggers post-call processing
- `call.recording.saved` - Call recording saved - URL available for download/processing

## Architecture

```
  POST /calls/initiate
        │
        ▼
  ┌──────────────────────┐
  │  Telnyx Call Control  │  ──► outbound call rings
  └──────────┬───────────┘
             │  call.answered → start recording
             │  call.hangup
             ▼
  ┌──────────────────────┐
  │  Flask app            │
  │  in-memory call_state │
  └──────────┬───────────┘
             │  call.recording.saved webhook
             ▼
  ┌──────────────────────┐
  │  download audio       │
  │  → Telnyx STT         │
  │  → Telnyx Inference   │
  │  → Telnyx TTS (speak) │
  └──────────────────────┘
             │
             └──► dashboard shows transcript + AI response
```

This is **post-call analysis**: the transcript and AI response appear in the web dashboard seconds after the call ends. TTS is attempted on the live call but gracefully skipped if the call has already hung up (the recording webhook arrives ~5 seconds after hangup).

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+13125551234` | **yes** | Telnyx phone number | [Portal](https://portal.telnyx.com/numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `2771215234625439469` | **yes** | Call Control Application ID | [Portal](https://portal.telnyx.com/call-control) |
| `TELNYX_PUBLIC_KEY` | `string` | `URQCA17ti...` | **yes** | Telnyx public key (for webhook signature verification) | [Portal](https://portal.telnyx.com/api-keys) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-python
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


### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/call`

### Web Dashboard

Open `http://localhost:5000` in your browser after starting the server. The dashboard lets you:

- Enter a phone number and trigger a call with one click
- Watch a live event timeline as webhooks arrive (call initiated → answered → recording → hangup → transcript → AI response)
- View the transcript and AI response in cards after the call ends
- Phone numbers are masked in the UI for privacy

## API Reference

### `POST /calls/initiate`

HTTP endpoint to initiate an outbound call.

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
  "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "status": "initiated",
  "from": "+18005551234",
  "to": "+12125559876"
}
```

### `GET /calls/<call_control_id>/status`

Retrieve call status, transcript, and AI response.

```bash
curl http://localhost:5000/calls/example-id/status
```

**Response:**

```json
{
  "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "is_alive": false,
  "state": "hangup",
  "transcript": "Hello, this is Harpreet. Who am I talking to today?",
  "ai_response": "Good morning, Harpreet. I'm an AI assistant. How can I help you today?",
  "spoken": false
}
```

## Webhook Endpoints

### `POST /webhooks/call`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.hangup`, `call.recording.saved`

**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      "call_session_id": "428c31b6-abcd-1234-5678-5013ef9657c1",
      "client_state": null,
      "from": "+12125551234",
      "to": "+13105559876",
      "direction": "incoming",
      "state": "ringing"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |
| TTS skipped (`spoken: false`) | Call already hung up before recording was processed | Expected behavior — `call.recording.saved` arrives ~5s after hangup. The transcript and AI response are still captured for post-call analysis. |
| Recording webhook never fires | Recording not enabled on the Call Control Application | Enable recording on the Call Control Application in the [Portal](https://portal.telnyx.com/call-control), or the app starts recording programmatically on `call.answered` |

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

- [Branded Caller Id Manager (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md)
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md)
- [Build IVR Phone Menu (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md)
- [Bulk Number Validation Cleaner (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md)
- [Call Analytics Dashboard Api (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Call Recording Webhooks](https://developers.telnyx.com/docs/voice/call-control/recording)
- [Telnyx Speech-to-Text](https://developers.telnyx.com/docs/ai/speech-to-text)
- [Telnyx AI Inference](https://developers.telnyx.com/docs/ai/inference)
- [Telnyx Speak (TTS) API](https://developers.telnyx.com/api-reference/call-commands/speak-text)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
