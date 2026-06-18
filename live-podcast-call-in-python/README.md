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
  Participants (N)
    │   │   │
    ▼   ▼   ▼
  ┌───────────────────────┐
  │  Telnyx Conference     │
  │  Bridge                │
  └───────────┬────────────┘
              │
              ▼
  ┌───────────────────────┐
  │  AI Inference          │
  │  (Queue management)  │
  └───────────┬────────────┘
              │
              ├──► Slack notification
              ├──► Webhook callback
              ▼
         Session Log
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|------------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection ID | [Portal](https://portal.telnyx.com/call-control/applications) |
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

### Webhook Configuration

```bash
ngrok http 5000
```

Set webhook URL in [Telnyx Portal](https://portal.telnyx.com):
- Call Control Application -> `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t live-podcast-call-in-python .
docker run --env-file .env -p 5000:5000 live-podcast-call-in-python
```

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

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
