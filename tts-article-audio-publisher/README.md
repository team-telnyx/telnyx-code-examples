---
name: tts-article-audio-publisher
title: "TTS Article Audio Publisher"
description: "Publish article text as audio via Telnyx Text-to-Speech over SIP calls."
language: python
framework: flask
telnyx_products: [Voice, Text-to-Speech, Call Control, Webhooks]
---

# TTS Article Audio Publisher

Publish article text as audio via Telnyx Text-to-Speech over SIP calls.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** that gives developers programmable access to global voice, messaging, and real-time communications. This sample leverages Telnyx's Text-to-Speech (TTS) capabilities to convert written article content into spoken audio delivered over a SIP call, enabling automated audio publishing workflows without managing telephony infrastructure.

## Telnyx API Endpoints Used

| Telnyx Product | SDK Method | Purpose |
|----------------|------------|---------|
| Voice / Calls | `telnyx.Calls.create()` | Initiates an outbound SIP call with TTS text payload |
| Text-to-Speech | `voice` and `language` params on `Calls.create()` | Configures the TTS voice and language for the article audio |
| Webhooks | `telnyx.Webhooks.unwrap()` | Verifies Ed25519 signature on inbound webhook events |
| Call Control | `call.started`, `call.answered`, `call.completed` events | Tracks call lifecycle via webhook events |

## Architecture

```
+-------------------+        POST /publish        +-----------------------+
|   Client / App    |  -------------------------> |   Flask App (app.py)  |
|  (article text)   |                             |                       |
+-------------------+                             |  1. Parse article_text|
                                                  |  2. Check DEMO_MODE   |
                                                  |  3. If demo: log only |
                                                  |  4. If live:          |
                                                  |     telnyx.Calls.create|
                                                  |     (TTS voice+lang)  |
                                                  +-----------+-----------+
                                                              |
                                                              | Outbound SIP Call
                                                              v
                                                  +-----------------------+
                                                  |   Telnyx Voice API    |
                                                  |   (TTS + SIP Call)    |
                                                  +-----------+-----------+
                                                              |
                                                              | Webhook Events
                                                              v
                                                  +-----------------------+
                                                  |   POST /webhook       |
                                                  |   (Ed25519 verify)    |
                                                  |   - call.started      |
                                                  |   - call.answered     |
                                                  |   - call.completed    |
                                                  +-----------------------+
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PHONE_NUMBER` | `string` | `your_telnyx_phone_number_here` | **yes** | TELNYX_PHONE_NUMBER | — |
| `TELNYX_WEBHOOK_URL` | `string` | `your_telnyx_webhook_url_here` | **yes** | TELNYX_WEBHOOK_URL | — |
| `TTS_LANGUAGE` | `string` | `your_tts_language_here` | **yes** | TTS_LANGUAGE | — |
| `TTS_VOICE` | `string` | `your_tts_voice_here` | **yes** | TTS_VOICE | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/tts-article-audio-publisher

# 2. Create a virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your Telnyx API key, phone number, and webhook URL

# 4. Run the application
python app.py
```

The server will start on `http://0.0.0.0:5000` (or the port specified in `PORT`).

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

### `POST /publish`

Accepts an article (text) and publishes it as audio via Telnyx TTS. In demo mode, logs the action without making real API calls.

**Request Body**

```json
{
  "article_text": "This is the article content to be read aloud.",
  "destination_number": "+1555XXXXXXXX"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `article_text` | `string` | yes | The text content of the article to publish as audio. |
| `destination_number` | `string` | no | The destination phone number in E.164 format. Defaults to `TELNYX_PHONE_NUMBER`. |

**Response (Demo Mode)** — `200 OK`

```json
{
  "status": "demo",
  "message": "Article audio published (demo mode)",
  "destination_number": "+1555XXXXXXXX",
  "voice": "male",
  "language": "en-US",
  "article_length": 42
}
```

**Response (Live Mode)** — `200 OK`

```json
{
  "status": "published",
  "call_id": "call_abc123",
  "message": "Article audio published via Telnyx TTS",
  "destination_number": "+1555XXXXXXXX"
}
```

**Error Responses**

| Status | Body | Description |
|--------|------|-------------|
| `400` | `{"error": "article_text is required"}` | Missing `article_text` field. |
| `400` | `{"error": "destination_number is required"}` | Missing `destination_number` and no default configured. |
| `500` | `{"error": "Telnyx API key not configured"}` | `TELNYX_API_KEY` is not set. |
| `500` | `{"error": "An internal error occurred"}` | Unexpected server error. |

### `POST /webhook`

Handles inbound Telnyx webhooks. Verifies the Ed25519 signature and processes the event.

**Headers**

| Header | Required | Description |
|--------|----------|-------------|
| `Telnyx-Signature` | yes | Ed25519 signature of the webhook payload. |
| `Telnyx-Timestamp` | yes | Timestamp of the webhook event. |

**Response** — `200 OK`

```json
{
  "status": "ok"
}
```

**Error Responses**

| Status | Body | Description |
|--------|------|-------------|
| `401` | `{"error": "Invalid signature"}` | Webhook signature verification failed. |
| `500` | `{"error": "Telnyx API key not configured"}` | `TELNYX_API_KEY` is not set. |
| `500` | `{"error": "An internal error occurred"}` | Unexpected server error. |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `400: article_text is required` | Request body missing `article_text` | Ensure the JSON body includes a non-empty `article_text` field. |
| `400: destination_number is required` | No `destination_number` provided and `TELNYX_PHONE_NUMBER` not set | Provide `destination_number` in the request or set `TELNYX_PHONE_NUMBER` in `.env`. |
| `500: Telnyx API key not configured` | `TELNYX_API_KEY` is missing or empty | Set `TELNYX_API_KEY` in your `.env` file. |
| `401: Invalid signature` | Webhook signature verification failed | Ensure `TELNYX_API_KEY` is correct and the webhook is sent from Telnyx. |
| `500: An internal error occurred` | Unexpected error during call creation or webhook processing | Check the application logs for the full exception trace. |
| Demo mode still active in live mode | `DEMO_MODE` set to `true` | Set `DEMO_MODE=false` in `.env` to use live Telnyx API calls. |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](llms.txt)

## Related Examples

- [SMS Sender](https://github.com/team-telnyx/telnyx-code-examples/sms-sender)
- [Voice Call Controller](https://github.com/team-telnyx/telnyx-code-examples/voice-call-controller)
- [Webhook Verifier](https://github.com/team-telnyx/telnyx-code-examples/webhook-verifier)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/python-telnyx)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
