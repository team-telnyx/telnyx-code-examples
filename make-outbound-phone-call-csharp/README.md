---
name: make-outbound-phone-call
title: "Make Outbound Phone Call"
description: "Place an outbound phone call with the Telnyx Call Control API using C# and ASP.NET."
language: csharp
framework: aspnet
telnyx_products: [Voice, Call Control]
---

# Make Outbound Phone Call (C#)

Place an outbound phone call with the Telnyx Call Control API. A minimal ASP.NET endpoint dials a number through the official Telnyx .NET SDK and returns the call control ID.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT delivered over one private, global network. The Call Control API used here links each outbound call to your Call Control Application via a connection ID, giving you programmatic control over the call lifecycle with low latency and predictable, pay-as-you-go pricing.

## Telnyx API Endpoints Used

- **Dial (Call Control)**: `POST /v2/calls` — placed via the SDK's `CallControlService.DialAsync(...)`. [API reference](https://developers.telnyx.com/api-reference/call-commands/dial)

## Architecture

```
  POST /calls/dial
        │
        ▼
  ┌──────────────────────────┐
  │  ASP.NET minimal API       │
  │  CallControlService.Dial   │
  └────────────┬─────────────┘
               │  POST /v2/calls (Telnyx.net SDK)
               ▼
  ┌──────────────────────────┐
  │  Telnyx Voice              │
  │  (Call Control)            │
  └────────────┬─────────────┘
               │
               ├──► Outbound call placed → call_control_id returned
               │
               └──► Lifecycle events (call.answered, call.hangup, ...)
                       │
                       ▼
                 POST /webhooks/calls  (Ed25519 signature verified)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API v2 key | [API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to dial from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_CONNECTION_ID` | `string` | `your_connection_id_here` | **yes** | Call Control Application (connection) ID | [Call Control Apps](https://portal.telnyx.com/call-control/applications) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_base64_public_key_here` | for webhooks | Base64 public key used to verify inbound webhook signatures | [Account > Public Key](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-csharp
cp .env.example .env    # ← fill in your credentials
dotnet restore
dotnet run              # starts on http://localhost:5000 (or the configured port)
```

> Requires the .NET 8 SDK. `dotnet restore` pulls the pinned `Telnyx.net 3.1.0` and `DotNetEnv 3.1.0` packages.

## API Reference

### `POST /calls/dial`

Initiates an outbound call to the specified phone number.

```bash
curl -X POST http://localhost:5000/calls/dial \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

**Response `200`:**

```json
{
  "call_control_id": "v3:abc123def456...",
  "call_session_id": "00000000-0000-0000-0000-000000000000",
  "call_leg_id": "00000000-0000-0000-0000-000000000000",
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

Receives call lifecycle events. The handler reads the raw body, verifies the Telnyx Ed25519 signature with `Webhook.ConstructEvent`, and reads event fields from `data.payload`. Returns `200` on success or `401` when the signature is missing, invalid, or the timestamp is stale.

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-csharp/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| App throws `TELNYX_API_KEY environment variable not set` on startup | `.env` missing or `TELNYX_API_KEY` not set | Confirm `.env` exists in the project root and contains `TELNYX_API_KEY`; `DotNetEnv.Env.Load()` runs before the SDK is configured. |
| `502 Bad Gateway` from `/calls/dial` | The Telnyx API rejected the request (bad/invalid API key, unknown `connection_id`, unverified number). The SDK raises `TelnyxException`; detail is logged server-side, not returned. | Check the server logs. Verify `TELNYX_API_KEY`, that `TELNYX_CONNECTION_ID` is a valid Call Control Application, and that `TELNYX_PHONE_NUMBER` is a number you own. |
| `400 Phone number must be in E.164 format` | The `to` value does not start with `+` | Send numbers in E.164: `+` + country code + number, no spaces or dashes (e.g. `+12125551234`). |
| `400 TELNYX_CONNECTION_ID environment variable not set` | `TELNYX_CONNECTION_ID` missing from `.env` | Copy your Call Control Application ID from the [Portal](https://portal.telnyx.com/call-control/applications) into `.env` and restart. |
| `401` from `/webhooks/calls` | Signature missing/invalid or timestamp outside the 300s tolerance | Confirm `TELNYX_PUBLIC_KEY` is the base64 public key from your Telnyx account, and that the raw body is read before any parsing. |
| `package Telnyx not found` during `dotnet restore` | Wrong package id | The NuGet id is `Telnyx.net`, not `Telnyx`. The pinned `.csproj` already uses `Telnyx.net 3.1.0`. |

## Related Examples

- [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) — Same outbound call flow in Node.js
- [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) — Same outbound call flow in Python
- [route-phone-calls-to-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) — Handle inbound calls with webhook-driven routing
- [record-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-nodejs/README.md) — Record outbound calls

## Resources

- [Voice / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [Dial API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [.NET SDK](https://developers.telnyx.com/development/sdk/dotnet)
- [Voice AI Agents product page](https://telnyx.com/products/voice-ai-agents)
- [Voice pricing](https://telnyx.com/pricing/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
