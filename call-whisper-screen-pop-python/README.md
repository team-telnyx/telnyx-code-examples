---
name: call-whisper-screen-pop
title: "Call Whisper & Screen Pop"
description: "Call Whisper & Screen Pop — whisper caller info to agent before connecting the call."
language: python
framework: flask
telnyx_products: [Voice, Number Lookup]
channel: [voice]
---

# Call Whisper & Screen Pop

Call Whisper & Screen Pop — whisper caller info to agent before connecting the call.

## Telnyx API Endpoints Used

- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Number Lookup**: `GET /v2/number_lookup/{phone}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

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
         ├──► Number Lookup
         ├──► Number Porting
         │
         ▼
    Ticket creation
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `AGENT_NUMBER` | `string` | `your_value` | **yes** | Agent number | — |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-screen-pop-python
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
docker build -t call-whisper-screen-pop-python .
docker run --env-file .env -p 5000:5000 call-whisper-screen-pop-python
```

## API Reference

### `POST /contacts`

Triggers contacts

```bash
curl -X POST http://localhost:5000/contacts \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
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

**Events handled:** `call.answered`, `call.hangup`, `call.initiated`, `call.speak.ended`

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
