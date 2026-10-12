# Omnichannel Context-Carrying Agent — Deep Dive

A walkthrough of each component in the demo, the decisions behind them, and how to extend the agent for production use.

## 1. Why this demo exists

Customers hate repeating themselves. When someone emails about a booking change and then calls to follow up, they expect the agent to already know why they're calling. Traditional contact centers fail here because each channel operates in its own silo — email, phone, and SMS are separate systems with separate histories.

This demo shows how a single AI agent, powered by Telnyx APIs, can carry context across all three channels. The "wow moment": Sarah emails about changing her booking, then calls from her registered phone number. Instead of "How can I help you?", the AI greets her with: *"Hi Sarah! I see you emailed us about changing booking BK-2024-1234 from October 15 to October 22. Are you calling about the same request?"*

The technical foundation: one API key, one private network, one conversation history shared across email, SMS, and voice.

## 2. Architecture overview

The app has four layers:

1. **Customer Identity Registry** — SQLite table mapping customer IDs to email addresses and phone numbers. When an inbound message arrives on any channel, the app looks up the sender to find the customer.

2. **Cross-Channel Context Store** — SQLite table storing every message across all channels, tagged with customer ID, channel, role, and timestamp. This is the shared memory that enables context-carrying.

3. **Inbound Webhook Handlers** — Flask routes that receive Telnyx webhooks for email, voice, and SMS. Unlike a passive logger, these handlers trigger AI processing: resolving the customer, loading their history, and generating a contextual response.

4. **AI Brain** — Telnyx Inference API (OpenAI-compatible) with tool-calling. The AI receives the full cross-channel history and decides how to respond, using tools to send emails, SMS, or initiate calls.

## 3. Component walkthrough

### Customer Identity Registry

```python
CREATE TABLE customers (
    id         TEXT PRIMARY KEY,    -- "cust_sarah_chen"
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    created_at TEXT NOT NULL
);
```

Unique indexes on `email` and `phone` enable O(1) lookups. The `resolve_customer()` function tries email first, then phone:

```python
def resolve_customer(email=None, phone=None):
    if email:
        customer = lookup_customer_by_email(email)
        if customer:
            return customer
    if phone:
        customer = lookup_customer_by_phone(phone)
        if customer:
            return customer
    return None
```

This is the bridge that connects a phone number on an incoming call to an email address from a prior email thread.

### Inbound Email Handler

When `email.received` fires:

1. Extract the sender's email address from the webhook payload.
2. Call `resolve_customer(email=from_email)` to find the customer.
3. If found, store the inbound message and spawn a background thread to generate an AI reply.
4. Return `200` immediately so Telnyx doesn't retry the webhook.

The background thread builds the full conversation history, sends it to the Inference API with the system prompt, and processes any tool calls (typically `send_email` to reply).

### Inbound Voice Handler

The voice handler is more complex because Call Control is event-driven:

1. **`call.initiated` (incoming)** — resolve customer by phone number. Answer the call.
2. **`call.answered`** — this is where the magic happens. Call `generate_contextual_greeting(customer_id)`, which:
   - Loads the full cross-channel conversation history
   - Sends it to the Inference API with a specialized greeting prompt
   - Returns a personalized greeting that references prior interactions
3. **`call.speak.ended`** — the greeting finished playing. Start `gather` to listen for the customer's response.
4. **`call.gather.ended`** — the customer spoke. Build messages with the full cross-channel history plus their speech, send to Inference, and speak the AI's response. If the AI calls `send_sms` (e.g., to send a confirmation), that tool call is executed too.

### Contextual Greeting Generator

This is the core feature — the function that produces the "wow moment":

```python
def generate_contextual_greeting(customer_id):
    history = get_conversation_history(customer_id)
    if not history:
        return "Hello! How can I help you today?"

    # Send full cross-channel history to AI with greeting instructions
    messages = [
        {"role": "system", "content": "Generate a warm greeting that references prior interactions..."},
        {"role": "user", "content": f"Prior history:\n{history_text}\n\nGenerate a contextual greeting."},
    ]
    return call_inference(messages)
```

The AI sees the email Sarah sent, the reply the agent sent back, and generates a greeting that mentions the specific booking number, dates, and request.

### Inbound SMS Handler

Similar to email: resolve customer by phone, store the message, spawn a background thread for AI processing. The AI sees the full cross-channel history (including any prior emails and voice calls) and generates a contextual SMS reply.

## 4. Demo scenario: "Sarah's Booking Change"

The demo server (`demo/demo_server.py`) walks through six steps:

| Step | Channel | What happens |
|------|---------|-------------|
| 1 | Setup | Register Sarah (email + phone) in the identity registry |
| 2 | Email in | Sarah emails: "Change booking BK-2024-1234 from Oct 15 to Oct 22" |
| 3 | Email out | AI replies acknowledging the request with reference number CR-2024-0891 |
| 4 | Voice in | Sarah calls from her registered phone — AI looks up phone, finds Sarah, loads email history |
| 5 | Voice greeting | "Hi Sarah! I see you emailed us about changing booking BK-2024-1234 from October 15 to October 22. Are you calling about the same request?" |
| 6 | SMS out | Confirmation: "Your booking BK-2024-1234 has been updated to October 22." |

The demo uses monkey-patching: `call_inference`, `send_email`, `send_sms`, and `make_call` are replaced with mock functions that return scripted responses. The journey is triggered via `POST /demo/journey`, which simulates webhook payloads using Flask's test client.

## 5. SSE dashboard

The three-panel dashboard shows the flow in real time:

- **Left — Customer Journey**: vertical timeline showing each step (email in → AI reply → call in → contextual greeting → SMS confirmation)
- **Center — Agent Activity**: thinking events, identity resolution, context lookups, tool calls
- **Right — Channel Timeline**: inbound and outbound cards for email, SMS, and voice

New SSE event types beyond the reference example:
- `channel.inbound` — an inbound message arrived on any channel
- `agent.identity_resolved` — customer was identified from email/phone
- `agent.context_carry` — cross-channel history is being loaded
- `journey.step` — a step in the customer journey completed

## 6. Extending for production

- **Webhook signature verification**: add `client.webhooks.unwrap()` to verify Ed25519 signatures on all webhook endpoints. The demo skips this for simplicity.
- **Task queue**: replace background threads with Celery or RQ so processing survives restarts.
- **CRM integration**: replace the SQLite customer registry with a CRM lookup (HubSpot, Salesforce) for real customer data.
- **Multi-turn voice**: the current implementation does one gather-respond cycle. For multi-turn conversations, loop the speak → gather → process cycle until the customer hangs up or says goodbye.
- **Idempotency**: dedupe webhook events by message/call ID to prevent duplicate processing on retries.
- **Rate limiting**: add per-customer rate limiting on the AI inference calls.

## 7. Production checklist

- [ ] Set `TELNYX_PUBLIC_KEY` and enable webhook signature verification on all endpoints
- [ ] Replace SQLite with a production database (PostgreSQL) for the customer registry and conversation store
- [ ] Replace background threads with a task queue (Celery, RQ, SQS)
- [ ] Add idempotency: dedupe by event ID to prevent duplicate processing
- [ ] Add rate limiting per customer on AI inference calls
- [ ] Set up HTTPS endpoint (Telnyx Edge Compute, cloud VM with Caddy, or existing infra) instead of ngrok
- [ ] Monitor: alert on webhook verification failures, AI inference errors, and channel delivery failures
- [ ] Add customer consent tracking for multi-channel communication
