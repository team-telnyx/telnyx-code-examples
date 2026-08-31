# Telnyx Agent SDK Quickstart — Developer Guide

This guide walks you through the SMS-based issue triage demo built on the Telnyx Agent SDK. By the end, you'll understand how the application works end-to-end, how it uses Telnyx primitives, and how to run it locally.

## What This Demo Does

The demo implements a simple **SMS-based issue triage flow**. A customer sends an SMS to your Telnyx number, and the app walks them through a short conversation:

1. The customer describes an issue.
2. The app asks for a priority (LOW, MEDIUM, or HIGH).
3. The app confirms the logged issue and priority.

All conversation state is tracked in memory, and the app exposes a web dashboard showing active conversations.

---

## Prerequisites

Before you start, make sure you have:

- **Python 3.9+** installed
- **A Telnyx account** with:
  - An API key
  - A Messaging Profile
  - A Telnyx phone number with SMS enabled
  - A public key for webhook signature verification
- **A way to expose your local server to the internet** (e.g., ngrok) so Telnyx can reach your webhook

---

## Environment Setup

1. **Clone the repository** and navigate to the sample folder:

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/sprint-2-agent-sdk-quickstart
   ```

2. **Create a virtual environment**:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**:

   Copy `.env.example` to `.env` and fill in your values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   |----------|-------------|
   | `TELNYX_API_KEY` | Your Telnyx API key |
   | `TELNYX_PUBLIC_KEY` | Your Telnyx public key (for webhook signature verification) |
   | `TELNYX_MESSAGING_PROFILE_ID` | Your Messaging Profile ID |
   | `TELNYX_FROM_NUMBER` | Your Telnyx number (E.164 format, e.g., `+12345678901`) |
   | `PORT` | (Optional) Port for the Flask app. Defaults to `5000` |

5. **Expose your local server**:

   In a separate terminal, run:

   ```bash
   ngrok http 5000
   ```

   Copy the HTTPS forwarding URL (e.g., `https://abc123.ngrok.io`).

6. **Configure the Telnyx webhook**:

   In the Telnyx Portal, set your Messaging webhook URL to:

   ```
   https://your-ngrok-url.ngrok.io/webhooks/sms
   ```

   Make sure the webhook is set to receive `message.received` events.

---

## Running the App

### Local browser demo

For the quickest demo, enable the local simulator:

```bash
DEMO_MODE=true python app.py
```

Open [http://127.0.0.1:5000/demo](http://127.0.0.1:5000/demo), enter `Printer offline`, and then enter `HIGH`. This exercises the same conversation state machine without sending SMS or exposing a webhook publicly. The demo endpoint returns `404` unless `DEMO_MODE=true`.

### Real SMS mode

Start the Flask server:

```bash
python app.py
```

You should see output similar to:

```
 * Running on http://0.0.0.0:5000
```

Open `http://localhost:5000` in your browser to see the dashboard.

---

## How the Code Works

The application is a single Flask app (`app.py`) with three main responsibilities:

### 1. Configuration and Initialization

The app starts by loading environment variables from `.env` and configuring the Telnyx SDK:

- `TELNYX_API_KEY` is set as the SDK's API key.
- The app logs a warning if the API key is missing — this is important because API calls will fail without it.

### 2. In-Memory Conversation State

The demo uses a simple in-memory dictionary (`CONVERSATIONS`) to track each conversation. Each conversation is keyed by the sender's phone number and stores:

- `status`: `awaiting_issue`, `awaiting_priority`, or `done`
- `issue`: The issue description
- `priority`: LOW, MEDIUM, or HIGH
- Timestamps for creation and last update

A threading lock (`CONVERSATIONS_LOCK`) protects the dictionary from race conditions when multiple webhooks arrive concurrently.

### 3. Webhook Handling

The `/webhooks/sms` route is the entry point for inbound SMS messages from Telnyx. It does the following:

#### a. Signature Verification

Before processing anything, the app verifies the Telnyx Ed25519 signature and timestamp using `verify_webhook_signature()`. This ensures the request genuinely came from Telnyx, has not been tampered with, and is not a stale replay. If verification fails, the app returns `401 Unauthorized`.

#### b. Event Type Filtering

The app checks that the event type is `message.received`. Other event types (e.g., `message.sent`) are ignored with a `200 OK` response.

#### c. Conversation State Machine

The `_handle_inbound_sms()` function drives the conversation:

- **New conversation**: The first inbound message becomes the issue description, and the app immediately asks for its priority.
- **Awaiting issue**: When the customer replies with their issue, the app stores it and asks for a priority.
- **Awaiting priority**: The app validates the priority (LOW, MEDIUM, or HIGH). If valid, it marks the conversation as `done` and sends a confirmation. If invalid, it re-prompts.
- **Done**: If the customer sends another message after completion, the app starts a fresh conversation.

#### d. Sending SMS Replies

The `_send_sms()` function uses the Telnyx SDK to send replies:

```python
telnyx_client.messages.send(
    from_=TELNYX_FROM_NUMBER,
    to=to_number,
    text=body,
    messaging_profile_id=TELNYX_MESSAGING_PROFILE_ID,
)
```

This is the core Telnyx primitive — the Messaging API — which handles SMS delivery.

### 4. Dashboard

The `/` route renders a privacy-conscious HTML table showing masked conversation identifiers, status, priority, and timestamps. Issue text and full phone numbers are intentionally omitted because the local server may be exposed through a tunnel.

---

## Telnyx Primitives Used

| Primitive | Where Used | Purpose |
| --- | --- | --- |
| **Messaging API** (`telnyx_client.messages.send`) | `_send_sms()` | Sends SMS replies to customers |
| **Webhooks** | `/webhooks/sms` | Receives inbound SMS events from Telnyx |
| **Ed25519 Signature Verification** | `_validate_webhook_signature()` | Confirms webhook authenticity |
| **Messaging Profile** | `_send_sms()` | Routes messages through your Telnyx Messaging Profile |

---

## Testing the Demo

### Happy Path

1. Send an SMS to your Telnyx number: `"My internet is down"`
2. The app replies: `"Got it: "My internet is down" — What priority is this? Reply LOW, MEDIUM, or HIGH."`
3. Reply: `"HIGH"`
4. The app replies with a confirmation containing the issue, priority, and conversation ID.

### Failure / Edge Case

- Send an invalid priority (e.g., `"URGENT"`). The app replies: `"I didn't catch that. Please reply LOW, MEDIUM, or HIGH."`
- Send a message with no text. The app logs an error and does not send a reply.

---

## Testing

The sample includes a smoke-test script that verifies the app starts and the health endpoint responds:

```bash
python smoke_test.py
```

Expected output:

```
Health check passed: {"status": "ok"}
```

---

## Troubleshooting

| Issue | Likely Cause | Fix |
| --- | --- | --- |
| `TELNYX_API_KEY is not set` warning | Missing env var | Check your `.env` file |
| `401 Invalid signature` on webhook | Wrong public key or malformed request | Verify `TELNYX_PUBLIC_KEY` and that ngrok URL is correct |
| No SMS reply | Messaging Profile or From number misconfigured | Check `TELNYX_MESSAGING_PROFILE_ID` and `TELNYX_FROM_NUMBER` |
| Webhook not received | ngrok not running or URL misconfigured | Restart ngrok and verify the webhook URL in the Telnyx dashboard |

---

## Next Steps

- **Explore the Telnyx Messaging API** — [Messaging API documentation](https://developers.telnyx.com/docs/api/v2/messaging)
- **Learn about webhooks** — [Webhook security and verification](https://developers.telnyx.com/docs/webhooks)
- **Try the Agent SDK** — [Agent SDK documentation](https://developers.telnyx.com/docs/agent-sdk)
- **Extend this demo** — Add a database for durable state, or integrate with a ticketing system like Linear or Jira.

---

## Summary

This demo shows how to build a practical, stateful SMS workflow using the Telnyx Agent SDK and Messaging API. The key takeaways:

- Telnyx handles the SMS infrastructure — you focus on the conversation logic.
- Webhook signature verification is essential for security.
- The in-memory state machine is a simple pattern that can be extended to more complex workflows.

You now have a working reference implementation you can adapt for your own use cases.
