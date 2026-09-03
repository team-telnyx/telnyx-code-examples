# Guide: TTS Article Audio Publisher

This guide walks you through the `tts-article-audio-publisher` Flask sample — a small web service that accepts an article (plain text) and publishes it as audio by placing a Telnyx voice call with Text-to-Speech (TTS). The sample includes a **safe demo mode** (no real calls or charges) and a **live mode** that uses real Telnyx API parameters.

---

## Prerequisites

Before running the sample, ensure you have:

1. **Python 3.8+** installed on your machine.
2. A **Telnyx account** — sign up at [telnyx.com](https://telnyx.com).
3. A **Telnyx API key** — create one in the [Telnyx Portal](https://portal.telnyx.com/).
4. A **Telnyx phone number** (E.164 format, e.g. `+15551234567`) — purchase one in the Portal.
5. (Optional, for live mode) A **publicly reachable HTTPS URL** for Telnyx webhooks — use a tool like [ngrok](https://ngrok.com/) during local development.

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/tts-article-audio-publisher
```

### 2. Create a virtual environment and install dependencies

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and set the following variables:

| Variable | Description | Example |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key | `your_telnyx_api_key_here` |
| `TELNYX_PHONE_NUMBER` | Your Telnyx phone number (E.164) | `+1555XXXXXXXX` |
| `TTS_VOICE` | Voice for TTS (`male` or `female`) | `male` |
| `TTS_LANGUAGE` | Language/locale for TTS | `en-US` |
| `TELNYX_WEBHOOK_URL` | Public HTTPS URL for webhooks (live mode) | `https://your-ngrok-url.ngrok.io/webhook` |
| `DEMO_MODE` | Set to `true` for demo mode, `false` for live | `true` |
| `PORT` | Port for the Flask server | `5000` |

> **Security note:** `.env` is listed in `.gitignore` and should never be committed. The `.env.example` file contains only placeholder values.

---

## Running the Application

### Demo Mode (default)

By default, `DEMO_MODE=true`. In this mode the app logs what it *would* do without making any real Telnyx API calls — no calls are placed, no charges are incurred.

```bash
python app.py
```

You should see output like:

```
 * Running on http://0.0.0.0:5000
```

### Live Mode

To switch to live mode, set `DEMO_MODE=false` in your `.env` file and ensure `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, and `TELNYX_WEBHOOK_URL` are all set to real values.

```bash
DEMO_MODE=false python app.py
```

> In live mode, the app will place real voice calls via Telnyx and incur charges. Use with caution.

---

## How It Works — Step by Step

### 1. Application Initialization and Configuration

The app begins by loading environment variables via `dotenv` and initializing the Flask application. It reads configuration for the Telnyx API key, phone number, TTS voice/language, and demo mode flag.

The Telnyx SDK client (`telnyx.Core`) is instantiated only if an API key is present. This client is used for both placing calls and verifying webhook signatures.

### 2. Health Check Endpoint (`/health`)

A simple `GET /health` endpoint returns a JSON response indicating the service is running and whether demo mode is active. This is useful for container orchestration, load balancers, or local testing.

### 3. Publishing an Article as Audio (`/publish`)

The core endpoint is `POST /publish`. It accepts a JSON body with:

- `article_text` (required) — the text content of the article to be read aloud.
- `destination_number` (optional) — the phone number to call. If omitted, the app uses the configured `TELNYX_PHONE_NUMBER`.

**In demo mode**, the endpoint logs the intended action (destination number, voice, language, article length) and returns a JSON response with a `"status": "demo"` field. No Telnyx API call is made.

**In live mode**, the app uses the Telnyx SDK's `telnyx.Calls.create()` method to place a voice call. The call is configured with:

- `from_` — the Telnyx phone number (caller ID).
- `to` — the destination number.
- `voice` — the TTS voice (`male` or `female`).
- `language` — the TTS language/locale (e.g. `en-US`).
- `text` — the article text that Telnyx will read aloud during the call.
- `webhook_url` — the URL where Telnyx will send call status events.

The response includes the `call_id` returned by Telnyx, which can be used to track the call.

### 4. Webhook Handler (`/webhook`)

Telnyx sends webhook events to the `/webhook` endpoint to notify your application of call lifecycle events (e.g., `call.started`, `call.answered`, `call.completed`, `call.recording.created`).

The handler **verifies the Ed25519 signature** of the incoming webhook using `telnyx.Webhooks.unwrap()`, passing the raw request body, the `Telnyx-Signature` header, and the `Telnyx-Timestamp` header. This ensures the request genuinely came from Telnyx and has not been tampered with.

After verification, the handler extracts the `event_type` and `payload` from the `data` object and logs relevant information for each event type.

### 5. Error Handling

All endpoints use `try/except` blocks with `app.logger.exception(...)` to log full stack traces server-side. HTTP responses return generic error messages (e.g. `"An internal error occurred"`) to avoid leaking sensitive information to clients.

---

## Telnyx Primitives Used

This sample uses the following Telnyx primitives:

| Primitive | How It's Used |
|---|---|
| **Calls API (TTS)** | The `telnyx.Calls.create()` method places a voice call and uses Telnyx's built-in Text-to-Speech to read the article text aloud. The `voice`, `language`, and `text` parameters control the spoken output. |
| **Webhooks (Ed25519 Signature Verification)** | The `telnyx.Webhooks.unwrap()` method verifies the authenticity of inbound webhook events from Telnyx, ensuring they were sent by Telnyx and have not been altered in transit. |

---

## Testing the Endpoints

### Health Check

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{"status": "ok", "demo_mode": true}
```

### Publish an Article (Demo Mode)

```bash
curl -X POST http://localhost:5000/publish \
  -H "Content-Type: application/json" \
  -d '{"article_text": "Hello, this is a test article.", "destination_number": "+1555XXXXXXXX"}'
```

Expected response (demo mode):

```json
{
  "status": "demo",
  "message": "Article audio published (demo mode)",
  "destination_number": "+1555XXXXXXXX",
  "voice": "male",
  "language": "en-US",
  "article_length": 31
}
```

### Publish an Article (Live Mode)

In live mode, the same request will place a real call and return:

```json
{
  "status": "published",
  "call_id": "0ccc9d5c-8d2a-4e3a-9b1a-2f3c4d5e6f7a",
  "message": "Article audio published via Telnyx TTS",
  "destination_number": "+1555XXXXXXXX"
}
```

---

## Smoke Test

A smoke test is included to verify the application loads without errors:

```bash
python smoke_test.py
```

This test imports the Flask app, checks that the `/health` endpoint responds, and verifies that the `/publish` endpoint returns a 400 error when `article_text` is missing.

---

## Next Steps

- **Telnyx Voice & TTS Documentation** — Learn more about [Text-to-Speech with Telnyx Voice](https://developers.telnyx.com/guides/voice/tts).
- **Webhooks Guide** — Understand how to [handle Telnyx webhooks](https://developers.telnyx.com/docs/voice/webhooks).
- **Calls API Reference** — Explore the full [Telnyx Calls API](https://developers.telnyx.com/api/calls).
- **Telnyx Python SDK** — View the [telnyx-python GitHub repository](https://github.com/telnyx/telnyx-python) for SDK usage and examples.
- **Related Examples** — Check out other samples in the [telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples) repository.
