---
name: texml-voicemail-drop
title: "TeXML Voicemail Drop — leave pre-recorded voicemails at scale via TeXML."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Voice]
channel: [voice]
---

# TeXML Voicemail Drop — leave pre-recorded voicemails at scale via TeXML.

TeXML Voicemail Drop — leave pre-recorded voicemails at scale via TeXML.

## Telnyx API Endpoints Used

- **Call Control: Hangup**: `POST /v2/calls/{call_control_id}/actions/hangup` — [API reference](https://developers.telnyx.com/api/call-control/hangup)
- **Call Control: Dial**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/dial)

## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.hangup` — call ended, app cleans up session

## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│  Phone Call  │────►│   Telnyx   │────►│  POST /webhooks/voice│
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `FROM_NUMBER` | `string` | `+18005551234` | **yes** | from number | — |
| `CONNECTION_ID` | `string` | `1234567890` | **yes** | Call Control connection ID | [→ link](https://portal.telnyx.com/call-control/applications) |
| `VOICEMAIL_AUDIO_URL` | `string` | `https://...` | no | voicemail audio url | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/texml-voicemail-drop-python
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
docker build -t texml-voicemail-drop .
docker run --env-file .env -p 5000:5000 texml-voicemail-drop
```

## API Reference

### `POST /drop`

Handles `POST /drop`.

**Request:**

```bash
curl -X POST http://localhost:5000/drop \
  -H "Content-Type: application/json" \
  -d '{
  "numbers": "[]"
}'
```

**Response:**

```json
{
  "results": "...",
  "total": 3
}
```

### `GET /drops`

Returns all drops.

**Request:**

```bash
curl http://localhost:5000/drops
```

**Response:**

```json
{
  "drops": "...",
  "total": 3
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Webhook Endpoints

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.hangup`

**Example inbound payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
    "connection_id": "1494404757140276705",
    "direction": "incoming",
    "from": "+12125551234",
    "to": "+13105559876",
    "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
    "client_state": null,
    "state": "ringing"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Resources

- [Call Control: Hangup — API Reference](https://developers.telnyx.com/api/call-control/hangup)
- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
