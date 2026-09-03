---
name: edge-llm-semantic-cache
title: "Edge LLM Semantic Cache with Telnyx Webhooks"
description: "A Flask-based semantic cache for LLM responses with Telnyx SMS webhook integration."
language: python
framework: flask
telnyx_products: [sms, webhooks]
---

# Edge LLM Semantic Cache with Telnyx Webhooks

A Flask application that provides a semantic caching layer for LLM prompts and integrates with Telnyx SMS webhooks to acknowledge incoming messages.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global, low-latency network for programmable messaging, voice, and real-time communications. This sample leverages Telnyx's reliable SMS delivery and webhook verification to build a responsive, production-ready communication layer that pairs with LLM-powered applications.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhook` | `POST` | Receives and verifies incoming Telnyx SMS webhooks (`message.received` events) |
| `telnyx.Message.create` | SDK call | Sends an SMS reply in live mode |
| `telnyx.Webhook.construct_event` | SDK call | Verifies Ed25519 signature on inbound webhooks |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Client / User                         │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTP POST /semantic-cache
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  Flask App (app.py)                          │
│                                                              │
│  ┌──────────────┐    ┌──────────────────────┐               │
│  │ /health      │    │ /semantic-cache      │               │
│  │              │    │                      │               │
│  │ Returns OK   │    │ 1. Check in-memory   │               │
│  │ status       │    │    cache for prompt  │               │
│  └──────────────┘    │ 2. Cache hit? →      │               │
│                      │    return cached     │               │
│  ┌──────────────┐    │ 3. Cache miss? →     │               │
│  │ /webhook     │    │    generate response │               │
│  │              │    │ 4. Store in cache    │               │
│  │ 1. Verify    │    │ 5. Return response   │               │
│  │    Ed25519   │    └──────────────────────┘               │
│  │    signature │                                           │
│  │ 2. Parse     │    ┌──────────────────────┐               │
│  │    event     │    │ In-memory cache      │               │
│  │ 3. Handle    │    │ (dict)               │               │
│  │    message    │    │                      │               │
│  │    .received  │    │ key: prompt (lower)  │               │
│  │ 4. Reply via  │    │ value: response text │               │
│  │    SMS (live) │    └──────────────────────┘               │
│  └──────────────┘                                           │
└──────────────────────────────────────────────────────────────┘
                       │
                       │ telnyx.Message.create (live mode only)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Telnyx SMS Network                        │
└──────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PHONE_NUMBER` | `string` | `your_telnyx_phone_number_here` | **yes** | TELNYX_PHONE_NUMBER | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/edge-llm-semantic-cache
   ```

2. Create a `.env` file from the example:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and fill in your Telnyx credentials:

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
   TELNYX_PHONE_NUMBER=+1555XXXXXXXX
   DEMO_MODE=true
   PORT=5000
   ```

4. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

5. Run the application:

   ```bash
   python app.py
   ```

6. Verify the server is running:

   ```bash
   curl http://localhost:5000/health
   ```

   Expected response:

   ```json
   {"status": "ok", "demo_mode": true}
   ```

## API Reference

### `GET /health`

Returns the health status of the service.

**Response** — `200 OK`

```json
{
  "status": "ok",
  "demo_mode": true
}
```

---

### `POST /semantic-cache`

Accepts a prompt, checks the semantic cache, and returns a cached or generated response.

**Request Body**

```json
{
  "prompt": "What is the capital of France?"
}
```

**Response** — `200 OK`

```json
{
  "response": "[Demo] Response to: What is the capital of France?",
  "cached": false,
  "demo_mode": true
}
```

**Error Responses**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "Missing 'prompt' in request body"}` | Request body does not contain a `prompt` field |
| `500` | `{"error": "Internal server error"}` | Unexpected server error |

---

### `POST /webhook`

Receives and verifies Telnyx webhook events. In demo mode, logs the incoming message; in live mode, sends an SMS reply.

**Headers**

| Header | Description |
|--------|-------------|
| `Telnyx-Signature-Ed25519` | Ed25519 signature for webhook verification |
| `Telnyx-Signature-Timestamp` | Timestamp nonce for signature verification |

**Response** — `200 OK`

```json
{
  "status": "ok"
}
```

**Error Responses**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "Missing signature headers"}` | Required signature headers are missing |
| `403` | `{"error": "Invalid signature"}` | Webhook signature verification failed |
| `500` | `{"error": "Internal server error"}` | Unexpected server error |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `403 Invalid signature` on `/webhook` | Public key mismatch or tampered payload | Verify `TELNYX_PUBLIC_KEY` matches the key in your Telnyx portal |
| `400 Missing signature headers` | Webhook sent without required headers | Ensure Telnyx webhook URL is configured correctly in the Telnyx portal |
| `ImportError: No module named 'telnyx'` | Dependencies not installed | Run `pip install -r requirements.txt` |
| `Connection refused` on `/health` | Server not running | Run `python app.py` and check the console output |
| Cache always misses | Prompt text differs even slightly | The cache uses exact (lowercased, trimmed) string matching — ensure consistent prompt formatting |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [sms-forwarding-bot](../sms-forwarding-bot) — A Flask app that forwards incoming SMS messages to a webhook.
- [voice-call-control](../voice-call-control) — A Flask app demonstrating Telnyx Call Control API.
- [mms-media-handler](../mms-media-handler) — A Flask app that receives and processes MMS media attachments.

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx SMS Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
