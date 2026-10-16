---
name: whatsapp-coexistence-sync-monitor
title: "WhatsApp Coexistence Sync Monitor"
description: "Monitor a coexistence-enabled WhatsApp number by verifying lifecycle state via the Telnyx API and logging message.echo webhooks from the WhatsApp Business app."
language: python
framework: flask
telnyx_products: [Messaging, WhatsApp, Webhooks]
---

# WhatsApp Coexistence Sync Monitor

A lightweight Flask service that monitors a coexistence-enabled WhatsApp number, verifying its lifecycle state via the Telnyx API and logging `message.echo` webhooks to keep application state in sync with the manual WhatsApp Business app channel.

## The Story

A regional healthcare clinic relies on WhatsApp to confirm patient appointments and share pre-visit instructions. Their front-desk staff use the WhatsApp Business app directly for sensitive conversations, while automated reminders flow through the clinic's API-driven system. If the two channels drift out of sync, patients could miss critical appointment changes or receive conflicting information, risking their health and the clinic's compliance with care standards.

The actor IS the WhatsApp Coexistence Sync Monitor. It is born when the clinic enables coexistence on their WhatsApp number, allowing both human agents and automated systems to operate on the same line. It grows by learning the number's lifecycle state — confirming the number is active on the Business app and ready for API sends. It survives by verifying every incoming echo webhook's signature, filtering out events that arrive while the number is mid-sync, and logging only legitimate manual messages to an audit trail. It completes its lifecycle when the clinic's automation and human agents operate in perfect harmony, with every manual message mirrored in the system and no double-billing events. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that powers this coexistence monitor. With Telnyx's WhatsApp Business API, you get a single platform to manage both automated messaging and human-agent workflows, complete with webhook signature verification and detailed lifecycle state tracking. Telnyx's infrastructure handles the complexity of WhatsApp Business API integration, so you can focus on building the sync logic that keeps your hybrid channel consistent.

## Telnyx API Endpoints Used

- `GET /v2/whatsapp/business_accounts/{waba_id}/phone_numbers` — List phone numbers in a WhatsApp Business Account to verify coexistence state.
- `GET /v2/whatsapp/phone_numbers/{phone_number}` — Retrieve details for a specific WhatsApp phone number.
- Webhook: `message.echo` — Event triggered when a message is sent from the WhatsApp Business app, containing `origin: 'whatsapp_business_app'`.

## Architecture

The service is built around three core components:

1. **Webhook Receiver** — A Flask route (`/webhooks/whatsapp/echo`) that handles HTTP POST requests and validates the Telnyx Ed25519 signature using the `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
2. **State Checker** — Queries the Telnyx API to verify the number's coexistence status (`is_on_biz_app: true` and `coexistence_state: 'active'`), with a 60-second in-memory TTL cache to avoid hammering the API.
3. **Message Logger** — Appends accepted `message.echo` events to a JSONL file (`echo_log.jsonl`) for audit purposes.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WhatsApp Business App                        │
│                    (Human agent sends message)                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Telnyx Platform                            │
│                                                                     │
│  ┌──────────────────────┐          ┌──────────────────────────────┐  │
│  │  WhatsApp API        │          │  Webhook Delivery           │  │
│  │  (GET phone numbers) │          │  (message.echo event)       │  │
│  └──────────┬───────────┘          └──────────────┬───────────────┘  │
└─────────────┼─────────────────────────────────────┼──────────────────┘
              │                                     │
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WhatsApp Coexistence Monitor                      │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  State Checker   │    │  Webhook         │    │  Message      │  │
│  │  (TTL cache)     │◄──►│  Receiver        │───►│  Logger       │  │
│  │                  │    │  (signature      │    │  (JSONL file) │  │
│  │  is_on_biz_app   │    │  verification)   │    │               │  │
│  │  coexistence_state│   │                  │    │               │  │
│  └──────────────────┘    └──────────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `ECHO_LOG_PATH` | `string` | `your_echo_log_path_here` | **yes** | ECHO_LOG_PATH | — |
| `MAX_TIMESTAMP_SKEW_SECONDS` | `string` | `your_max_timestamp_skew_seconds_here` | **yes** | MAX_TIMESTAMP_SKEW_SECONDS | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `STATE_CHECK_TTL_SECONDS` | `string` | `your_state_check_ttl_seconds_here` | **yes** | STATE_CHECK_TTL_SECONDS | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `WABA_ID` | `string` | `your_waba_id_here` | **yes** | WABA_ID | — |
| `WHATSAPP_NUMBER` | `string` | `your_whatsapp_number_here` | **yes** | WHATSAPP_NUMBER | — |

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/whatsapp-coexistence-sync-monitor
   ```

2. **Create a virtual environment and install dependencies:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Telnyx credentials and WhatsApp number
   ```

4. **Run the service:**
   ```bash
   python app.py
   ```

The service will start on `http://localhost:5000` (or the port specified in `PORT`).

## API Reference

### `POST /webhooks/whatsapp/echo`

Receives `message.echo` webhooks from Telnyx. Verifies the Ed25519 signature and logs the message if the number is in `active` coexistence state.

**Request Headers:**
- `telnyx-signature-ed25519`: Base64-encoded Ed25519 signature
- `telnyx-timestamp`: Unix timestamp of the request

**Request Body:**
```json
{
  "event_type": "message.echo",
  "data": {
    "id": "event-id",
    "origin": "whatsapp_business_app",
    "payload": {
      "from": "+1555XXXXXXXX",
      "to": "+1555XXXXXXXX",
      "text": "Message body",
      "id": "message-id",
      "cost": null
    }
  }
}
```

**Responses:**
- `200 OK`: Signature valid and message logged (or skipped if number not active)
- `400 Bad Request`: Invalid JSON payload
- `401 Unauthorized`: Invalid or missing signature

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `401 Unauthorized` on webhook | Invalid or missing `telnyx-signature-ed25519` header | Verify `TELNYX_PUBLIC_KEY` is set correctly and the webhook is configured with the right signing key |
| `Startup state check failed` | `WABA_ID` or `WHATSAPP_NUMBER` not set, or number not found | Verify your WhatsApp Business Account ID and phone number in the Telnyx Portal |
| `Number not active` warning | The number's `coexistence_state` is not `active` | Check the number's coexistence state in the Telnyx Portal and ensure it's fully onboarded |
| Webhook timestamp skew error | Server clock out of sync or replay attempt | Ensure the server time is accurate; adjust `MAX_TIMESTAMP_SKEW_SECONDS` if needed |
| No messages logged | `DEMO_MODE=true` or webhook not configured | Set `DEMO_MODE=false` for live mode; verify webhook URL is publicly accessible |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **WhatsApp Business API Quickstart** — Get started with the WhatsApp Business API.
- **Webhook Signature Verification** — Learn how to verify Telnyx webhook signatures.
- **Message Echo Monitoring** — Monitor message delivery and echo events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api-reference)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx WhatsApp Coexistence Product Page](https://telnyx.com/whatsapp)
- [Telnyx Pricing](https://telnyx.com/pricing)
