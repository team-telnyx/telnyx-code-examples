---
name: whatsapp-grocery-delivery-nodejs
title: "WhatsApp AI Grocery Delivery Assistant"
description: "AI-powered grocery delivery assistant on WhatsApp — 12 tools, voice ordering, real-time dashboard"
language: nodejs
framework: express
telnyx_products: [WhatsApp Business API, AI Inference, Number Lookup, Audio Transcription]
---

# WhatsApp AI Grocery Delivery Assistant

AI-powered grocery delivery assistant on WhatsApp — 12 AI tools, voice note ordering, real-time operator dashboard.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. This example combines four Telnyx APIs behind a single API key: WhatsApp Business messaging delivers rich interactive messages, AI Inference powers the tool-calling agent, Number Lookup validates customer phone numbers, and Audio Transcription converts voice notes into grocery orders. The result is a full-featured delivery assistant that runs on one platform with no third-party AI or messaging vendors.

## Telnyx API Endpoints Used

- **WhatsApp Messaging**: `POST /v2/messages/whatsapp` — [API reference](https://developers.telnyx.com/api/v2/whatsapp)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` — [API reference](https://developers.telnyx.com/api/number-lookup/number-lookup)
- **Audio Transcription**: `POST /v2/ai/audio/transcriptions` — [API reference](https://developers.telnyx.com/api/inference/audio-transcriptions)

## Architecture

```
  WhatsApp User
        |
        v
  Telnyx WhatsApp API
        |
        v
  POST /webhooks/whatsapp
        |
        v
  +------------------+
  | Message Router   |  -- text, interactive, audio
  +--------+---------+
           |
     +-----+------+
     |            |
   text/       audio
  interactive    |
     |           v
     |     Telnyx Audio
     |     Transcription API
     |           |
     +-----+-----+
           |
           v
  +------------------+
  | AI Inference     |  -- tool-calling loop (up to 10 turns)
  | 12 tools:        |
  |  browse_products |
  |  add_to_cart     |
  |  view_cart       |
  |  update_cart     |
  |  get_delivery_   |
  |    slots         |
  |  place_order     |
  |  track_delivery  |
  |  reschedule_     |
  |    delivery      |
  |  handle_         |
  |    substitution  |
  |  reorder         |
  |  register_       |
  |    customer      |
  |  send_whatsapp   |
  +--------+---------+
           |
     +-----+------+
     |            |
  tool calls   send_whatsapp
     |            |
     v            v
  SQLite DB    Telnyx WhatsApp API
  (orders,       |
   cart,          v
   products)   Customer
           |
           v
  SSE /stream --> Operator Dashboard
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEYyour-main-api-key-here` | **yes** | Telnyx API v2 key (AI Inference, Number Lookup) | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_WHATSAPP_API_KEY` | `string` | `KEYyour-whatsapp-api-key-here` | **yes** | Telnyx API key with WhatsApp Business Account access | [Portal](https://portal.telnyx.com/api-keys) |
| `WHATSAPP_NUMBER` | `string` | `+1XXXXXXXXXX` | **yes** | Your WhatsApp Business number in E.164 format | [Portal](https://portal.telnyx.com) → WhatsApp |
| `WHATSAPP_MESSAGING_PROFILE_ID` | `string` | `your-messaging-profile-id-here` | **yes** | Messaging profile ID linked to your WABA | [Portal](https://portal.telnyx.com) → Messaging |
| `AI_MODEL` | `string` | `zai-org/GLM-5.3-Flash` | no | Telnyx AI Inference model name | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `3000` | no | HTTP server port | - |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US --features sms
> telnyx number-orders create --phone-number +15551234567
> telnyx messaging-profiles create --name "FreshCart WhatsApp"
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/whatsapp-grocery-delivery-nodejs
cp .env.example .env    # <- fill in your credentials
npm install
node server.js          # starts on http://localhost:3000
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
telnyx messaging-profiles create --name "FreshCart WhatsApp"
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 3000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Webhook URL → `https://<id>.ngrok.io/webhooks/whatsapp`

## API Reference

The full typed reference lives in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-grocery-delivery-nodejs/API.md). Summary:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/whatsapp` | Inbound WhatsApp webhook |
| `GET` | `/health` | Health check |
| `GET` | `/api/config` | Dashboard config |
| `GET` | `/api/categories` | Product categories |
| `GET` | `/api/products` | Product search |
| `GET` | `/api/orders` | List orders |
| `GET` | `/api/orders/:id` | Single order |
| `POST` | `/api/orders/:id/advance` | Advance order status |
| `GET` | `/api/substitutions` | List substitutions |
| `GET` | `/api/delivery-slots` | Delivery slots |
| `GET` | `/api/cart/:phone` | Cart for customer |
| `GET` | `/api/ui-events` | UI events |
| `POST` | `/api/customers` | Register customer |
| `GET` | `/api/customers/:phone` | Get customer |
| `GET` | `/api/conversations` | Conversation history |
| `DELETE` | `/api/conversations` | Clear conversations |
| `GET` | `/stream` | SSE event stream |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` on WhatsApp send | Invalid or missing API key | Verify `TELNYX_WHATSAPP_API_KEY` in `.env` matches your WABA-enabled key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose with ngrok (`ngrok http 3000`) and set the webhook URL on your Messaging Profile |
| AI response slow or times out | Large conversation history or model load | The first request may be slower; subsequent requests are faster. Check `AI_MODEL` is valid |
| Two API keys required | WhatsApp needs WABA-enabled key; Inference uses main key | Set both `TELNYX_API_KEY` (main) and `TELNYX_WHATSAPP_API_KEY` (WABA) in `.env` |
| Voice note not transcribed | Audio URL from untrusted domain | Only Telnyx-hosted media URLs are accepted (SSRF prevention) |
| Wrong API key at runtime | Shell env overrides `.env` values | The app manually parses `.env` with override — verify with startup log showing first 12 chars of each key |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [WhatsApp Restaurant Reservation (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-restaurant-reservation-nodejs/README.md)
- [WhatsApp Order Tracking Notifications (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-order-tracking-notifications-python/README.md)
- [WhatsApp SMS Bridge (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-sms-bridge-python/README.md)
- [AI Assistant Multi Tool (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md)
- [Two-Way SMS Chat (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-nodejs/README.md)

## Resources

- [WhatsApp Business API Guide](https://developers.telnyx.com/docs/messaging/whatsapp)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Number Lookup API Reference](https://developers.telnyx.com/api/number-lookup/number-lookup)
- [Audio Transcription API Reference](https://developers.telnyx.com/api/inference/audio-transcriptions)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [WhatsApp Business Product Page](https://telnyx.com/products/whatsapp-api)
- [SMS API Product Page](https://telnyx.com/products/sms-api)
- [AI Inference Pricing](https://telnyx.com/pricing/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
