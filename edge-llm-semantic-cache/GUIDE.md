# Edge LLM Semantic Cache — Developer Guide

This guide walks you through the `edge-llm-semantic-cache` sample, a Flask application that demonstrates how to build a semantic caching layer for LLM prompts while integrating with Telnyx for inbound SMS messaging via webhooks.

---

## Prerequisites

Before you begin, ensure you have:

- **Python 3.8+** installed on your machine
- A **Telnyx account** (sign up at [telnyx.com](https://telnyx.com))
- A **Telnyx phone number** (required for live SMS mode)
- **Telnyx API Key** and **Public Key** (found in the [Telnyx Portal](https://portal.telnyx.com))
- **`ngrok`** or a similar tunneling tool (for testing webhooks locally)

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-llm-semantic-cache
```

### 2. Create a virtual environment and install dependencies

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy the example environment file and fill in your Telnyx credentials:

```bash
cp .env.example .env
```

Edit `.env` and set the following variables:

| Variable              | Description                                      |
|-----------------------|--------------------------------------------------|
| `TELNYX_API_KEY`      | Your Telnyx API key (starts with `KEY...`)       |
| `TELNYX_PUBLIC_KEY`   | Your Telnyx public key for webhook verification  |
| `TELNYX_PHONE_NUMBER` | Your Telnyx phone number in E.164 format         |
| `DEMO_MODE`           | Set to `true` for demo mode (default), `false` for live mode |
| `PORT`                | Port to run the Flask app on (default: `5000`)   |

> **Note:** In demo mode, no real SMS messages are sent and no real LLM API calls are made. This is safe for local development and testing.

---

## Running the Application

### Start the server

```bash
python app.py
```

The server will start on `http://0.0.0.0:5000` by default.

### Verify the server is running

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{
  "status": "ok",
  "demo_mode": true
}
```

---

## How It Works

The application has three main endpoints:

### 1. Health Check (`/health`)

A simple GET endpoint that confirms the service is running and reports whether demo mode is active.

### 2. Semantic Cache (`/semantic-cache`)

This is the core of the sample. It accepts a POST request with a JSON body containing a `prompt` field:

```json
{
  "prompt": "What is the capital of France?"
}
```

#### Flow:

1. **Cache Lookup**: The app checks an in-memory cache (a Python dictionary) for a previously stored response to the same prompt (case-insensitive, trimmed).
2. **Cache Hit**: If a match is found, the cached response is returned with `"cached": true`.
3. **Cache Miss**: If no match is found:
   - In **demo mode**, a simulated response is generated: `[Demo] Response to: <prompt>`
   - In **live mode**, a placeholder response is generated: `[Live] Response to: <prompt>` (you would replace this with a real LLM API call)
4. **Cache Store**: The prompt/response pair is stored in the cache for future lookups.
5. **Response**: The generated response is returned with `"cached": false`.

> **Important**: The in-memory cache is suitable for demo purposes only. In production, replace it with Redis, SQLite, or a vector database like Pinecone or Weaviate for persistent, scalable semantic caching.

### 3. Webhook Handler (`/webhook`)

This endpoint receives and processes incoming Telnyx webhook events, specifically `message.received` events from SMS messages sent to your Telnyx phone number.

#### Flow:

1. **Signature Verification**: The Ed25519 signature and timestamp headers are extracted from the request and verified using `telnyx.Webhook.construct_event()`. This ensures the request genuinely came from Telnyx.
2. **Event Parsing**: The event type and payload are extracted from the verified webhook data.
3. **Message Handling**: If the event type is `message.received`:
   - The sender's phone number, recipient's phone number, and message text are extracted from `data.payload`.
   - In **demo mode**, the app logs what it would do (send an SMS reply) without actually sending anything.
   - In **live mode**, the app sends a real SMS reply using `telnyx.Message.create()`.

---

## Demo Mode vs. Live Mode

The application supports two modes controlled by the `DEMO_MODE` environment variable:

### Demo Mode (`DEMO_MODE=true`)

- **Default mode** — safe for local development and testing.
- No real SMS messages are sent.
- No real LLM API calls are made.
- Simulated responses are generated and logged.
- The `/health` endpoint reports `"demo_mode": true`.

### Live Mode (`DEMO_MODE=false`)

- Requires valid Telnyx credentials (`TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`).
- Real SMS replies are sent via `telnyx.Message.create()`.
- You would replace the placeholder LLM response logic with a real LLM provider integration (e.g., OpenAI, Anthropic).
- The `/health` endpoint reports `"demo_mode": false`.

To switch to live mode, set `DEMO_MODE=false` in your `.env` file.

---

## Testing the Semantic Cache

### Send a prompt (cache miss)

```bash
curl -X POST http://localhost:5000/semantic-cache \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, world!"}'
```

Response:

```json
{
  "response": "[Demo] Response to: Hello, world!",
  "cached": false,
  "demo_mode": true
}
```

### Send the same prompt again (cache hit)

```bash
curl -X POST http://localhost:5000/semantic-cache \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, world!"}'
```

Response:

```json
{
  "response": "[Demo] Response to: Hello, world!",
  "cached": true,
  "demo_mode": true
}
```

---

## Testing Webhooks Locally

To test the webhook handler locally, use `ngrok` to expose your local server:

```bash
ngrok http 5000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`) and configure it as your webhook URL in the [Telnyx Portal](https://portal.telnyx.com):

```
https://abc123.ngrok.io/webhook
```

Send an SMS to your Telnyx phone number — the webhook will receive the `message.received` event and process it according to the mode (demo or live).

---

## Running the Smoke Test

A smoke test is included to verify the application loads correctly:

```bash
python smoke_test.py
```

Expected output:

```
✓ app.py imports successfully
✓ Flask app object created
✓ /health endpoint responds with 200
✓ /semantic-cache endpoint accepts POST
✓ /webhook endpoint accepts POST
✓ All smoke tests passed!
```

---

## Telnyx Primitives Used

This sample uses the following Telnyx SDK features:

| Primitive         | Usage in this sample                                           |
|-------------------|----------------------------------------------------------------|
| **Telnyx SDK**    | `telnyx.aio.init()` initializes the SDK with your API key      |
| **Webhook Verification** | `telnyx.Webhook.construct_event()` verifies Ed25519 signatures on incoming webhook payloads |
| **SMS (Message)** | `telnyx.Message.create()` sends an SMS reply in live mode      |

---

## Next Steps

- **Replace the in-memory cache** with Redis or a vector database for production use.
- **Integrate a real LLM provider** (OpenAI, Anthropic, etc.) in live mode instead of the placeholder response.
- **Add rate limiting** to protect against abuse of the `/semantic-cache` endpoint.
- **Explore Telnyx Call Control** if you want to extend this to voice-based interactions.
- **Review the [Telnyx API Reference](https://developers.telnyx.com/api)** for full details on available endpoints and parameters.
- **Check out the [Telnyx Python SDK documentation](https://developers.telnyx.com/docs/python)** for more integration examples.
- **Browse other samples** in the [telnyx-code-examples repository](https://github.com/team-telnyx/telnyx-code-examples) for inspiration.
