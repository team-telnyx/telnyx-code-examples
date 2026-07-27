---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Programmatically place an outbound phone call using Telnyx Call Control and handle the call lifecycle."
language: python
framework: flask
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call

Programmatically place an outbound phone call using Telnyx Call Control and handle the call lifecycle.

## Telnyx API Endpoints Used

- **Create Call**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Hangup**: `POST /v2/calls/{id}/actions/hangup` -- [API reference](https://developers.telnyx.com/api/call-control/hangup)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ Call Control      │
  └────────┬─────────┘
           │
           │
           ▼
     JSON response
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Single-vendor voice stack** - call control, STT, TTS, and recording from one API. No multi-vendor coordination.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `your_value` | **yes** | Telnyx phone number | - |
| `TELNYX_CONNECTION_ID` | `string` | `your_value` | **yes** | Telnyx connection id | - |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> telnyx call-control-applications list
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-python
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

### `POST /calls/dial`

HTTP endpoint to initiate an outbound call.

```bash
curl -X POST http://localhost:5000/calls/dial \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234"
  }'
```

**Response:**

```json
{
  "call_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "status": "initiated",
  "from": "+18005551234",
  "to": "+12125559876"
}
```

## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Unauthorized**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Webhooks not arriving**: Ensure ngrok URL is set in your [Call Control Application](https://portal.telnyx.com/call-control/applications) with the correct path.

## Related Examples

- [build-voice-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) - Full voice AI agent
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - Call recording

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
