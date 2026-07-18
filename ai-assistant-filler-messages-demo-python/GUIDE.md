# Build a Filler Messages Demo for Telnyx AI Assistants

Demonstrate how AI Assistant filler messages eliminate dead air during sync webhook tool calls. This guide walks through setting up a webhook server with a live dashboard, configuring filler messages in Mission Control, and recording a split-screen demo.

## How It Works

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
  │ (intentional delay)   │           │ (split-screen)     │
  └──────────────────────┘           └──────────────────┘
```

When the AI Assistant invokes the `check_order_status` tool, the webhook server intentionally delays its response. During that delay, the AI Assistant speaks the configured filler messages to the caller. The dashboard shows both sides in real time — the call timeline and the server logs.

## Telnyx Products Used

- **AI Assistants** — Voice AI agent with sync webhook tools and filler messages

## API Endpoints

- **AI Assistants**: Sync webhook tool calls — [Docs](https://developers.telnyx.com/docs/voice/ai-assistants)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [ngrok](https://ngrok.com) or similar tunnel for exposing localhost
- A phone number assigned to an AI Assistant

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assistant-filler-messages-demo-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your credentials:

```
TELNYX_API_KEY=your_telnyx_api_key_here
WEBHOOK_DELAY_SECONDS=12
PORT=5000
```

The `WEBHOOK_DELAY_SECONDS` controls how long the webhook waits before responding. Set it long enough (10–15s) so multiple filler messages trigger.

## Step 2: Understand the Code

Everything lives in `app.py` (~100 lines). Here's what each piece does.

### Webhook Endpoint

**`webhook_order_status()`** — Receives the sync tool call from the AI Assistant, broadcasts SSE events to the dashboard, sleeps for the configured delay, then returns mock order data.

### SSE Streaming

**`events()`** — Server-Sent Events endpoint that pushes real-time updates to the dashboard: tool call received, filler message indicators, countdown ticks, and response sent.

### Dashboard

**`dashboard()`** — Serves the split-screen HTML page that connects to the SSE stream and renders events in two panels.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhook/order-status` | Sync webhook endpoint for AI Assistant tool calls |
| `GET` | `/` | Split-screen dashboard UI |
| `GET` | `/events` | SSE event stream for dashboard |
| `GET` | `/health` | Health check |

## Step 3: Create the AI Assistant

1. Go to [Mission Control](https://portal.telnyx.com) → AI → Assistants
2. Create a new assistant (or edit an existing one)
3. Assign a phone number to the assistant

## Step 4: Add the Webhook Tool

1. In the assistant settings, add a new **sync webhook tool**:
   - **Name**: `check_order_status`
   - **Description**: "Check the status of a customer order by order ID"
   - **Parameters**: `order_id` (string, required)

2. Start ngrok and set the webhook URL:

   ```bash
   ngrok http 5000
   ```

   Copy the HTTPS URL and set the tool's webhook URL to:
   `https://<id>.ngrok.io/webhook/order-status`

## Step 5: Configure Filler Messages

Filler messages **must be configured through the Mission Control UI**. While `setup.py` sets these values via the API, playback on calls only works when the messages are added through the UI's Filler Messages tab.

In the tool settings, open the **Filler Messages** tab and add:

| Type | Content | Timing |
|------|---------|--------|
| `request_start` | "Let me look that up for you." | immediate |
| `request_response_delayed` | "Still working on this, one moment please." | 5000ms |
| `request_response_delayed` | "Almost there, thanks for your patience." | 15000ms |

Also verify the **tool-level timeout** is set to at least **30000ms**. The default (5000ms) is shorter than the webhook delay and will cause the assistant to time out before the webhook responds.

This corresponds to the JSON configuration:

```json
{
  "filler_messages": [
    { "type": "request_start", "content": "Let me look that up for you." },
    { "type": "request_response_delayed", "content": "Still working on this, one moment please.", "timing_ms": 5000 },
    { "type": "request_response_delayed", "content": "Almost there, thanks for your patience.", "timing_ms": 15000 }
  ]
}
```

## Step 6: Run the Demo

1. Start the Flask server:

   ```bash
   python app.py
   ```

2. Open `http://localhost:5000` in a browser — you'll see the split-screen dashboard.

3. Call your AI Assistant's phone number.

4. Ask: *"What's the status of my order 12345?"*

5. Watch:
   - The **dashboard** updates in real time (left: call timeline, right: server logs with countdown)
   - The **phone call** plays filler messages while the webhook delays
   - After the delay, the assistant reads back the order status

## Step 7: Test Without a Phone Call

You can test the webhook endpoint directly:

```bash
curl -X POST http://localhost:5000/webhook/order-status \
  -H "Content-Type: application/json" \
  -d '{"order_id": "12345"}'
```

Open the dashboard in a browser first to see the events stream in real time.

## Step 8: Record the Demo Video

For the demo video, set up a split-screen recording:

1. **Left side**: The browser showing `http://localhost:5000` dashboard
2. **Right side**: Terminal showing `python app.py` server output
3. **Audio**: The phone call audio (use speakerphone or a recording app)

Record the full flow: dial in → ask about an order → filler messages play → webhook responds → assistant delivers the answer.

## Going to Production

This example uses mock data and intentional delays. For production:

- **Real data source** — Replace `MOCK_ORDERS` with actual database or API queries
- **Remove artificial delay** — The delay exists only for demo purposes; real webhooks should respond as fast as possible
- **Webhook verification** — Validate Telnyx webhook signatures
- **Error handling** — Add timeout handling and retry logic
- **Monitoring** — Add structured logging and alerting

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-filler-messages-demo-python/README.md)
- [AI Assistants Guide](https://developers.telnyx.com/docs/voice/ai-assistants)
- [Filler Messages Release Note](https://telnyx.com/release-notes/webhook-tool-filler-messages)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
