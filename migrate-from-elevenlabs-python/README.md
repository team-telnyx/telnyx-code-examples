---
name: migrate-from-elevenlabs
title: "Migrate from ElevenLabs"
description: "Migrate from ElevenLabs - import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison."
language: python
framework: flask
telnyx_products: [AI Assistants, Migration]
channel: [voice]
---

# Migrate from ElevenLabs

Migrate from ElevenLabs - import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison.

## Telnyx API Endpoints Used

- **TTS Generate**: `POST /v2/ai/generate` - [API reference](https://developers.telnyx.com/api/inference/generate)
- **Chat Completions**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **List Models**: `GET /v2/ai/models` - [API reference](https://developers.telnyx.com/api/inference/list-models)

## Architecture

```
  ElevenLabs (source)
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

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `ELEVENLABS_API_KEY` | `string` | `your_value` | **yes** | Elevenlabs api key | - |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-elevenlabs-python
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

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## API Reference

### `GET /audit/elevenlabs`

Returns elevenlabs

```bash
curl http://localhost:5000/audit/elevenlabs
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

### `POST /migrate/voice-config`

Triggers voice-config

```bash
curl -X POST http://localhost:5000/migrate/voice-config \
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

### `GET /mapping/voices`

Returns voices

```bash
curl http://localhost:5000/mapping/voices
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

### `GET /cost-comparison`

Returns cost-comparison

```bash
curl http://localhost:5000/cost-comparison
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

### `POST /test-tts`

Triggers test-tts

```bash
curl -X POST http://localhost:5000/test-tts \
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

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
