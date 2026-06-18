---
name: fraud-alert-verification
title: "Fraud Alert & Verification"
description: "Suspicious transaction triggers voice call to customer, verifies via DTMF, blocks or approves in real-time. Fraud team reviews edge cases via Slack."
language: python
framework: flask
telnyx_products: [Voice]
integrations: [Slack]
channel: [voice, sms]
---

# Fraud Alert & Verification

Suspicious transaction triggers voice call to customer, verifies via DTMF, blocks or approves in real-time. Fraud team reviews edge cases via Slack.

## Telnyx API Endpoints Used

- **Call Control: Gather (STT/DTMF)**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## External Service Integrations

- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))

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
         ├──► Messaging API
         │
         ▼
    SMS to customer
    Voice response (TTS)

  State: In-memory state
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `FRAUD_SLACK_WEBHOOK` | `string` | `https://hooks.slack.com/services/T.../B.../xxx` | no | Slack webhook for fraud alerts | [Portal](https://api.slack.com/messaging/webhooks) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/fraud-alert-verification-python
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
   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

### Docker

```bash
docker build -t fraud-alert-verification-python .
docker run --env-file .env -p 5000:5000 fraud-alert-verification-python
```

## API Reference

### `POST /alerts/trigger`

Triggers trigger

```bash
curl -X POST http://localhost:5000/alerts/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125551234",
    "event": "suspicious_transaction",
    "amount": 150.00
  }'
```

**Response:**

```json
{
  "alert_id": "alrt-98234",
  "status": "sent",
  "phone": "+12125551234",
  "channel": "voice"
}
```

### `GET /alerts`

Returns alerts

```bash
curl http://localhost:5000/alerts
```

**Response:**

```json
{
  "alerts": [
    {
      "id": "alrt-98234",
      "transaction": "TXN-98234",
      "amount": 150.00,
      "risk_score": 85,
      "status": "verified",
      "verified_at": "2026-07-15T14:32:00Z"
    }
  ]
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

**Events handled:** `call.answered`, `call.gather.ended`, `call.hangup`, `call.speak.ended`

**Example payload:**

```json
{
  "data": {
    "event_type": "call.gather.ended",
    "id": "a1b2c3d4-5678-9abc-def0-123456789abc",
    "occurred_at": "2026-07-15T14:30:15.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "client_state": "eyJzdGVwIjoibWFpbl9tZW51In0=",
      "digits": "1",
      "from": "+12125551234",
      "to": "+13105559876",
      "speech": {
        "result": "I need help with my account billing",
        "confidence": 0.94
      },
      "status": "valid"
    },
    "record_type": "event"
  }
}
```

### `POST /webhooks/sms`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events.

**Example payload:**

```json
{
  "data": {
    "event_type": "message.received",
    "id": "f5d7a7e0-1234-5678-9abc-def012345678",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "id": "f5d7a7e0-1234-5678-9abc-def012345678",
      "direction": "inbound",
      "type": "SMS",
      "from": {
        "phone_number": "+12125551234",
        "carrier": "Verizon",
        "line_type": "Wireless"
      },
      "to": [{"phone_number": "+13105559876"}],
      "text": "Hello, I need help",
      "media": [],
      "received_at": "2026-07-15T14:30:00.000Z",
      "messaging_profile_id": "40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c"
    },
    "record_type": "event"
  }
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
