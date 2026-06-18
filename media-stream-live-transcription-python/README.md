---
name: media-stream-live-transcription
title: "Media Stream Live Transcription"
description: "Media Stream Live Transcription — fork call audio to WebSocket for real-time transcription display."
language: python
framework: flask
telnyx_products: [Media Streaming, Migration, Number Porting, Voice]
channel: [voice]
---

# Media Stream Live Transcription

Media Stream Live Transcription — fork call audio to WebSocket for real-time transcription display.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)) ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.transcription` — Real-time transcription chunk received
- `message.received` — Inbound SMS/MMS received

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► TTS (Text-to-Speech)
         ├──► STT (Speech Recognition)
         ├──► Media Streaming
         │
         ▼
    JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `STREAM_NUMBER` | `string` | `your_value` | **yes** | Stream number | — |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/media-stream-live-transcription-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t media-stream-live-transcription-python .
docker run --env-file .env -p 5000:5000 media-stream-live-transcription-python
```

## API Reference

### `GET /transcripts/<ccid>`

Returns ccid

```bash
curl http://localhost:5000/transcripts/example-id
```

**Response:**

```json
{
  "transcript": [
    {
      "time": 1750280400.0,
      "speaker": "...1234",
      "text": "I think we should proceed with option B"
    },
    {
      "time": 1750280415.0,
      "speaker": "...5678",
      "text": "Agreed, let me draft the proposal"
    }
  ],
  "summary": "Team agreed to proceed with option B. Proposal draft assigned."
}
```

### `GET /transcripts`

Returns transcripts

```bash
curl http://localhost:5000/transcripts
```

**Response:**

```json
{
  "transcript": [
    {
      "time": 1750280400.0,
      "speaker": "...1234",
      "text": "I think we should proceed with option B"
    },
    {
      "time": 1750280415.0,
      "speaker": "...5678",
      "text": "Agreed, let me draft the proposal"
    }
  ],
  "summary": "Team agreed to proceed with option B. Proposal draft assigned."
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Webhook Endpoints

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.hangup`, `call.initiated`, `call.transcription`

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

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
