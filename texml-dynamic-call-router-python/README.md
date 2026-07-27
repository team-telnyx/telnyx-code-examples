---
name: texml-dynamic-call-router
title: "TeXML Dynamic Call Router"
description: "TeXML Dynamic Call Router - time-of-day and caller-based routing with TeXML responses."
language: python
framework: flask
telnyx_products: [Voice, Call Recording]
---

# TeXML Dynamic Call Router

TeXML Dynamic Call Router - time-of-day and caller-based routing with TeXML responses.

## Telnyx API Endpoints Used

- **TeXML Webhooks**: Telnyx sends HTTP requests to your TeXML endpoints - [TeXML docs](https://developers.telnyx.com/docs/voice/texml)
- **TeXML Dial**: Route calls to SIP, PSTN, or conference - [reference](https://developers.telnyx.com/docs/voice/texml/verbs/dial)
- **TeXML Gather**: Collect DTMF or speech input - [reference](https://developers.telnyx.com/docs/voice/texml/verbs/gather)
- **TeXML Say**: Text-to-speech - [reference](https://developers.telnyx.com/docs/voice/texml/verbs/say)

## External Service Integrations

- **Email / SMTP** - Email notifications and alerts

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ Call Control      │
  └────────┬─────────┘
           │
           ├──► TeXML
           │
           ├──► Routing / dispatch
           │
           ▼
     Email
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `BUSINESS_HOURS_NUMBER` | `string` | `+15551234567` | no | Business hours number | - |
| `AFTER_HOURS_NUMBER` | `string` | `+15559876543` | no | After hours number | - |
| `VOICEMAIL_URL` | `string` | `https://example.com/voicemail.mp3` | no | Voicemail url | - |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/texml-dynamic-call-router-python
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

### `POST /texml/route`

Triggers route

```bash
curl -X POST http://localhost:5000/texml/route \
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

### `POST /texml/recording`

Triggers recording

```bash
curl -X POST http://localhost:5000/texml/recording \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "recordings": [
    {
      "id": "rec-abc123",
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "duration_seconds": 145,
      "url": "https://api.telnyx.com/v2/recordings/rec-abc123/download",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /vip`

Triggers vip

```bash
curl -X POST http://localhost:5000/vip \
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

### `GET /calls`

Returns calls

```bash
curl http://localhost:5000/calls
```

**Response:**

```json
{
  "calls": [
    {
      "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "from": "+18005551234",
      "to": "+12125559876",
      "duration_seconds": 145,
      "status": "completed"
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

- [Branded Caller Id Manager (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md)
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md)
- [Build IVR Phone Menu (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md)
- [Bulk Number Validation Cleaner (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md)
- [Call Analytics Dashboard Api (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
