---
name: send-sms
title: "Send SMS (C#)"
description: "Send an SMS message using the Telnyx Messaging API with a C# minimal ASP.NET endpoint."
language: csharp
framework: aspnet
telnyx_products: [Messaging]
channel: [sms]
---

# Send SMS (C#)

Send an SMS message using the Telnyx Messaging API with a C# minimal ASP.NET endpoint.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network - with deliverability built in (number reputation, 10DLC registration, and deliverability monitoring) and SDKs for every major language, including the official `Telnyx.net` NuGet package for .NET.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)

Called from the code via `new MessagingSenderIdService().CreateAsync(new NewMessagingSenderId { From, To, Text })`.

The optional `POST /webhooks/sms` receiver verifies inbound `message.received` / `message.finalized` events with `Telnyx.net.Infrastructure.Public.Webhook.ConstructEvent`.

## Architecture

```
  POST /sms/send
        │
        ▼
  ┌────────────────────────┐
  │ Minimal ASP.NET handler │
  │ (validate input)        │
  └───────────┬────────────┘
              │ MessagingSenderIdService.CreateAsync()
              ▼
  ┌────────────────────────┐
  │ Telnyx Messaging        │
  └───────────┬────────────┘
              │
              └──► SMS delivered

  POST /webhooks/sms  ──► Webhook.ConstructEvent (Ed25519) ──► data.payload
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx number to send from (E.164) | [My Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yx...base64...` | webhook only | Account public key for Ed25519 webhook verification | Portal > Account > Public Key |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-csharp
cp .env.example .env    # ← fill in your credentials
dotnet restore          # restores Telnyx.net 3.1.0 and DotNetEnv 3.1.0
dotnet run              # starts on http://localhost:5000 (see Properties/launchSettings.json or ASPNETCORE_URLS)
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

### `POST /sms/send`

Send a single SMS. Expects a JSON body with `to` and `message`.

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125551234",
    "message": "Hello from Telnyx!"
  }'
```

**Response `200`:**

```json
{
  "message_id": "40017f3c-bba0-4f3f-8b2c-1a8d0c1f9c11",
  "from": "+15551234567",
  "to": "+12125551234"
}
```

**Response `400`** (missing `to` or `message`, or non-E.164 number):

```json
{
  "error": "Missing required fields: 'to' and 'message'"
}
```

### `POST /webhooks/sms`

Receives inbound message webhooks from Telnyx. The raw body is read before parsing and verified with the account public key (Ed25519 over `"{telnyx-timestamp}|{body}"`). Returns `200` when verified, `401` when the signature is missing/invalid or the timestamp is stale. See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-csharp/API.md) for the full typed reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `FATAL: TELNYX_API_KEY is not set` on startup | `.env` is missing or not loaded. | Ensure `.env` sits next to the `.csproj`, is named exactly `.env`, and contains `TELNYX_API_KEY`. |
| `Failed to send message` (502) | Telnyx rejected the request (bad key, unverified number, no Messaging Profile). The detail is in the server log, not the response. | Check the console logs, confirm `TELNYX_API_KEY` is valid and the `from` number is messaging-enabled. |
| `Phone number must be in E.164 format` (400) | The `to` value does not start with `+`. | Use E.164: `+` then country code and number, no spaces or dashes, e.g. `+12125551234`. |
| `TELNYX_PHONE_NUMBER environment variable not set` (400) | `.env` is missing the from number. | Add `TELNYX_PHONE_NUMBER=+1...` to `.env` and restart `dotnet run`. |
| SMS accepted but never delivered | Number has no Messaging Profile or messaging is not enabled. | Assign a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) and confirm the number is messaging-enabled. |
| `401` from `/webhooks/sms` | Wrong/absent `TELNYX_PUBLIC_KEY`, body re-parsed before verification, or timestamp outside the 300s tolerance. | Use the account public key from the Portal and confirm the raw body is read before any JSON parsing. |
| Package `Telnyx` not found on restore | The official NuGet id is `Telnyx.net`, not `Telnyx`. | Use `<PackageReference Include="Telnyx.net" Version="3.1.0" />`. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Same example in Python
- [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) - Same example in Node.js
- [send-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-go/README.md) - Same example in Go
- [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) - Same example in Ruby
- [send-bulk-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-nodejs/README.md) - Send many messages in a batch
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Receive inbound SMS via webhook

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message - API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [.NET / C# SDK](https://developers.telnyx.com/development/sdk/dotnet)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
