---
name: ai-call-campaign-orchestrator
title: "AI Call Campaign Orchestrator"
description: "Durable outbound call campaign with rate limiting, SQL tracking, and SMS summary using Telnyx Agent SDK, Call Control, and SMS."
language: python
framework: flask
telnyx_products: [Call Control, SMS, Agent SDK]
---

# AI Call Campaign Orchestrator

Durable outbound call campaign with rate limiting, SQL tracking, and SMS summary.

## Why Telnyx

This sample demonstrates how to build a durable, production-grade outbound call campaign using Telnyx's **AI Communications Infrastructure**. Telnyx provides the primitives you need to orchestrate complex communication workflows — queueing outbound calls, rate-limiting them with the Agent SDK, controlling each call with Call Control, and delivering results via SMS — all in one platform. Instead of stitching together multiple vendors, Telnyx gives you a single API surface for voice, messaging, and stateful workflow orchestration.

## Telnyx API Endpoints Used

| API | Method | Purpose |
|-----|--------|---------|
| `telnyx.Call.create()` | POST | Create an outbound Call Control call |
| `telnyx.Message.create()` | POST | Send SMS campaign summary |
| `telnyx.webhooks.unwrap()` | — | Verify inbound webhook signature (Ed25519) |
| `POST /webhooks/call` | Webhook | Receive Call Control events (answer, hangup, etc.) |

## Architecture

```
POST /campaign { phone_numbers: [...] }
  → CampaignAgent.onTask()
  → this.queue() all calls
  → this.schedule() rate limiter: 10 calls/min
  → Each call: Call Control answer + LLM + gather + hangup
  → Result saved to SQL: ctx.storage.sql.exec('INSERT INTO results ...')
  → On completion: SMS summary via this.env.TELNYX.messages.send()
```

```
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│  Client         │     │  Flask App (app.py)                          │
│  POST /campaign │ ──▶ │                                              │
└─────────────────┘     │  ┌────────────────────────────────────────┐  │
                        │  │  CampaignAgent                         │  │
                        │  │  ┌─────────────┐                       │  │
                        │  │  │ queue()     │  Enqueue all calls    │  │
                        │  │  └─────────────┘                       │  │
                        │  │  ┌─────────────┐                       │  │
                        │  │  │ schedule()   │  Rate limit 10/min   │  │
                        │  │  └─────────────┘                       │  │
                        │  │  ┌─────────────┐                       │  │
                        │  │  │ make_call()  │  Call Control API    │  │
                        │  │  └─────────────┘                       │  │
                        │  │  ┌─────────────┐                       │  │
                        │  │  │ SQLite       │  Track results       │  │
                        │  │  └─────────────┘                       │  │
                        │  │  ┌─────────────┐                       │  │
                        │  │  │ SMS summary  │  Send completion     │  │
                        │  │  └─────────────┘                       │  │
                        │  └────────────────────────────────────────┘  │
                        └──────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CALL_RATE_LIMIT_PER_MINUTE` | `string` | `30` | **yes** | Max outbound calls per minute to avoid rate limits | Set based on your Telnyx plan limits |
| `PORT` | `string` | `5000` | **yes** | Port the Flask server listens on | Choose any available port |
| `TELNYX_API_KEY` | `string` | `KEY01...` | **yes** | Telnyx API v2 authentication key | [portal.telnyx.com → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `TELNYX_CONNECTION_ID` | `string` | `18001...` | **yes** | Call Control connection for outbound calls | [portal.telnyx.com → Voice → SIP Connections](https://portal.telnyx.com/#/app/connections) |
| `TELNYX_PHONE_NUMBER` | `string` | `+18005550100` | **yes** | E.164 caller ID for outbound calls | [portal.telnyx.com → Numbers](https://portal.telnyx.com/#/app/numbers/my-numbers) |
| `TELNYX_PUBLIC_KEY` | `string` | `abc123...` | **yes** | Ed25519 public key for webhook signature verification | [portal.telnyx.com → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `TELNYX_SMS_FROM` | `string` | `+18005550100` | **yes** | E.164 number for outbound SMS notifications | [portal.telnyx.com → Numbers](https://portal.telnyx.com/#/app/numbers/my-numbers) |
| `TELNYX_SMS_TO` | `string` | `+18005550199` | **yes** | E.164 destination number for campaign status SMS | Your notification recipient number |
| `TELNYX_WEBHOOK_URL` | `string` | `https://your-domain.ngrok.io/webhook` | **yes** | Public URL for Telnyx to send call event webhooks | Your server's public URL (use ngrok for local dev) |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/ai-call-campaign-orchestrator
   ```

2. **Create a virtual environment**

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables**

   Copy the `.env.example` file to `.env` and fill in your Telnyx credentials:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your actual values. Never commit real credentials.

5. **Run the application**

   ```bash
   python app.py
   ```

   The server will start on `http://localhost:5000` (or the port specified in `PORT`).

## API Reference

### `POST /campaign`

Create a new outbound call campaign.

**Request Body:**

```json
{
  "phone_numbers": ["+15551234567", "+15559876543"]
}
```

**Response:**

```json
{
  "campaign_id": "3f2b8c1e-9a4d-4f6b-8e7a-2c5d9f1a3b4c",
  "status": "started"
}
```

**Status Codes:**

- `202 Accepted` — Campaign started successfully
- `400 Bad Request` — Missing or invalid `phone_numbers`

### `GET /campaign/<campaign_id>`

Get the status of a campaign.

**Response:**

```json
{
  "campaign_id": "3f2b8c1e-9a4d-4f6b-8e7a-2c5d9f1a3b4c",
  "total": 2,
  "completed": false,
  "results": [
    {
      "to": "+15551234567",
      "status": "queued",
      "call_control_id": "call_control_id_here"
    }
  ]
}
```

**Status Codes:**

- `200 OK` — Campaign found
- `404 Not Found` — Campaign does not exist

### `POST /webhooks/call`

Receive Call Control webhook events. The request must include a valid Telnyx Ed25519 signature.

**Response:**

```json
{
  "status": "ok"
}
```

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
|-------|--------------|----------|
| `telnyx.exceptions.AuthenticationError` | Invalid `TELNYX_API_KEY` | Verify your API key in the [Telnyx Portal](https://portal.telnyx.com) |
| `telnyx.exceptions.InvalidRequestError` | Invalid `TELNYX_CONNECTION_ID` or phone number | Check your connection ID and phone number format (E.164) |
| Webhook verification fails | Incorrect `TELNYX_PUBLIC_KEY` | Ensure the public key matches your API key's public key |
| SMS summary not sent | `TELNYX_SMS_TO` not set | Set `TELNYX_SMS_TO` to the destination phone number |
| Calls not being placed | `TELNYX_WEBHOOK_URL` not reachable | Ensure the webhook URL is publicly accessible and HTTPS |
| Rate limiting not working | `CALL_RATE_LIMIT_PER_MINUTE` set too high | Adjust the value to control call volume |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [AI Cold Caller Objection Trainer](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-cold-caller-objection-trainer-python/README.md) — AI-powered call training
- [AI Customer Winback Caller](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-winback-caller-python/README.md) — Outbound AI calling patterns
- [AI Live Call Participant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-live-call-participant-python/README.md) — Real-time call AI integration

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
