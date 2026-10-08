---
name: omnichannel-context-carrying
title: "Omnichannel Context-Carrying Agent"
description: "AI agent that carries customer context across email, voice, and SMS so customers never repeat themselves. Demonstrates cross-channel identity resolution with Telnyx Inference, Email, Messaging, and Call Control APIs."
language: python
framework: flask
telnyx_products: [Email, Messaging, Voice, Call Control, AI Inference]
channel: [email, sms, voice]
---

# Omnichannel Context-Carrying Agent — customer context follows across channels

AI agent that carries customer context across email, voice, and SMS so customers never repeat themselves. When a customer calls after emailing, the AI greets them with: "I see you contacted us about changing your booking. Are you calling about the same request?"

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — email, messaging, voice, and AI on one private, global network. This sample uses four Telnyx APIs (Email, Messaging, Call Control, AI Inference) from a single API key to demonstrate seamless cross-channel context carrying with customer identity resolution.

## Telnyx API Endpoints Used

- **Send Email**: `POST /v2/emails` — [API reference](https://developers.telnyx.com/api/email/send-email)
- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Speak**: `POST /v2/calls/{call_control_id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Gather Speech**: `POST /v2/calls/{call_control_id}/actions/gather` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/docs/inference/chat-completions)

## Telnyx Webhook Events

This app handles these webhook events:

- `email.received` — Inbound email triggers AI reply flow
- `call.initiated` — Incoming call triggers identity lookup and answer
- `call.answered` — AI generates contextual greeting from cross-channel history
- `call.speak.ended` — TTS playback finished, begins speech gathering
- `call.gather.ended` — Customer speech captured, AI processes with full context
- `call.hangup` — Call ended
- `message.received` — Inbound SMS triggers AI reply with cross-channel context

## Architecture

```
         Customer contacts on any channel
              │         │         │
          Email in   Call in   SMS in
              │         │         │
              ▼         ▼         ▼
        ┌─────────────────────────────┐
        │         Flask app.py        │
        │                             │
        │  ┌───────────────────────┐  │
        │  │  Customer Identity    │  │
        │  │  Registry (SQLite)    │  │
        │  │  email ↔ phone ↔ id   │  │
        │  └───────────┬───────────┘  │
        │              │              │
        │  ┌───────────▼───────────┐  │
        │  │  Cross-Channel        │  │
        │  │  Context Store        │  │
        │  │  (SQLite)             │  │
        │  └───────────┬───────────┘  │
        │              │              │
        │  ┌───────────▼───────────┐  │
        │  │  Telnyx AI Inference  │  │
        │  │  (context-aware       │  │
        │  │   greeting + reply)   │  │
        │  └───────────┬───────────┘  │
        │              │              │
        │     ┌────────┼────────┐     │
        │     │        │        │     │
        │  Email API  SMS API  Voice  │
        └─────────────────────────────┘
              │        │        │
              ▼        ▼        ▼
           Customer receives contextual
           responses on every channel
```

The key differentiator: when a customer switches channels (e.g., emails then calls), the AI resolves their identity, loads the full cross-channel conversation history, and generates a greeting that references their prior interaction — so they never have to repeat themselves.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_FROM_NUMBER` | `string` | `+15551234567` | **yes** | Telnyx phone number (SMS + Voice) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `TELNYX_EMAIL_FROM` | `string` | `agent@yourdomain.com` | **yes** | Verified sender email | [Portal](https://portal.telnyx.com/email) |
| `MESSAGING_PROFILE_ID` | `string` | `40017b7e-...` | no | Messaging profile ID | [Portal](https://portal.telnyx.com/messaging/profiles) |
| `CONNECTION_ID` | `string` | `1494404757140276705` | **yes** | Call Control connection ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Telnyx Inference model | [Models](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |
| `DB_PATH` | `string` | `conversations.db` | no | SQLite database path | — |

> **Agent / CLI access** — provision the resources above via the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US --features sms,voice
> telnyx number-orders create --phone-number +15551234567
> telnyx messaging-profiles create --name "Context Carrying Agent"
> ```

## Setup

### Option A — Demo mode (no credentials needed)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omnichannel-context-carrying-python

pip install -r requirements.txt

python demo/demo_server.py
```

The demo walks through "Sarah's Booking Change" — she emails about rescheduling, then calls and hears the AI greet her with full context from her email. No Telnyx credentials required.

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms,voice
telnyx number-orders create --phone-number +15551234567
telnyx messaging-profiles create --name "Context Carrying Agent"
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

### Option B — Production mode (with credentials)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omnichannel-context-carrying-python

cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

Register a customer and test the flow:

```bash
# Register a customer identity
curl -X POST http://localhost:5000/customers/register \
  -H "Content-Type: application/json" \
  -d '{
    "id": "cust_sarah_chen",
    "name": "Sarah Chen",
    "email": "sarah@example.com",
    "phone": "+15551234567"
  }'
```

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

### `POST /customers/register`

Register a customer identity for cross-channel resolution.

```bash
curl -X POST http://localhost:5000/customers/register \
  -H "Content-Type: application/json" \
  -d '{"id": "cust_001", "name": "Sarah Chen", "email": "sarah@example.com", "phone": "+15551234567"}'
```

### `GET /customers`

List all registered customers.

```bash
curl http://localhost:5000/customers
```

### `GET /customers/<id>/context`

View cross-channel context for a customer.

```bash
curl http://localhost:5000/customers/cust_001/context
```

### `GET /conversations`

View all cross-channel conversation history, grouped by customer.

```bash
curl http://localhost:5000/conversations
```

### `POST /demo/journey`

Trigger the full scripted demo journey (demo server only).

```bash
curl -X POST http://localhost:5555/demo/journey
```

### `GET /health`

Health check endpoint.

```bash
curl http://localhost:5000/health
```

## Webhook Endpoints

### `POST /webhooks/email`

Receives [Telnyx Email](https://developers.telnyx.com/docs/email) webhook events. On `email.received`: resolves customer identity by email, stores the message, and triggers AI-generated reply in a background thread.

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events. On `call.initiated` (incoming): resolves customer by phone and answers. On `call.answered`: loads cross-channel history and generates a contextual greeting. On `call.gather.ended`: processes customer speech with full context.

### `POST /webhooks/messaging`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events. On `message.received` (inbound): resolves customer by phone, stores message, and triggers AI reply with cross-channel context.

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
| No contextual greeting | Customer not registered | Register the customer with matching email/phone via `POST /customers/register` |
| Webhook not received | Server not publicly reachable | Expose with ngrok and set webhook URLs in Portal |
| Unknown customer on inbound | Email/phone not in registry | Ensure the customer's email/phone matches their registration |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)

## Related Examples

- [Omnichannel AI Agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-agent-python/README.md)
- [Omnichannel AI Receptionist (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-receptionist-python/README.md)
- [AI Email Agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-email-agent-python/README.md)
- [AI Voice Agent with Function Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-agent-with-function-calling-python/README.md)

## Resources

- [Telnyx Email API Guide](https://developers.telnyx.com/docs/email)
- [Telnyx Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx AI Inference](https://developers.telnyx.com/docs/inference/chat-completions)
- [Telnyx Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx Email API Product](https://telnyx.com/products/email-api)
- [Telnyx SMS API Product](https://telnyx.com/products/sms-api)
- [Telnyx Voice AI Product](https://telnyx.com/products/voice-ai-agents)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
