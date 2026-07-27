---
name: migrate-from-twilio
title: "Migrate from Twilio"
description: "Migrate from Twilio - complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, SMS/MMS, Voice]
channel: [sms]
---

# Migrate from Twilio

Migrate from Twilio - complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` - [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` - [API reference](https://developers.telnyx.com/api/call-control/speak)

## External Service Integrations

- **Twilio (migration source)** - Source platform being migrated from ([docs](https://www.twilio.com/docs))

## Architecture

```
  Twilio (source)
        │
        ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 1. Audit         │────►│ Inventory Report  │
  │    (numbers,     │     │ (numbers, configs,│
  │     configs)     │     │  webhooks, apps)  │
  └────────┬─────────┘     └───────────────────┘
           │
           ▼
  ┌──────────────────┐
  │ 2. Map Features  │ ── source capability → Telnyx equivalent
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 3. Provision     │────►│ Telnyx Platform   │
  │    on Telnyx     │     │ • Phone numbers   │
  └────────┬─────────┘     │ • SIP connections │
           │               │ • Messaging       │
           ▼               └───────────────────┘
  ┌──────────────────┐
  │ Migration Report │
  │ (success/fail    │
  │  per resource)   │
  └──────────────────┘
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
| `TWILIO_ACCOUNT_SID` | `string` | `your_value` | **yes** | Twilio account sid | - |
| `TWILIO_AUTH_TOKEN` | `string` | `your_value` | **yes** | Twilio auth token | - |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-twilio-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

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
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Abandoned Cart Recovery (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/abandoned-cart-recovery-python/README.md)
- [Accounting Tax Season Line (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/accounting-tax-season-line-python/README.md)
- [After Hours Nurse Triage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/after-hours-nurse-triage-python/README.md)
- [AI Appointment Booking SMS Flow (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-booking-sms-flow-python/README.md)
- [AI Appointment Reminder SMS Voice (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-reminder-sms-voice-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
