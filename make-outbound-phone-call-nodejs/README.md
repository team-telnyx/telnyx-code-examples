---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Initiate an outbound phone call using the Telnyx Call Control API. Exposes an Express endpoint that dials a number and returns the call control ID."
language: nodejs
framework: express
telnyx_products: [Voice]
channel: [voice]
---

# Make Outbound Phone Call

Initiate an outbound phone call using the Telnyx Call Control API. Exposes an Express endpoint that dials a number and returns the call control ID.

## Telnyx API Endpoints Used

- **Dial (Call Control)**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

## Architecture

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │  initiateCall()   │
  └────────┬─────────┘
           │  client.calls.dial()
           ▼
  ┌──────────────────┐
  │  Telnyx Voice     │
  │  (Call Control)   │
  └────────┬─────────┘
           │
           └──► Outbound call placed → call_control_id returned
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT delivered over one private, global network. The Call Control API used here links each outbound call to your Call Control Application via a connection ID, giving you programmatic control over the call lifecycle with low latency and predictable, pay-as-you-go pricing.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY_your_telnyx_api_key_here` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to dial from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `your_connection_id_here` | **yes** | Call Control Application (connection) ID | [Call Control Apps](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000
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


## API Reference

### `POST /calls/dial`

Initiates an outbound call to the specified phone number.

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
  "call_control_id": "v3:abc123def456...",
  "from": "+15551234567",
  "to": "+12125551234",
  "state": "initiated"
}
```

**Error response** (e.g. missing `to`):

```json
{
  "error": "Missing required field: 'to'"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing or wrong | Generate a key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and put it in `.env` with no trailing spaces or quotes; restart the server. |
| `400 Phone number must be in E.164 format` | The `to` number does not start with `+` | Send numbers in E.164: `+` + country code + number, no spaces or dashes (e.g. `+12125551234`). |
| `400 TELNYX_CONNECTION_ID environment variable not set` | `TELNYX_CONNECTION_ID` is missing from `.env` | Copy your Call Control Application ID from the [Portal](https://portal.telnyx.com/call-control/applications) into `.env`; restart the server. |
| `400 TELNYX_PHONE_NUMBER environment variable not set` | `TELNYX_PHONE_NUMBER` is missing from `.env` | Add a Telnyx number you own in E.164 format and restart. |
| `429 Rate limit exceeded` | Too many requests in a short window | Slow down request volume or add client-side backoff. |
| `503 Network error connecting to Telnyx` | The server cannot reach the Telnyx API | Check outbound network connectivity and that `api.telnyx.com` is reachable. |
| Connection refused on port 5000 | Server not running or port in use | Run `node server.js`; set `PORT` in `.env` if 5000 is taken. |

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


## Related Examples

- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) - Same outbound call flow in Python
- [text-to-speech-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-nodejs/README.md) - Play TTS audio on a call
- [record-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-nodejs/README.md) - Record outbound calls
- [build-ivr-phone-menu-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-nodejs/README.md) - Build an IVR menu with Call Control

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Voice / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [Dial API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Voice AI Agents product page](https://telnyx.com/products/voice-ai-agents)
- [Voice pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
