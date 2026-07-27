---
name: receive-sms-webhook
title: "Receive SMS Webhook (Java)"
description: "Receive inbound SMS via Telnyx webhooks with a JDK HttpServer, verifying the Ed25519 signature before reading data.payload."
language: java
framework: jdk-httpserver
telnyx_products: [Messaging]
channel: [sms]
---

# Receive SMS Webhook (Java)

Receive inbound SMS via Telnyx webhooks with a JDK `HttpServer`. Verifies the Telnyx Ed25519 signature before trusting the payload and acknowledges within 5 seconds.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network. Inbound SMS is delivered over the Telnyx-owned network with a webhook event model built for low-latency, reliable delivery.

- **Signed webhooks** - every delivery is signed with Ed25519 so you can cryptographically prove it came from Telnyx before acting on it.
- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.

## Telnyx API Endpoints Used

This example does not call the Telnyx REST API - it receives webhook events that Telnyx sends to your server when an SMS arrives.

- **Inbound Message webhook**: `POST /webhooks/sms` (your endpoint, called by Telnyx; event type `message.received`) -- [Webhook reference](https://developers.telnyx.com/docs/messaging/messages/receive-message)

## Architecture

```
  Inbound SMS
        │
        ▼
  ┌───────────────────┐
  │ Telnyx Messaging  │
  └────────┬──────────┘
           │ POST webhook (Ed25519-signed)
           ▼
  ┌───────────────────────────┐
  │ JDK HttpServer            │
  │ /webhooks/sms             │
  │  1. read raw body         │
  │  2. unwrap() → verify sig │
  │  3. read data.payload     │
  └────────┬──────────────────┘
           │
           └──► verify → read → 200 OK
```

The signed string is `"<telnyx-timestamp>|<raw body>"`. The handler reads the raw request bytes first, then calls `client.webhooks().unwrap(...)`, which performs the Ed25519 verification (with a 300-second replay window) against `TELNYX_PUBLIC_KEY` before parsing. Message fields are read from `data.payload`.

## Environment Variables

The Telnyx SDK reads these from the process environment via `TelnyxOkHttpClient.fromEnv()`. There is no `.env` auto-loading in Java - export the variables (see Setup) or copy `.env.example` and source it.

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key used to initialize the SDK client. | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `Pq3...base64...=` | **yes** | Ed25519 public key for webhook signature verification. The SDK rejects webhooks if this is unset. | [Portal → Keys & Credentials](https://portal.telnyx.com) |
| `PORT` | `number` | `8080` | no | Port the HttpServer listens on (defaults to `8080`). | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-sms-webhook-java

cp .env.example .env          # ← fill in your credentials, then export them
export $(grep -v '^#' .env | xargs)

mvn -q compile                # build (downloads the Telnyx SDK)
mvn -q exec:java              # starts on http://localhost:8080
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


Requires JDK 17+ (native Ed25519) and Maven 3.8+.

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 8080
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

3. Assign your inbound-enabled phone number to that Messaging Profile.

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-java/API.md) for the full typed endpoint reference.

### `POST /webhooks/sms`

Receives inbound SMS webhook events from Telnyx. Verifies the Ed25519 signature over `"<telnyx-timestamp>|<raw body>"`, reads the message from `data.payload`, and returns `200 OK` so Telnyx stops retrying. Real requests are signed by Telnyx; a request without valid signature headers is rejected with `401`.

**Response (verified inbound SMS):**

```json
{
  "status": "received",
  "message_id": "msg-f5d7a7e0-1234-5678"
}
```

### `GET /health`

Liveness check.

```bash
curl http://localhost:8080/health
```

**Response:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error":"missing signature headers"}` | Request lacks `telnyx-signature-ed25519` / `telnyx-timestamp`. | Only Telnyx sends these. When testing manually you cannot forge a valid signature; send a real test SMS to your number instead. |
| `401 {"error":"invalid signature"}` | Signature failed, timestamp outside the 300s window, or `TELNYX_PUBLIC_KEY` is wrong/unset. | Export the correct Ed25519 public key from the Portal and ensure your server clock is in sync (NTP). |
| `NoSuchAlgorithmException: Ed25519` | Running on JDK < 15 without an Ed25519 provider. | Use JDK 17+. |
| `IllegalStateException` mentioning `apiKey`/`publicKey` on startup | `TELNYX_API_KEY` or `TELNYX_PUBLIC_KEY` not exported. | `export $(grep -v '^#' .env | xargs)` before `mvn exec:java`. |
| No webhook requests arrive | Webhook URL not reachable or not assigned. | Verify the HTTPS URL (use ngrok locally), confirm it ends in `/webhooks/sms`, assign your number to the Messaging Profile, and check Portal webhook delivery logs. |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) - Same webhook receiver in Node.js
- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - Same webhook receiver in Python
- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Send a single SMS message
- [send-bulk-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-nodejs/README.md) - Send bulk SMS

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive a Message Guide](https://developers.telnyx.com/docs/messaging/messages/receive-message)
- [Webhook Signing Reference](https://developers.telnyx.com/api-reference/webhooks/verify-webhook-signatures)
- [Java SDK](https://developers.telnyx.com/development/sdk/java)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
