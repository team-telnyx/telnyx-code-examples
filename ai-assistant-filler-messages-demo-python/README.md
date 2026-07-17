---
name: ai-assistant-filler-messages-demo
title: "AI Assistant Filler Messages Demo"
description: "Webhook server with live split-screen dashboard for demoing AI Assistant filler messages during sync tool calls."
language: python
framework: flask
telnyx_products: [AI Assistants]
---

# AI Assistant Filler Messages Demo

Webhook server with live split-screen dashboard for demoing AI Assistant filler messages during sync tool calls. When an AI Assistant calls a sync webhook tool, filler messages let you configure scripted phrases the assistant speaks while waiting for the webhook response — eliminating dead air.

## Telnyx API Endpoints Used

- **AI Assistants**: Sync webhook tool calls — [AI Assistants docs](https://developers.telnyx.com/docs/voice/ai-assistants)
- **Filler Messages**: Configured per-tool in Mission Control — [Release note](https://telnyx.com/release-notes/webhook-tool-filler-messages)

## Architecture

```
  Caller dials AI Assistant
        │
        ▼
  ┌──────────────────────┐
  │ Telnyx AI Assistant   │
  │ (Mission Control)     │
  └────────┬─────────────┘
           │ sync tool call
           ▼
  ┌──────────────────────┐    SSE     ┌──────────────────┐
  │ Flask Webhook Server  │──────────►│ Browser Dashboard  │
  │ POST /webhook/        │           │ Split-screen UI    │
  │   order-status        │           │ (timeline + logs)  │
  └──────────────────────┘           └──────────────────┘
           │
    delays N seconds,
    then returns mock
    order status
```

While the webhook delays, the AI Assistant speaks the configured filler messages on the phone call:
- **0s** — "Let me look that up for you."
- **5s** — "Still working on this, one moment please."
- **15s** — "Almost there, thanks for your patience."

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `WEBHOOK_DELAY_SECONDS` | `integer` | `12` | no | How long the webhook delays before responding | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assistant-filler-messages-demo-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. In [Mission Control](https://portal.telnyx.com), create or edit an AI Assistant:
   - Add a sync webhook tool named `check_order_status` with parameter `order_id` (string)
   - Set the webhook URL to `https://<id>.ngrok.io/webhook/order-status`
   - Under the **Filler Messages** tab, add:
     - `request_start`: "Let me look that up for you."
     - `request_response_delayed` at 5000ms: "Still working on this, one moment please."
     - `request_response_delayed` at 15000ms: "Almost there, thanks for your patience."

3. Open `http://localhost:5000` in a browser to see the live dashboard.

4. Call your AI Assistant's phone number and ask: *"What's the status of my order 12345?"*

## API Reference

### `POST /webhook/order-status`

Receives the sync tool call from the AI Assistant, delays for the configured duration, then returns mock order status.

```bash
curl -X POST http://localhost:5000/webhook/order-status \
  -H "Content-Type: application/json" \
  -d '{"order_id": "12345"}'
```

**Response (after delay):**

```json
{
  "result": {
    "order_id": "12345",
    "status": "shipped",
    "carrier": "FedEx",
    "tracking": "FX-98765",
    "eta": "2026-07-20",
    "items": ["Wireless Headset", "USB-C Cable"]
  }
}
```

### `GET /`

Serves the split-screen dashboard UI.

### `GET /events`

SSE stream of real-time events for the dashboard.

### `GET /health`

Health check.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "delay_seconds": 12,
  "connected_clients": 1
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Dashboard shows "Disconnected" | SSE connection dropped | Refresh the browser page |
| Webhook not triggered | AI Assistant not configured to call your URL | Verify the webhook URL in Mission Control matches your ngrok URL + `/webhook/order-status` |
| No filler messages heard | Filler messages not configured on the tool | Open the tool settings in Mission Control and add filler messages under the Filler Messages tab |
| Order not found response | Using an order ID not in mock data | Use `12345`, `67890`, or `11111` |
| `connection refused` | Flask not running or wrong port | Check `PORT` in `.env` and ensure `python app.py` is running |
| Assistant says it can't find the order | Tool timeout shorter than webhook delay | Set tool `timeout_ms` to at least `30000` in Mission Control or via API |

## Related Examples

- [AI Assistant Phone Setup (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-phone-setup-python/README.md)
- [AI Assistant Multi-Tool (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md)
- [AI Assistant Knowledge Base (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-knowledge-base-python/README.md)
- [AI Voice Agent with Function Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-agent-with-function-calling-python/README.md)
- [Webhook Debugger AI Assistant (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/webhook-debugger-ai-assistant-python/README.md)

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/voice/ai-assistants)
- [Filler Messages Release Note](https://telnyx.com/release-notes/webhook-tool-filler-messages)
- [AI Assistants Product Page](https://telnyx.com/ai-assistants)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
