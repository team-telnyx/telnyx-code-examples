---
name: programmable-hold-experience
title: "Programmable Hold Experience"
description: "Programmable Hold Experience — custom hold experiences: tips, trivia, estimated wait time, callback offers."
language: python
framework: flask
telnyx_products: [Cloud Storage, Migration, Number Porting, Voice]
channel: [voice]
---

# Programmable Hold Experience

Programmable Hold Experience — custom hold experiences: tips, trivia, estimated wait time, callback offers.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.dtmf.received` — DTMF tone detected during call
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.playback.ended` — Audio file playback completed
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## Architecture

```
  Source Platform
        │
        ▼
  ┌─────────────┐
  │ Audit       │ ── inventory numbers, configs, profiles
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Map & Plan  │ ── match source features to Telnyx equivalents
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     ┌─────────────────┐
  │ Provision   │────►│ Telnyx Platform  │
  │ on Telnyx   │     │ (numbers, SIP,   │
  └──────┬──────┘     │  messaging)      │
         │            └─────────────────┘
         ▼
  Migration Report
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `HOLD_NUMBER` | `string` | `your_value` | **yes** | Hold number | — |
| `HOLD_MUSIC_URL` | `string` | `https://file-examples.com/storage/fe1e2c9e0c6765da67ac0ed/2017/11/file_example_MP3_700KB.mp3` | no | Hold music url | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/programmable-hold-experience-python
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
docker build -t programmable-hold-experience-python .
docker run --env-file .env -p 5000:5000 programmable-hold-experience-python
```

## API Reference

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

**Events handled:** `call.answered`, `call.dtmf.received`, `call.hangup`, `call.initiated`, `call.playback.ended`, `call.speak.ended`

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
