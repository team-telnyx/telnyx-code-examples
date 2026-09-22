---
name: omnichannel-ai-agent
title: "Omnichannel AI Agent"
description: "One AI agent that proactively emails, texts, and calls customers using Claude tool-calling, Telnyx Email/SMS/Voice APIs, and SQLite for persistent cross-channel context."
language: python
framework: flask
telnyx_products: [Email, Messaging, Voice, Call Control]
channel: [email, sms, voice]
---

# Omnichannel AI Agent — one AI agent across email, SMS, and voice

One AI agent that proactively emails, texts, and calls customers. Claude API decides which channel to use via tool-calling. Telnyx handles Email, SMS, and Voice delivery. SQLite stores persistent cross-channel conversation context.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — email, messaging, voice, and AI on one private, global network. This sample uses three Telnyx APIs (Email, Messaging, Call Control) from a single API key, demonstrating unified omnichannel communication.

## Telnyx API Endpoints Used

- **Send Email**: `POST /v2/email_messages` — [API reference](https://developers.telnyx.com/api/email/send-email)
- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Speak**: `POST /v2/calls/{call_control_id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Hangup**: `POST /v2/calls/{call_control_id}/actions/hangup` — [API reference](https://developers.telnyx.com/api/call-control/hangup)

## Telnyx Webhook Events

This app handles these webhook events:

- `call.answered` — Call connected, app speaks the AI-generated message
- `call.speak.ended` — TTS playback finished, app hangs up
- `call.hangup` — Call ended
- `message.received` — Inbound SMS reply from customer
- `email.received` — Inbound email reply from customer

## Architecture

```
                    Claude API (AI Brain)
                         │
                    Tool-calling decides
                    which channel to use
                         │
                    ┌────┴────┐
                    │ Flask   │
                    │ app.py  │
                    │         │
              ┌─────┤ Context ├─────┐
              │     │ (SQLite)│     │
              │     └────┬────┘     │
              │          │          │
         Email API   Messaging  Call Control
        POST /v2/    POST /v2/   POST /v2/
     email_messages  messages     calls
              │          │          │
              ▼          ▼          ▼
           Customer   Customer   Customer
           inbox      phone      phone
```

The AI agent receives a customer scenario, retrieves the full cross-channel conversation history from SQLite, and uses Claude's tool-calling to decide the next action. Claude chooses email for formal acknowledgments, SMS for quick updates, and voice for complex resolution — each message references previous interactions across channels.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `ANTHROPIC_API_KEY` | `string` | `sk-ant-api03-...` | **yes** | Claude API key | [Anthropic Console](https://console.anthropic.com) |
| `TELNYX_FROM_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx phone number (SMS + Voice) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_EMAIL_FROM` | `string` | `agent@yourdomain.com` | **yes** | Verified sender email | [Portal](https://portal.telnyx.com/email) |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |
| `DB_PATH` | `string` | `conversations.db` | no | SQLite database path | — |

## Setup

### Option A — Demo mode (no credentials needed)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omnichannel-ai-agent-python

pip install -r requirements.txt

python demo/demo_server.py
```

The demo walks through a billing dispute scenario: the agent sends an email, follows up via SMS, then calls the customer — all with shared context. No Telnyx or Claude credentials required.

### Option B — Production mode (with credentials)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omnichannel-ai-agent-python

cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

Trigger the agent:

```bash
curl -X POST http://localhost:5000/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "customer": {
      "id": "cust_001",
      "name": "Sarah Chen",
      "email": "sarah@example.com",
      "phone": "+15551234567"
    },
    "scenario": "Customer is disputing a $147.50 charge on their September statement."
  }'
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms,voice
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`
   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/messaging`
   - **Email** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/email`

## API Reference

### `POST /agent/run`

Trigger the AI agent for a customer scenario.

```bash
curl -X POST http://localhost:5000/agent/run \
  -H "Content-Type: application/json" \
  -d '{"customer": {"id": "cust_001", "name": "Jane", "email": "jane@example.com", "phone": "+15551234567"}, "scenario": "Billing dispute"}'
```

**Response:**

```json
{
  "status": "completed",
  "actions": [
    {"type": "tool_call", "tool": "send_email", "input": {"subject": "...", "body": "..."}, "result": "Email sent..."},
    {"type": "tool_call", "tool": "send_sms", "input": {"text": "..."}, "result": "SMS sent..."},
    {"type": "tool_call", "tool": "make_call", "input": {"speak_text": "..."}, "result": "Call initiated..."}
  ]
}
```

### `GET /conversations`

View all cross-channel conversation history, grouped by customer.

```bash
curl http://localhost:5000/conversations
```

### `GET /health`

Health check endpoint.

```bash
curl http://localhost:5000/health
```

## Webhook Endpoints

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.speak.ended`, `call.hangup`

### `POST /webhooks/messaging`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events.

**Events handled:** `message.received`

### `POST /webhooks/email`

Receives Telnyx Email webhook events.

**Events handled:** `email.received`

## Testing

```bash
python -m pytest smoke_test.py -v
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Email not sending | Sender not verified | Verify your email domain in the [Telnyx Email Portal](https://portal.telnyx.com/email) |
| Call not connecting | Invalid CONNECTION_ID | Verify your Call Control Application in the [Portal](https://portal.telnyx.com/call-control/applications) |
| Claude API error | Invalid ANTHROPIC_API_KEY | Verify your key at [console.anthropic.com](https://console.anthropic.com) |
| Webhook not received | Server not publicly reachable | Expose with ngrok and set webhook URLs in Portal |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)

## Related Examples

- [Omnichannel AI Receptionist (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/omnichannel-ai-receptionist-python)
- [AI Email Agent (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-email-agent-python)
- [AI Voice Agent with Function Calling (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-voice-agent-with-function-calling-python)

## Resources

- [Telnyx Email API Guide](https://developers.telnyx.com/docs/email)
- [Telnyx Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Claude API Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
