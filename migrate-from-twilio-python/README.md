---
name: migrate-from-twilio
title: "Migrate from Twilio"
description: "Migrate from Twilio — complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, SMS/MMS, Voice]
channel: [sms]
---

# Migrate from Twilio

Migrate from Twilio — complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## External Service Integrations

- **Twilio (migration source)** — Source platform being migrated from ([docs](https://www.twilio.com/docs))

## Architecture

```
  Twilio API (source)
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

## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) webhook events:

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction
- `call.hangup` -- Call ended, app cleans up session

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TWILIO_ACCOUNT_SID` | `string` | `your_value` | **yes** | Twilio account sid | — |
| `TWILIO_AUTH_TOKEN` | `string` | `your_value` | **yes** | Twilio auth token | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-twilio-python
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

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

### Docker

```bash
docker build -t migrate-from-twilio-python .
docker run --env-file .env -p 5000:5000 migrate-from-twilio-python
```

## API Reference

### `GET /audit/twilio`

Returns twilio

```bash
curl http://localhost:5000/audit/twilio
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

### `POST /migrate/messaging-profile`

Triggers messaging-profile

```bash
curl -X POST http://localhost:5000/migrate/messaging-profile \
  -H "Content-Type: application/json" \
  -d '{
    "source_api_key": "SK_twilio_xxx",
    "dry_run": true
  }'
```

**Response:**

```json
{
  "migration": {
    "status": "completed",
    "resources_migrated": 12,
    "phone_numbers": 5,
    "applications": 3,
    "messaging_profiles": 2,
    "webhooks": 2
  }
}
```

### `POST /migrate/numbers`

Triggers numbers

```bash
curl -X POST http://localhost:5000/migrate/numbers \
  -H "Content-Type: application/json" \
  -d '{
    "source_api_key": "SK_twilio_xxx",
    "dry_run": true
  }'
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

### `GET /migrate/code-changes`

Returns code-changes

```bash
curl http://localhost:5000/migrate/code-changes
```

**Response:**

```json
{
  "migration": {
    "status": "completed",
    "resources_migrated": 12,
    "phone_numbers": 5,
    "applications": 3,
    "messaging_profiles": 2,
    "webhooks": 2
  }
}
```

### `GET /migration-log`

Returns migration-log

```bash
curl http://localhost:5000/migration-log
```

**Response:**

```json
{
  "migration": {
    "status": "completed",
    "resources_migrated": 12,
    "phone_numbers": 5,
    "applications": 3,
    "messaging_profiles": 2,
    "webhooks": 2
  }
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

### `POST /migrate/webhook-map`

Receives Telnyx webhook events for `/migrate/webhook-map`.

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
