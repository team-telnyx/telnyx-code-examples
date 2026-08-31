---
name: sprint-2-agent-sdk-quickstart
title: "Telnyx Agent SDK Quickstart — SMS Issue Triage Bot"
description: "A Flask app demonstrating the Telnyx Agent SDK 0.12.2 with an SMS-based issue triage workflow using webhooks and the Messaging API."
language: python
framework: flask
telnyx_products: [Messaging, Webhooks, Agent SDK]
---

# Telnyx Agent SDK Quickstart — SMS Issue Triage Bot

A runnable Flask application that demonstrates the Telnyx Agent SDK 0.12.2 by powering an SMS-based issue triage workflow. Users text a Telnyx number, describe an issue, set a priority, and the bot logs the conversation — all driven by Telnyx Messaging webhooks.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build intelligent, event-driven communication workflows. This sample shows how the Agent SDK 0.12.2 integrates with Telnyx Messaging to handle real-time SMS conversations, verify webhook signatures, and manage multi-step state — without managing carrier connections or SMS gateways yourself.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhooks/sms` | `POST` | Receives inbound SMS webhooks from Telnyx (event type `message.received`) |
| `/` | `GET` | Landing page showing active conversation state |
| `/health` | `GET` | Health check for the application |

**Telnyx SDK methods used:**

- `telnyx.webhooks.unwrap()` — verifies the Ed25519 signature on inbound webhooks
- `telnyx.Message.create()` — sends SMS replies via the Telnyx Messaging API

## Architecture

```
                        ┌──────────────────────┐
                        │    Developer's App    │
                        │      (Flask)          │
                        │                      │
┌──────────┐   SMS      │  ┌────────────────┐  │
│  User    │───────────▶│  │  /webhooks/sms │  │
│ (Phone)  │            │  │  (POST)        │  │
└──────────┘            │  └───────┬────────┘  │
     ▲                  │          │           │
     │                  │          ▼           │
     │                  │  ┌────────────────┐  │
     │                  │  │  Signature     │  │
     │                  │  │  Verification  │  │
     │                  │  │  (Ed25519)     │  │
     │                  │  └───────┬────────┘  │
     │                  │          │           │
     │                  │          ▼           │
     │                  │  ┌────────────────┐  │
     │                  │  │  State Machine │  │
     │                  │  │  (in-memory)   │  │
     │                  │  └───────┬────────┘  │
     │                  │          │           │
     │                  │          ▼           │
     │                  │  ┌────────────────┐  │
     │                  │  │  Send SMS      │  │
     │                  │  │  (Message API) │  │
     │                  │  └────────────────┘  │
     │                  └──────────────────────┘
     │                             │
     └─────────────────────────────┘
              SMS reply sent
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |
| `TELNYX_MESSAGING_PROFILE_ID` | `string` | `your_telnyx_messaging_profile_id_here` | **yes** | TELNYX_MESSAGING_PROFILE_ID | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sprint-2-agent-sdk-quickstart
```

### 2. Create your `.env` file

Copy the example file and fill in your Telnyx credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```
PORT=5000
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_FROM_NUMBER=your_telnyx_from_number_here
TELNYX_MESSAGING_PROFILE_ID=your_telnyx_messaging_profile_id_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the app

```bash
python app.py
```

The server starts on `http://localhost:5000`.

### 5. Configure your Telnyx webhook

In the Telnyx Portal, point your Messaging webhook URL to:

```
https://your-public-url/webhooks/sms
```

Use a tool like `ngrok` to expose your local server:

```bash
ngrok http 5000
```

### 6. Test the flow

Send an SMS to your Telnyx number and follow the conversation:

```
User: "I can't send messages through the API"
Bot:  "Got it: 'I can't send messages through the API'
       What priority is this? Reply LOW, MEDIUM, or HIGH."
User: "HIGH"
Bot:   "Issue logged!
       • Issue: I can't send messages through the API
       • Priority: HIGH
       • Conversation ID: +15551234567
       A support agent will follow up shortly."
```

## API Reference

### `POST /webhooks/sms`

Receives inbound SMS webhooks from Telnyx.

**Request body (Telnyx webhook payload):**

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": [{ "phone_number": "+15551234567" }],
      "to": [{ "phone_number": "+15559876543" }],
      "text": "I can't log in"
    }
  }
}
```

**Responses:**

| Status Code | Body | Description |
|-------------|------|-------------|
| `200` | `{"status": "ok"}` | Message processed successfully |
| `200` | `{"status": "ignored"}` | Non-`message.received` event |
| `400` | `{"error": "Invalid JSON"}` | Malformed request body |
| `401` | `{"error": "Invalid signature"}` | Webhook signature verification failed |
| `500` | `{"error": "Internal error"}` | Error processing the message |

### `GET /`

Returns an HTML page showing active conversations and their state.

### `GET /health`

Returns `{"status": "ok"}` with HTTP 200.

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `TELNYX_API_KEY is not set` warning | Missing API key in `.env` | Add your Telnyx API key to `.env` |
| `TELNYX_PUBLIC_KEY is not set` error | Missing public key for webhook verification | Add your Telnyx public key to `.env` |
| Webhook returns 401 | Invalid or missing signature | Verify `TELNYX_PUBLIC_KEY` is correct and matches the key used to sign webhooks |
| `Failed to send SMS reply` | Invalid `TELNYX_FROM_NUMBER` or `TELNYX_MESSAGING_PROFILE_ID` | Confirm these values in the Telnyx Portal |
| No webhooks received | Webhook URL not configured or not publicly reachable | Use `ngrok` and configure the URL in the Telnyx Portal |
| App won't start | Port already in use | Change `PORT` in `.env` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Telnyx SMS Quickstart](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-quickstart)
- [Telnyx Webhook Signature Verification](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-signature-verification)
- [Telnyx Call Control Quickstart](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-quickstart)

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Page](https://telnyx.com/products)
- [Telnyx Pricing](https://telnyx.com/pricing)
