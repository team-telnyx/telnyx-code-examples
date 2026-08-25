---
name: webhook-aggregator-fanout
title: "Webhook Aggregator with Fanout"
description: "Aggregate, deduplicate, and fan out Telnyx webhooks to multiple action queues (call and SMS) with SQLite event logging."
language: python
framework: flask
telnyx_products: [Call Control, SMS/Messaging, Webhooks]
---

# Webhook Aggregator with Fanout

Aggregate, deduplicate, and fan out Telnyx webhooks to multiple action queues (call and SMS) with SQLite event logging.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build intelligent, event-driven communication applications. This sample demonstrates how to build a robust webhook processing pipeline that handles the complexities of real-world telephony and messaging events — deduplication, persistence, and routing — so you can focus on building the AI-powered logic that responds to your users. Telnyx's programmable APIs and reliable webhook delivery make it the ideal foundation for AI-driven communication workflows.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhooks` | `POST` | Receives Telnyx webhook events, verifies the Ed25519 signature, deduplicates, logs, and fans out to action queues |
| `/health` | `GET` | Health check endpoint that reports service status and current queue sizes |
| `/events` | `GET` | Retrieves the last 100 logged webhook events from the SQLite database |
| `/queues` | `GET` | Returns current queue status and the last 10 items in each action queue |

## Architecture

The webhook aggregator follows a pipeline pattern: receive → verify → deduplicate → log → fanout → process.

```
                    ┌─────────────────────────────────────────────────────┐
                    │                    Telnyx Platform                  │
                    │  (Call Events, SMS Events, Webhook Delivery)        │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                                           │ HTTPS POST (Ed25519 signed)
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │              Flask Webhook Handler                  │
                    │  POST /webhooks                                     │
                    │  • Verify Ed25519 signature (telnyx.webhooks.unwrap)│
                    │  • Extract event_type and payload                   │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                    ┌──────────────────────▼──────────────────────────────┐
                    │           Deduplication Layer (KV Store)            │
                    │  • Generate event ID (from payload hash or event ID)│
                    │  • Check TTL-based in-memory store (300s default)   │
                    │  • Return 200 "duplicate" if already seen           │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │              Event Logging (SQLite)                 │
                    │  • Insert event_id, event_type, payload, timestamps │
                    │  • Persistent storage for audit and debugging       │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────────┐
                    │              Fanout to Action Queues                │
                    │  • "call" events → call queue                       │
                    │  • "message"/"sms" events → sms queue               │
                    └──────────────────────┬──────────────────────────────┘
                                           │
                    ┌──────────────────────▼──────────────────────────────┐
                    │              Queue Processing (Worker)              │
                    │  • Call queue → Answer call, play audio greeting    │
                    │  • SMS queue → Send auto-reply message              │
                    └─────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `DEDUP_TTL_SECONDS` | `string` | `your_dedup_ttl_seconds_here` | **yes** | DEDUP_TTL_SECONDS | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/webhook-aggregator-fanout
```

### 2. Configure environment variables

Copy the `.env.example` file to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit the `.env` file with your actual values:

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
DB_PATH=webhook_events.db
DEDUP_TTL_SECONDS=300
PORT=5000
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the application

```bash
python app.py
```

The server will start on `http://localhost:5000` (or the port specified in your `.env` file).

### 5. Configure your Telnyx webhook

1. Log in to your [Telnyx Mission Control Portal](https://portal.telnyx.com)
2. Navigate to **Webhooks** in the left sidebar
3. Create a new webhook or edit an existing one
4. Set the URL to `http://your-server-address:5000/webhooks`
5. Select the event types you want to receive (e.g., `call.answered`, `message.received`)
6. Save your changes

## API Reference

### `POST /webhooks`

Receives Telnyx webhook events. Verifies the Ed25519 signature, deduplicates events, logs to SQLite, and fans out to action queues.

**Request Body:** Raw Telnyx webhook payload (JSON)

**Headers:**
- `X-Telnyx-Signature-Ed25519`: Ed25519 signature for verification
- `X-Telnyx-Timestamp`: Timestamp of the webhook event

**Response:**

| Status Code | Body | Description |
|-------------|------|-------------|
| `200` | `{"status": "success", "event_id": "..."}` | Event processed successfully |
| `200` | `{"status": "duplicate"}` | Duplicate event detected |
| `500` | `{"error": "Internal server error"}` | Processing failed |

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00+00:00",
  "queues": {
    "call": 0,
    "sms": 0
  }
}
```

### `GET /events`

Retrieves the most recent 100 logged events from the SQLite database.

**Response:**
```json
{
  "events": [
    {
      "id": 1,
      "event_id": "abc123...",
      "event_type": "call.answered",
      "payload": {},
      "received_at": "2024-01-01T00:00:00+00:00",
      "processed_at": "2024-01-01T00:00:00+00:00"
    }
  ]
}
```

### `GET /queues`

Returns current queue status and the last 10 items in each queue.

**Response:**
```json
{
  "queues": {
    "call": {
      "size": 0,
      "items": []
    },
    "sms": {
      "size": 0,
      "items": []
    }
  }
}
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| `401 Unauthorized` on webhook | Invalid Telnyx API key | Verify `TELNYX_API_KEY` in `.env` is correct |
| Webhook signature verification fails | Invalid public key or incorrect signature headers | Verify `TELNYX_PUBLIC_KEY` matches your Telnyx account; ensure the webhook is configured with the correct signing key |
| Duplicate events not being filtered | `DEDUP_TTL_SECONDS` is too low | Increase the TTL value in `.env` |
| SQLite database errors | `DB_PATH` is not writable | Ensure the application has write permissions for the database file |
| No events appearing in `/events` | Webhook not configured or events not being sent | Check Telnyx Dashboard webhook settings and verify the endpoint URL is publicly accessible |
| Call actions not executing | Missing `call_control_id` in payload | Verify the webhook event type includes call control data |
| SMS auto-reply not sending | Invalid `from`/`to` numbers | Verify the phone numbers are in E.164 format and have SMS capabilities |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Sign up for a Telnyx account and get started with the platform
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai) — Explore AI-powered communication examples and resources
- [Telnyx llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for AI agents

## Related Examples

- [webhook-signature-verification](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-signature-verification) — Verify Telnyx webhook signatures
- [call-control-basics](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-basics) — Basic call control operations
- [sms-messaging-basics](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-messaging-basics) — Send and receive SMS messages
- [webhook-to-database](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-to-database) — Store webhook events in a database

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com) — Comprehensive documentation for all Telnyx APIs
- [Telnyx API Reference](https://developers.telnyx.com/api) — Detailed API endpoint reference
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python) — Official Python SDK for Telnyx
- [Telnyx Product Page](https://telnyx.com) — Explore Telnyx products and services
- [Telnyx Pricing](https://telnyx.com/pricing) — Transparent pricing for all Telnyx services
