---
name: policy-renewal-campaign
title: "Policy Renewal Campaign"
description: "Automated multi-channel renewal reminders. 60 days: SMS. 30 days: AI voice call reviewing coverage changes. 7 days: urgent SMS. Agent reviews lapsed policies for win-back."
language: python
framework: flask
telnyx_products: [Voice, AI Inference]
integrations: [Stripe, Slack]
channel: [voice, sms]
---

# Policy Renewal Campaign

Automated multi-channel renewal reminders. 60 days: SMS. 30 days: AI voice call reviewing coverage changes. 7 days: urgent SMS. Agent reviews lapsed policies for win-back.

## Telnyx API Endpoints Used

- **Call Control: Gather (STT/DTMF)**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## External Service Integrations

- **Slack** — Team notifications via incoming webhooks ([docs](https://api.slack.com/messaging/webhooks))
- **Stripe** — Payment processing ([docs](https://docs.stripe.com/api))

## Architecture

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call         │
  │ Answered     │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     ┌──────────────────┐
  │ TTS Prompt  │────►│ Gather DTMF      │
  └─────────────┘     └────────┬─────────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │ AI Inference      │
                    │ • Verification     │
                    │ • Routing          │
                    └────────┬─────────┘
                             │
                    ┌────────┴────────┐
                    ├──► SMS to customer
                    ├──► Slack notification
                    └──► Payment processing
                             │
                             ▼
                    Transfer to Human Agent

  External: Stripe
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | `string` | `+18005551234` | **yes** | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection/app ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `AGENT_SLACK_WEBHOOK` | `string` | `your_value` | **yes** | Agent slack webhook | — |
| `STRIPE_API_KEY` | `string` | `your_value` | **yes** | Stripe api key | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/policy-renewal-campaign-python
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
docker build -t policy-renewal-campaign-python .
docker run --env-file .env -p 5000:5000 policy-renewal-campaign-python
```

## API Reference

### `POST /campaigns/run`

Triggers run

```bash
curl -X POST http://localhost:5000/campaigns/run \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer Outreach",
    "recipients": ["+12125551234", "+13105559876"],
    "message": "Your appointment reminder for tomorrow at 2 PM"
  }'
```

**Response:**

```json
{
  "campaign_id": "camp-1750280400",
  "status": "created",
  "recipients": 150,
  "scheduled_at": "2026-07-15T09:00:00Z"
}
```

### `GET /policies`

Returns policies

```bash
curl http://localhost:5000/policies
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /campaign-log`

Returns campaign-log

```bash
curl http://localhost:5000/campaign-log
```

**Response:**

```json
{
  "campaigns": [
    {
      "id": "camp-1750280400",
      "name": "Summer Outreach",
      "status": "active",
      "sent": 120,
      "delivered": 115,
      "failed": 5
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

**Events handled:** `call.answered`, `call.gather.ended`, `call.speak.ended`

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
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
