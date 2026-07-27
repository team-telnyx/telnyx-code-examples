---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Place an outbound phone call using the Telnyx Call Control API and the Telnyx Ruby SDK, exposed through a Sinatra endpoint."
language: ruby
framework: sinatra
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call

Place an outbound phone call using the Telnyx Call Control API and the Telnyx Ruby SDK, exposed through a Sinatra endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Single-vendor voice stack** - call control, STT, TTS, and recording from one API. No multi-vendor coordination.
- **Global private network** - calls traverse the Telnyx-owned IP backbone for lower latency and higher reliability than the public internet.
- **Programmable Call Control** - every leg emits webhook events you can react to, so you can drive the call lifecycle from your own code.

## Telnyx API Endpoints Used

- **Dial (Create Call)**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

## Architecture

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────────┐
  │  Sinatra app (app.rb) │
  │  Telnyx::Client       │
  └──────────┬───────────┘
             │  client.calls.dial(connection_id:, from:, to:)
             ▼
  ┌──────────────────────┐
  │ Telnyx Call Control   │ ──► outbound call placed
  └──────────┬───────────┘
             │  Ed25519-signed webhook events
             ▼
  POST /webhooks/voice  (signature verified, then handled)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_CONNECTION_ID` | `string` | `1234567890123456789` | **yes** | Call Control Application ID that owns the call leg | [Call Control Applications](https://portal.telnyx.com/call-control/applications) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to call from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_VOICE_WEBHOOK_URL` | `string` | `https://abc123.ngrok.io/webhooks/voice` | no | Public URL for call lifecycle webhooks | your tunnel / host |
| `TELNYX_PUBLIC_KEY` | `string` | `Ck1...=` | no* | Base64 Ed25519 public key for webhook verification | [Keys & Credentials](https://portal.telnyx.com/account/keys-credentials) |
| `PORT` | `number` | `4567` | no | Port the Sinatra server listens on | - |

\* Required only if you receive call webhooks on `/webhooks/voice`.

## Setup

> **Requires Ruby 3.2 or newer.** The Telnyx Ruby SDK 5.x is a Stainless-generated
> rewrite that does not run on older Rubies.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-ruby
cp .env.example .env    # ← fill in your credentials
bundle install
ruby app.rb             # starts the Sinatra app on http://localhost:4567
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


`app.rb` exposes `POST /calls/dial` to place a call and `POST /webhooks/voice` to
receive Ed25519-verified call lifecycle events.

### Webhook configuration (optional)

1. Expose your local server:

   ```bash
   ngrok http 4567
   ```

2. Set `TELNYX_VOICE_WEBHOOK_URL` in `.env` to `https://<id>.ngrok.io/webhooks/voice`
   (or attach that URL to your Call Control Application in the
   [Telnyx Portal](https://portal.telnyx.com/call-control/applications)), and set
   `TELNYX_PUBLIC_KEY` so inbound events can be signature-verified.

## API Reference

### `POST /calls/dial`

Initiate an outbound call. See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-ruby/API.md) for the typed reference.

```bash
curl -X POST http://localhost:4567/calls/dial \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234"
  }'
```

**Response:**

```json
{
  "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "call_leg_id": "428c31b6-7af4-4bcb-b68e-5013ef9657c1",
  "call_session_id": "428c31b6-abc4-4cba-1234-5013ef9657c1",
  "is_alive": true,
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /webhooks/voice`

Receives call lifecycle events (`call.initiated`, `call.answered`, `call.hangup`).
Verifies the Telnyx Ed25519 signature before reading any fields from
`data.payload`. Returns `401` if the signature is missing or invalid.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error":"Invalid API key"}` (401) | `TELNYX_API_KEY` is missing, wrong, or has trailing whitespace | Copy a fresh key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` and restart the app - env vars load at boot |
| `{"error":"TELNYX_CONNECTION_ID environment variable not set"}` (500) | No Call Control Application ID configured | Set `TELNYX_CONNECTION_ID` from [Call Control Applications](https://portal.telnyx.com/call-control/applications) and restart |
| `{"error":"Phone number must be in E.164 format (e.g., +15551234567)"}` (400) | The `to` value does not start with `+` | Send the number in E.164 form, e.g. `+12125551234` |
| `{"error":"Missing required field: 'to'"}` (400) | The request body omitted `to` | Include `to` in the JSON body |
| `{"error":"Invalid webhook signature"}` (401) | `TELNYX_PUBLIC_KEY` unset/wrong, or the timestamp is stale (> 5 min) | Set the base64 public key from [Keys & Credentials](https://portal.telnyx.com/account/keys-credentials); ensure server clock is accurate |
| `{"error":"Rate limit exceeded. Please slow down."}` (429) | Too many requests in a short window | Back off and retry; queue outbound calls |
| `LoadError: cannot load such file -- standardwebhooks` | The `standardwebhooks` gem is not installed | Run `bundle install` - `require "telnyx"` loads it at startup even though the SDK does not declare it |
| `uninitialized constant Telnyx::Client` | The `telnyx` gem is not installed, or Ruby is older than 3.2 | Run `bundle install` on Ruby 3.2+ and restart |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx call-control-applications list
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) - Outbound calls with Python / Flask
- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) - Outbound calls with Node.js
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Send an SMS with Ruby
- [activate-sim-card-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-ruby/README.md) - Activate an IoT SIM with Ruby
- [route-phone-calls-to-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) - Route inbound calls to an AI agent

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Dial - API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Ruby SDK](https://developers.telnyx.com/development/sdk/ruby)
- [Telnyx Voice AI Agents](https://telnyx.com/products/voice-ai-agents)
- [Voice Pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
