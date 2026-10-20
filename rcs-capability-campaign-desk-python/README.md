---
name: rcs-capability-campaign-desk
title: "RCS Capability Campaign Desk"
description: "Adaptive RCS/SMS campaign sender with capability detection, AI content generation, and a dark-theme dashboard."
language: python
framework: flask
telnyx_products: [RCS Messaging, SMS/MMS, AI Inference, Number Lookup]
channel: [rcs, sms]
---

# RCS Capability Campaign Desk

Adaptive RCS/SMS campaign sender with a dark-theme web dashboard. Checks device capabilities via Number Lookup and RCS Capabilities API, generates AI-powered rich card content via Telnyx Inference, and sends the optimal format (rich card, plain RCS, or SMS fallback) based on a decision ladder.

## Telnyx API Endpoints Used

- **Number Lookup**: `GET /v2/number_lookup/{phone}` - [API reference](https://developers.telnyx.com/api/number-lookup/number-lookup)
- **RCS Capabilities**: `GET /v2/messaging/rcs/capabilities/{agent_id}/{phone}` - [API reference](https://developers.telnyx.com/api/messaging/rcs-capabilities)
- **Send Message**: `POST /v2/messages` - [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **RCS Deeplinks**: `GET /v2/messages/rcs_deeplinks/{agent_id}` - [API reference](https://developers.telnyx.com/api/messaging/rcs-deeplinks)
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  User enters phone number
        │
        ▼
  ┌──────────────────┐     ┌──────────────────┐
  │ Number Lookup    │────▶│ RCS Capabilities  │
  │ GET /v2/number_  │     │ GET /v2/messaging │
  │   lookup/{phone} │     │   /rcs/capabilit… │
  └────────┬─────────┘     └────────┬─────────┘
           │                        │
           └──────────┬─────────────┘
                      ▼
              ┌───────────────┐
              │ Decision      │
              │ Ladder        │
              │               │
              │ • Landline?   │──▶ SMS only
              │ • Rich card?  │──▶ Rich card + SMS fallback
              │ • Basic RCS?  │──▶ Plain RCS + SMS fallback
              │ • No RCS?     │──▶ SMS only
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │ Send via      │
              │ POST /v2/     │
              │   messages    │
              └───────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `RCS_AGENT_ID` | `string` | `your_rcs_agent_id` | **yes** | RCS Business Messaging agent ID | [Portal](https://portal.telnyx.com/messaging/rcs) |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-b3c0-4ac3-8740-9c3c5a0a0e0c` | **yes** | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) · [CLI: `telnyx messaging-profiles`](https://developers.telnyx.com/development/cli) |
| `BOT_NUMBER` | `string` | `+15551234567` | **yes** | Your Telnyx phone number | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Telnyx AI Inference model | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5050` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/rcs-capability-campaign-desk-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5050
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
telnyx messaging-profiles create --name rcs-campaign-desk
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

## API Reference

See [API.md](API.md) for the full endpoint reference.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/health` | GET | Health check |
| `/api/check-capability` | POST | Number Lookup + RCS capability check |
| `/api/generate-content` | POST | AI-generated rich card content |
| `/api/send` | POST | Adaptive send with decision ladder |
| `/api/generate-deeplink` | POST | RCS deeplink URL generation |

## How It Works

The dashboard has three tabs:

### Tab 1: Capability Check

Enter a phone number. The app calls Number Lookup to identify the carrier and line type, then queries the RCS Capabilities API to discover which RCS features the device supports. Results are color-coded: green (full RCS), yellow (basic RCS), red (no RCS).

### Tab 2: Adaptive Send

Describe your campaign in natural language. Telnyx AI Inference generates a rich card (title, description, button) and SMS fallback text. Preview both formats, enter a recipient number, and send. The decision ladder automatically picks the best format based on the recipient's capabilities.

### Tab 3: Deeplink & QR

Enter a message body to generate an RCS deeplink URL. The dashboard renders a QR code (client-side via qrcode.js) that recipients can scan to open an RCS conversation pre-filled with your message.

## Edge Compute

In production, the capability-check and decision-ladder logic can run on [Telnyx Edge Compute](https://developers.telnyx.com/docs/edge-compute) for sub-10ms latency at the carrier edge. Deploy the `decide_format()` function as a stateless edge function to minimize round-trip time for real-time campaign sends.

## Tests

```bash
python smoke_test.py
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| RCS capability check returns empty | Agent not registered or phone not RCS-enabled | Verify `RCS_AGENT_ID` in the [Portal](https://portal.telnyx.com/messaging/rcs) |
| AI generation returns 502 | Inference timeout or model unavailable | Try a different `AI_MODEL` from the [models list](https://developers.telnyx.com/docs/inference/models) |
| QR code not rendering | CDN blocked or JS disabled | Check browser console; qrcode.js loads from `cdn.jsdelivr.net` |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the [API Reference](API.md) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx messaging-profiles create --name rcs-campaign-desk
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Related Examples

- [RCS Rich Card Product Catalog (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/rcs-rich-card-product-catalog-python/README.md)
- [Abandoned Cart Recovery (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/abandoned-cart-recovery-python/README.md)
- [AI Appointment Booking SMS Flow (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-booking-sms-flow-python/README.md)
- [Email WhatsApp Support (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-whatsapp-support-python/README.md)
- [Send SMS Python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md)

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

- [RCS Messaging Guide](https://developers.telnyx.com/docs/messaging/rcs)
- [Number Lookup Guide](https://developers.telnyx.com/docs/number-lookup)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Messaging API Reference](https://developers.telnyx.com/api/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network. RCS campaign delivery benefits from Telnyx's carrier-grade network: direct carrier connections minimize latency, Number Lookup provides real-time line-type intelligence, and the RCS Capabilities API enables precise format targeting — all without third-party intermediaries.
