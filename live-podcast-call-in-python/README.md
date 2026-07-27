---
name: live-podcast-call-in
title: "Live Podcast Call-In Show"
description: "Hosts on a conference call, listeners call in. AI screens callers via STT, queues approved ones, generates real-time fact-checks for the host, TTS announces topics."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Conferencing, Media Streaming]
integrations: [Slack]
channel: [voice, api]
---

# Live Podcast Call-In Show

Hosts on a conference call, listeners call in. AI screens callers via STT, queues approved ones, generates real-time fact-checks for the host, TTS announces topics.

## Telnyx API Endpoints Used

- **Create Call**: `POST /v2/calls` -- [ref](https://developers.telnyx.com/api/call-control/create-call)
- **Answer**: `POST /v2/calls/{id}/actions/answer` -- [ref](https://developers.telnyx.com/api/call-control/answer-call)
- **Gather (screen)**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [ref](https://developers.telnyx.com/api/call-control/gather)
- **Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [ref](https://developers.telnyx.com/api/call-control/speak)
- **Join Conference**: `POST /v2/calls/{id}/actions/join_conference` -- [ref](https://developers.telnyx.com/api/call-control/join-conference)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

- `call.initiated` -- New inbound caller
- `call.answered` -- Caller connected, begin screening
- `call.gather.ended` -- Caller stated topic, AI evaluates
- `call.hangup` -- Caller disconnected

## External Service Integrations

- **Slack** -- Team notifications via incoming webhooks

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌──────────────────┐
  │ AI Inference      │ ── score + rank voice fits
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ TTS Generation    │ ── render audio
  │ (multiple takes/  │
  │  voices/languages)│
  └────────┬─────────┘
           │
           ├──► Voice response
           ├──► Slack alert
           └──► Download / stream
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) · [CLI: `telnyx number-orders`](https://developers.telnyx.com/development/cli) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection ID | [Portal](https://portal.telnyx.com/call-control/applications) · [CLI: `telnyx call-control-applications`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | AI Inference model | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_VOICE` | `string` | `nova` | no | TTS voice | [Docs](https://developers.telnyx.com/docs/inference) |
| `SHOW_TOPIC` | `string` | `Technology and AI` | no | Default show topic | --- |
| `SLACK_WEBHOOK` | `string` | `https://hooks.slack.com/...` | no | Slack webhook | [Docs](https://api.slack.com/messaging/webhooks) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/live-podcast-call-in-python
cp .env.example .env
pip install -r requirements.txt
python app.py
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

```bash
ngrok http 5000
```

Set webhook URL in [Telnyx Portal](https://portal.telnyx.com):
- Call Control Application -> `https://<id>.ngrok.io/webhooks/voice`

## API Reference

### `POST /shows/start`

```bash
curl -X POST http://localhost:5000/shows/start \
  -H "Content-Type: application/json" \
  -d '{"hosts": ["+12125551234"], "topic": "Voice AI Infrastructure"}'
```

**Response:**

```json
{"show_id": "show-a1b2c3d4", "call_in_number": "+18005551234", "status": "live"}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{"status": "ok"}
```

## Webhook Endpoints

### `POST /webhooks/voice`

Handles Telnyx Call Control webhook events. Called automatically by Telnyx - do not call directly.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

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

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
