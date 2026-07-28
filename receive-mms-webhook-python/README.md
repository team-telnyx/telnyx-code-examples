---
name: receive-mms-webhook
title: "Receive MMS Webhook"
description: "Receive inbound MMS messages with a Telnyx webhook, verify the signature, and download media attachments."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [mms]
---

# Receive MMS Webhook

Receive inbound MMS messages with a Telnyx webhook, verify the signature, and download media attachments.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Signed webhooks** - every inbound event is signed with Ed25519 so you can prove it came from Telnyx before you trust it.
- **Native MMS** - inbound media arrives as short-lived signed URLs you download directly, no extra carrier integration.
- **Developer-first** - first-party SDKs verify signatures, parse events, and call the API from one client.

## Telnyx API Endpoints Used

This example does not call the Telnyx REST API - it receives events Telnyx sends to your server. The webhook it consumes is:

- **`message.received`** - delivered to your Messaging Profile's inbound webhook URL when an MMS (or SMS) arrives. See the [inbound message webhook reference](https://developers.telnyx.com/api-reference/messages/receive-a-message).

Media attachments are fetched over plain HTTPS from the signed `media[].url` values Telnyx includes in the event.

## Architecture

```
  Inbound MMS
       │
       ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │  POST message.received (Ed25519-signed)
           ▼
  ┌────────────────────────────┐
  │ Flask  /webhooks/message    │
  │  1. verify signature        │
  │  2. parse data.payload      │
  │  3. download media[].url    │
  └────────────┬───────────────┘
               │
               └──► ./media/<message_id>_<idx>.<ext>
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `Ms1aN...` | **yes** | Public key used to verify inbound webhook signatures | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug mode | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-python
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

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging → Messaging Profiles** → your profile → **Inbound Settings** → Webhook URL → `https://<id>.ngrok.io/webhooks/message`

3. Make sure your Telnyx number is assigned to that Messaging Profile and is MMS-enabled.

## API Reference

### `POST /webhooks/message`

Receives the Telnyx `message.received` event. The request is rejected with `401` unless its Ed25519 signature verifies against `TELNYX_PUBLIC_KEY`. On a valid `message.received` event, any media attachments are downloaded to `./media/`.

Telnyx sends this request - you do not call it yourself. A representative payload:

```json
{
  "data": {
    "id": "f5d7a7e0-1234-5678-90ab-cdef12345678",
    "event_type": "message.received",
    "payload": {
      "direction": "inbound",
      "from": { "phone_number": "+12125550100" },
      "to": [{ "phone_number": "+13125550199" }],
      "text": "Check out this photo",
      "received_at": "2026-06-18T12:00:00Z",
      "media": [
        { "url": "https://media.telnyx.com/abc123", "content_type": "image/jpeg", "type": "image/jpeg" }
      ]
    }
  }
}
```

You can replay a signed event by re-sending one Telnyx already delivered (signed requests cannot be hand-crafted with curl). Response:

```json
{
  "status": "received",
  "message_id": "f5d7a7e0-1234-5678-90ab-cdef12345678",
  "media_count": 1
}
```

### `GET /messages`

Lists the media files downloaded so far (demonstration only - use a database in production).

```bash
curl http://localhost:5000/messages
```

```json
{
  "count": 1,
  "messages": [
    { "filename": "f5d7a7e0-1234-5678-90ab-cdef12345678_0.jpeg", "path": "media/f5d7a7e0-1234-5678-90ab-cdef12345678_0.jpeg" }
  ]
}
```

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{ "status": "healthy" }
```

## Troubleshooting

- **401 invalid signature**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the public key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) and restart the app. The key must match the account that owns the number.
- **Webhook never fires**: Confirm your Messaging Profile's inbound webhook URL matches your current ngrok URL and that your number is assigned to that profile and MMS-enabled.
- **Media download fails (403)**: Telnyx `media[].url` values are signed and short-lived. Download immediately on receipt; if you queue processing, do it promptly.
- **`media` empty on the event**: The sending device/carrier may have stripped the attachment. Test from another device or carrier.
- **Connection refused on port 5000**: The app isn't running, or another process owns the port. Run `python app.py` and check the port.

## Related Examples

- [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) - receive inbound SMS webhooks.
- [mms-photo-inventory-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/mms-photo-inventory-tracker-python/README.md) - act on inbound MMS images.
- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - send an outbound message.

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Receive a message - API reference](https://developers.telnyx.com/api-reference/messages/receive-a-message)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
