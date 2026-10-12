# API Reference — Endpoints used by this demo

All endpoints are on `https://api.telnyx.com/v2`. Auth: `Authorization: Bearer <TELNYX_API_KEY>`. Content-Type: `application/json`.

## Send an email

`POST /v2/emails`

Send a transactional email. Used to reply to inbound customer emails.

```bash
curl -X POST https://api.telnyx.com/v2/emails \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "[email protected]",
    "to": ["[email protected]"],
    "subject": "Re: Booking Change Request",
    "text_body": "Hi Sarah, we received your request to change booking BK-2024-1234..."
  }'
```

Used in `send_email()`.

## Send an SMS

`POST /v2/messages`

Send an SMS or MMS message.

```bash
curl -X POST https://api.telnyx.com/v2/messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559876543",
    "text": "Hi Sarah, your booking BK-2024-1234 has been updated to October 22."
  }'
```

Used in `send_sms()`.

## Create an outbound call

`POST /v2/calls`

Initiate an outbound call via Call Control.

```bash
curl -X POST https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "your_connection_id",
    "to": "+15559876543",
    "from": "+15551234567",
    "webhook_url": "https://your-server.com/webhooks/voice"
  }'
```

Used in `make_call()`.

## Answer a call

`POST /v2/calls/{call_control_id}/actions/answer`

Answer an incoming call.

```bash
curl -X POST https://api.telnyx.com/v2/calls/$CALL_CONTROL_ID/actions/answer \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Used in `handle_voice()` on `call.initiated` (incoming).

## Speak text on a call

`POST /v2/calls/{call_control_id}/actions/speak`

Convert text to speech and play it on an active call. Used for contextual greetings and AI responses.

```bash
curl -X POST https://api.telnyx.com/v2/calls/$CALL_CONTROL_ID/actions/speak \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "Hi Sarah! I see you emailed us about changing booking BK-2024-1234...",
    "voice": "female",
    "language_code": "en-US"
  }'
```

Used in `handle_voice()` on `call.answered` and `call.gather.ended`.

## Gather speech from a caller

`POST /v2/calls/{call_control_id}/actions/gather`

Listen for customer speech input on an active call.

```bash
curl -X POST https://api.telnyx.com/v2/calls/$CALL_CONTROL_ID/actions/gather \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input_type": "speech",
    "end_silence_timeout_secs": 2,
    "timeout_secs": 15,
    "language_code": "en-US"
  }'
```

Used in `handle_voice()` on `call.speak.ended`.

## AI Inference — chat completions

`POST /v2/ai/chat/completions`

OpenAI-compatible chat completions with tool-calling support. Same Telnyx API key. Used for generating contextual greetings and AI replies.

```bash
curl -X POST https://api.telnyx.com/v2/ai/chat/completions \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "messages": [
      {"role": "system", "content": "You are an AI agent that carries context across channels..."},
      {"role": "user", "content": "Prior history: [email] user: Change booking BK-2024-1234...\nGenerate a contextual greeting."}
    ],
    "max_tokens": 256
  }'
```

Used in `call_inference()` and `generate_contextual_greeting()`.

## Webhook events reference

**Inbound — triggers AI processing:**

| Event | Description |
|---|---|
| `email.received` | New inbound email — resolve customer, generate AI reply |
| `call.initiated` (incoming) | Incoming call — resolve customer by phone, answer |
| `call.answered` | Call connected — generate contextual greeting from cross-channel history |
| `call.speak.ended` | TTS finished — begin gathering customer speech |
| `call.gather.ended` | Customer spoke — process with full cross-channel context |
| `call.hangup` | Call ended |
| `message.received` (inbound) | Inbound SMS — resolve customer, generate AI reply |

## App API endpoints

### `POST /customers/register`

Register a customer identity for cross-channel resolution.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Unique customer ID (e.g., `cust_sarah_chen`) |
| `name` | `string` | yes | Customer display name |
| `email` | `string` | no | Email address for identity resolution |
| `phone` | `string` | no | Phone number for identity resolution |

**Response:** `201 Created`

```json
{
  "status": "registered",
  "customer": {
    "id": "cust_sarah_chen",
    "name": "Sarah Chen",
    "email": "sarah@example.com",
    "phone": "+15551234567"
  }
}
```

### `GET /customers`

List all registered customers.

**Response:** `200 OK`

```json
[
  {
    "id": "cust_sarah_chen",
    "name": "Sarah Chen",
    "email": "sarah@example.com",
    "phone": "+15551234567",
    "created_at": "2024-10-05T10:00:00Z"
  }
]
```

### `GET /customers/<customer_id>/context`

View cross-channel context for a specific customer.

**Response:** `200 OK`

```json
{
  "customer_id": "cust_sarah_chen",
  "channels_used": ["email", "voice", "sms"],
  "message_count": 5,
  "history": [
    {"channel": "email", "role": "user", "content": "[Inbound email] Subject: Change booking...", "timestamp": "..."},
    {"channel": "email", "role": "assistant", "content": "[Email sent] Subject: Re: Booking Change...", "timestamp": "..."},
    {"channel": "voice", "role": "assistant", "content": "[Contextual greeting] Hi Sarah! I see you emailed...", "timestamp": "..."}
  ]
}
```

### `GET /conversations`

View all conversation history grouped by customer.

### `GET /health`

Health check. Returns `{"status": "ok", "timestamp": "..."}`.

### `POST /demo/journey`

Trigger the full scripted demo journey (demo server only).

### `GET /stream`

SSE endpoint — streams real-time agent events to the browser dashboard.

## References

- [Telnyx Email API quickstart](https://developers.telnyx.com/docs/messaging/email/quickstart)
- [Telnyx Messaging API reference](https://developers.telnyx.com/api/messaging/send-message)
- [Call Control API reference](https://developers.telnyx.com/api/call-control)
- [Telnyx AI Inference docs](https://developers.telnyx.com/docs/inference/chat-completions)
- [Telnyx AI repo (skills, toolkit, MCP)](https://github.com/team-telnyx/ai)
