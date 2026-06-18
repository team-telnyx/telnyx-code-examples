---
name: ai-sales-call-with-live-crm-updates
title: "AI Sales Call with Live CRM Updates"
description: "AI Sales Call with Live CRM Updates — multi-participant call with real-time deal intelligence."
language: python
framework: flask
telnyx_products: [SMS/MMS, AI Inference]
channel: [voice]
---

# AI Sales Call with Live CRM Updates

AI Sales Call with Live CRM Updates — multi-participant call with real-time deal intelligence.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)) ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):

- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.transcription` — Real-time transcription chunk received
- `message.received` — Inbound SMS/MMS received

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
  │  (Scoring)  │
  └───────────┬────────────┘
              │
              ├──► CRM update
              ▼
         Session Log
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `ASSISTANT_ID` | `string` | `asst_abc123` | no | Telnyx AI Assistant ID | [Portal](https://portal.telnyx.com/ai/assistants) |
| `CRM_WEBHOOK_URL` | `string` | `your_value` | **yes** | Crm webhook url | — |
| `FOLLOW_UP_NUMBER` | `string` | `your_value` | **yes** | Follow up number | — |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-sales-call-with-live-crm-updates-python
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
docker build -t ai-sales-call-with-live-crm-updates-python .
docker run --env-file .env -p 5000:5000 ai-sales-call-with-live-crm-updates-python
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
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
