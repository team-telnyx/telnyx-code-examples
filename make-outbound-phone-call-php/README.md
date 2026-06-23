---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Place an outbound phone call with the Telnyx Call Control API using PHP."
language: php
framework: vanilla-php
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call (PHP)

Place an outbound phone call with the Telnyx Call Control API in vanilla PHP. A single `index.php` front controller exposes an endpoint that dials a number and returns the call control ID, plus an Ed25519-verified webhook receiver for call lifecycle events.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT delivered over one private, global network. The Call Control API used here links each outbound call to your Call Control Application via a connection ID, giving you programmatic control over the call lifecycle with low latency and predictable, pay-as-you-go pricing.

## Telnyx API Endpoints Used

- **Dial (Call Control)**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

The webhook receiver consumes Telnyx call control events (`call.initiated`, `call.answered`, `call.hangup`, …) posted back to your server.

## Architecture

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────────┐
  │  index.php (router)   │
  │  initiateCall()       │
  └──────────┬───────────┘
             │  $client->calls->dial(connectionID, from, to)
             ▼
  ┌──────────────────────┐
  │  Telnyx Voice         │
  │  (Call Control)       │
  └──────────┬───────────┘
             │  outbound call placed → call_control_id returned
             │
             │  call lifecycle events (signed)
             ▼
  POST /webhooks/calls  ──►  $client->webhooks->unwrap()  (Ed25519 verify)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API v2 key | [API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to dial from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `your_connection_id_here` | **yes** | Call Control Application (connection) ID | [Call Control Apps](https://portal.telnyx.com/call-control/applications) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | for webhooks | Base64 Ed25519 public key used to verify webhook signatures | [Account Settings → Public Key](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-php
cp .env.example .env       # ← fill in your credentials
composer install
php -S localhost:8080 index.php   # starts on http://localhost:8080
```

> Requires PHP 8.1+ with the `sodium` extension (bundled in standard PHP 8 builds) and [Composer](https://getcomposer.org/).

## API Reference

### `POST /calls/dial`

Initiates an outbound call to the specified phone number.

```bash
curl -X POST http://localhost:8080/calls/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

**Response `200`:**

```json
{
  "call_control_id": "v3:abc123def456...",
  "call_leg_id": "0ccc7b54-...",
  "call_session_id": "0ccc7b54-...",
  "is_alive": true,
  "from": "+15551234567",
  "to": "+12125551234"
}
```

**Error response** (e.g. missing `to`):

```json
{
  "error": "Missing required field: 'to'"
}
```

### `POST /webhooks/calls`

Receives Telnyx call control webhooks, verifies the Ed25519 signature with
`TELNYX_PUBLIC_KEY`, and acknowledges with `200`. Invalid signatures return `401`.

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-php/API.md) for the full typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error": "Invalid API key"}` | `TELNYX_API_KEY` is missing or wrong | Generate a key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and put it in `.env` with no trailing spaces or quotes; restart the server. |
| `400 Phone number must be in E.164 format` | The `to` number does not start with `+` | Send numbers in E.164: `+` + country code + number, no spaces or dashes (e.g. `+12125551234`). |
| `400 TELNYX_CONNECTION_ID environment variable not set` | `TELNYX_CONNECTION_ID` is missing from `.env` | Copy your Call Control Application ID from the [Portal](https://portal.telnyx.com/call-control/applications) into `.env`; restart the server. |
| `400 TELNYX_PHONE_NUMBER environment variable not set` | `TELNYX_PHONE_NUMBER` is missing from `.env` | Add a Telnyx number you own in E.164 format and restart. |
| `429 Rate limit exceeded` | Too many requests in a short window | Slow down request volume or add client-side backoff. |
| `503 Network error connecting to Telnyx` | The server cannot reach the Telnyx API | Check outbound network connectivity and that `api.telnyx.com` is reachable. |
| `401 Invalid signature` on webhook | `TELNYX_PUBLIC_KEY` is missing/wrong, or the request was not from Telnyx | Copy the base64 Ed25519 public key from the Portal into `.env`; ensure the raw body is passed unmodified to `unwrap()`. |
| `Call to undefined function sodium_crypto_sign_verify_detached()` | The `sodium` extension is not enabled | Enable `ext-sodium` (bundled in standard PHP 8 builds; on minimal builds install/enable it). |

## Related Examples

- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) — Same outbound call flow in Node.js
- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) — Same outbound call flow in Python
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) — Handle inbound call webhooks
- [build-ivr-phone-menu-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md) — Build an IVR menu with Call Control

## Resources

- [Voice / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [Dial API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Voice AI Agents product page](https://telnyx.com/products/voice-ai-agents)
- [Voice pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
