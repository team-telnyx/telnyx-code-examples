---
name: receive-sms-webhook
title: "Receive SMS Webhook (PHP)"
description: "Receive and Ed25519-verify inbound Telnyx SMS webhooks using the Telnyx PHP SDK over a vanilla PHP front controller."
language: php
framework: vanilla
telnyx_products: [SMS]
channel: [sms]
---

# Receive SMS Webhook (PHP)

Receive and Ed25519-verify inbound Telnyx SMS webhooks using the Telnyx PHP SDK over a vanilla PHP front controller.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT SIM management on one private, global network. The Messaging API delivers inbound SMS to your webhook with the same API key and SDK you use for everything else, and the SDK verifies every event for you.

- **Signed webhooks** - every inbound message is signed with Ed25519; the PHP SDK verifies the signature and timestamp before you read a single field.
- **One platform** - SMS sits next to voice, SIP, AI assistants, and IoT under a single API key.
- **Developer-first SDKs** - the Telnyx PHP SDK ships typed services, native webhook verification, and pluggable PSR-18 transport.

## Telnyx API Endpoints Used

- **Inbound SMS webhook**: Telnyx delivers a `message.received` event to your configured webhook URL - [Receive an SMS](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- **Webhook verification**: `$client->webhooks->unwrap($body, $headers)` verifies the Telnyx Ed25519 signature over `"<telnyx-timestamp>|<raw body>"` and parses the event - [Webhook signing](https://developers.telnyx.com/docs/messaging/messages/receive-message)

This example only *receives* webhooks; it does not call an outbound Telnyx REST endpoint.

## Architecture

```
   Inbound SMS to your Telnyx number
                 │
                 ▼
   ┌──────────────────────────────┐
   │  Telnyx Messaging platform    │
   │  signs event (Ed25519)        │
   └──────────────┬───────────────┘
                  │  POST message.received
                  ▼
   ┌──────────────────────────────┐
   │  Vanilla PHP router           │
   │  (index.php)                  │
   │   POST /webhooks/sms          │
   └──────────────┬───────────────┘
                  │  $client->webhooks->unwrap()
                  ▼
   ┌──────────────────────────────┐
   │  Ed25519 signature verified?  │
   │   no  ─► 401                  │
   │   yes ─► read data.payload    │
   └──────────────────────────────┘
```

The signature is verified **before** any field is trusted. Verified events are read from `data.payload`, then acknowledged with `200` so Telnyx does not retry.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to construct the SDK client | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o0Yf...base64...=` | **yes** | Base64 Ed25519 public key used to verify the `Telnyx-Signature-Ed25519` header on inbound webhooks | [Portal → Account → Public Key](https://portal.telnyx.com) |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-php
cp .env.example .env        # ← fill in TELNYX_API_KEY and TELNYX_PUBLIC_KEY
composer install
php -S localhost:8080 index.php
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


The server listens on `http://localhost:8080`. PHP 8.1+ with the bundled `ext-sodium` is required (used for Ed25519 webhook verification).

To receive real webhooks, expose your local server with a tunnel (for example `ngrok http 8080`) and set the resulting `https://.../webhooks/sms` URL as the webhook on your [Messaging Profile](https://portal.telnyx.com/#/messaging) in the Telnyx Portal.

## API Reference

### `POST /webhooks/sms`

Receive a Telnyx inbound SMS webhook. The raw body and headers are passed to `$client->webhooks->unwrap()`, which verifies the `Telnyx-Signature-Ed25519` header (with a 300s timestamp tolerance) before the event is parsed. Only `message.received` events are processed; others are acknowledged and ignored.

**Response `200` (inbound SMS processed):**

```json
{
  "status": "received",
  "messageId": "40000000-0000-0000-0000-000000000000"
}
```

**Response `200` (other event type, ignored):**

```json
{
  "status": "ignored",
  "eventType": "message.finalized"
}
```

A missing or invalid signature returns `401 {"error": "Invalid webhook signature"}`.

### `GET /health`

Liveness probe.

```bash
curl http://localhost:8080/health
```

**Response `200`:** `{ "status": "ok" }`

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-php/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error": "Invalid webhook signature"}` (401) | `TELNYX_PUBLIC_KEY` is missing/wrong, the request was not signed by Telnyx, or the timestamp is outside the 300s tolerance. | Set the base64 Ed25519 public key from the Telnyx Portal, confirm `ext-sodium` is enabled, and check the server clock. |
| `{"error": "Server misconfigured"}` (500) | `TELNYX_API_KEY` or `TELNYX_PUBLIC_KEY` is not set. | Populate `.env` (or the process environment) and restart the server. |
| `{"error": "Bad webhook request"}` (400) | The body could not be parsed as a Telnyx event. | Confirm Telnyx is POSTing the raw JSON body unmodified; proxies must not rewrite it before it reaches `php://input`. |
| Webhook never fires | The Messaging Profile has no webhook URL, or the URL is not publicly reachable. | Set the `https://.../webhooks/sms` URL on your Messaging Profile and verify your tunnel/server is reachable over HTTPS. |
| `Class "Sodium..." not found` / verification always fails | PHP was built without `ext-sodium`. | Install/enable the sodium extension (bundled in standard PHP 8 builds). |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Same example in Python
- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Same example in Node.js
- [receive-sms-webhook-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-java/README.md) - Same example in Java
- [receive-sms-webhook-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-csharp/README.md) - Same example in C#

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive an SMS (Messaging docs)](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Inbound Message Webhook API Reference](https://developers.telnyx.com/api-reference/messages/inbound-message-webhook)
- [PHP SDK](https://developers.telnyx.com/development/sdk/php)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
