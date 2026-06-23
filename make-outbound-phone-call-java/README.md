---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Place an outbound phone call with the Telnyx Call Control API using Java."
language: java
framework: jdk-http-server
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call (Java)

Programmatically place an outbound phone call using Telnyx Call Control (`calls.dial`) with the Telnyx Java SDK and the JDK's built-in HTTP server.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Single-vendor voice stack** — Call Control, STT, TTS, and recording from one API. No multi-vendor coordination.
- **Private global network** — calls traverse the Telnyx-owned IP backbone for lower latency and higher reliability than the public internet.
- **First-class SDKs** — the maintained Java SDK (`com.telnyx.sdk:telnyx`) ships a fluent builder API and a typed webhook event model.

## Telnyx API Endpoints Used

- **Dial (Call Control)**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- **Inbound Call Control webhooks** (e.g. `call.answered`, `call.hangup`) delivered to `POST /webhooks/voice` — [Webhook overview](https://developers.telnyx.com/docs/voice/programmable-voice/receiving-webhooks)

## Architecture

```
  POST /calls/dial  {"to": "+1..."}
          │
          ▼
  ┌─────────────────────────┐        client.calls().dial(params)
  │ HttpServer (JDK)        │ ───────────────────────────────────▶  Telnyx Call Control
  │  DialHandler            │ ◀───────────────────────────────────  CallDialResponse
  └─────────────────────────┘        { call_control_id, ... }
          ▲
          │  call.answered / call.hangup (Ed25519-signed)
  ┌─────────────────────────┐
  │  WebhookHandler         │  client.webhooks().unwrap(...) verifies signature
  │  POST /webhooks/voice   │  then reads data.payload
  └─────────────────────────┘
```

A single shared `TelnyxClient` is created once from the environment via `TelnyxOkHttpClient.fromEnv()` and reused by every request handler.

## Environment Variables

Copy `.env.example` to `.env` and fill in your values, then export them into the shell before running (see Setup).

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Caller ID (a Telnyx number you own, E.164) | [Portal → Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `1234567890` | **yes** | Call Control Application (connection) ID | [Portal → Call Control → Applications](https://portal.telnyx.com/call-control/applications) |
| `TELNYX_PUBLIC_KEY` | `string` | `e5J...base64` | for webhooks | Base64 Ed25519 public key used to verify webhook signatures | [Portal → Keys & Credentials](https://portal.telnyx.com) |
| `TELNYX_WEBHOOK_URL` | `string` | `https://<id>.ngrok.io/webhooks/voice` | no | Per-call webhook URL for events | — |
| `PORT` | `string` | `8080` | no | HTTP listen port (defaults to `8080`) | — |

## Setup

Requires JDK 17+ (the SDK's Ed25519 webhook verification needs the JDK 15+ native provider) and Maven 3.6+.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-java
cp .env.example .env            # ← fill in your credentials

# Export the variables into the shell (the SDK reads them from the environment)
set -a && . ./.env && set +a

mvn compile                     # downloads + compiles
mvn exec:java                   # starts on http://localhost:8080
```

### Webhook configuration

1. Expose your local server:

   ```bash
   ngrok http 8080
   ```

2. In the [Telnyx Portal](https://portal.telnyx.com), open your **Call Control Application** and set the **Webhook URL** to `https://<id>.ngrok.io/webhooks/voice`.

3. Set `TELNYX_PUBLIC_KEY` (Portal → Keys & Credentials) so incoming webhooks can be signature-verified.

## API Reference

### `POST /calls/dial`

Initiate an outbound call.

```bash
curl -X POST http://localhost:8080/calls/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

**Response `200`:**

```json
{
  "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

### `POST /webhooks/voice`

Receives Call Control events. The Ed25519 signature is verified before any field is read; an invalid signature returns `401`. See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-java/API.md) for the full typed reference.

### `GET /health`

Returns `{"status":"ok"}`.

## Troubleshooting

- **`Missing required environment variable: TELNYX_PHONE_NUMBER`** on startup — the `.env` values were not exported. Run `set -a && . ./.env && set +a` in the same shell before `mvn exec:java`.
- **401 from `/calls/dial` upstream / `Failed to place call`** — your `TELNYX_API_KEY` is invalid or the number/connection is not voice-enabled. Check the server logs (detail is logged, not returned) and regenerate the key at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **`Field 'to' is required and must be E.164`** — send the destination as `+<countrycode><number>`, e.g. `+12125551234`.
- **`Invalid webhook signature` (401)** — `TELNYX_PUBLIC_KEY` is missing or does not match your account, or the request was replayed outside the 300s window. Copy the public key from the [Portal](https://portal.telnyx.com).
- **Ed25519 errors during webhook verify** — run on JDK 17. The SDK's verifier uses the JDK-native `Ed25519` provider available on JDK 15+.

## Related Examples

- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) — same use case in Python.
- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) — same use case in Node.js.
- [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) — inbound call routing with webhooks.

## Resources

- [Call Control guide](https://developers.telnyx.com/docs/voice/call-control) — dev docs
- [Dial API reference](https://developers.telnyx.com/api-reference/call-commands/dial) — `POST /v2/calls`
- [Telnyx Java SDK](https://developers.telnyx.com/development/sdk/java) — SDK page
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents) — product page
- [Voice pricing](https://telnyx.com/pricing/call-control) — pricing
