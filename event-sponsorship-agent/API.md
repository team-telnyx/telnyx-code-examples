# API Reference — Event Sponsorship Agent

All endpoints are served from the Telnyx Edge Function deployment. The agent is a single stateful actor keyed by phone number (SMS/WhatsApp/Voice) or session ID (chat).

---

## POST /webhook/sms

Handles inbound SMS messages from attendees.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender's phone number (E.164 format) |
| `to` | string | No | Recipient phone number |
| `text` | string | Yes | Message body from the attendee |

### Example Request

```bash
curl -X POST https://<your-edge-domain>/webhook/sms \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559998888",
    "text": "I want to enter the giveaway"
  }'
```

### Response Schema

**200 OK**

```json
{
  "success": true,
  "message": "🎉 You're entered in the giveaway! Prize: Telnyx swag pack. A sales rep will contact you shortly."
}
```

**400 Bad Request**

```json
{
  "error": "Missing from or text"
}
```

---

## POST /webhook/whatsapp

Handles inbound WhatsApp messages from attendees.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender's WhatsApp ID or phone number |
| `to` | string | No | Recipient phone number |
| `text` | string | Yes | Message body from the attendee |

### Example Request

```bash
curl -X POST https://<your-edge-domain>/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559998888",
    "text": "¿Cómo funciona el producto?"
  }'
```

### Response Schema

**200 OK**

```json
{
  "success": true,
  "message": "Telnyx es una plataforma de comunicaciones API..."
}
```

**400 Bad Request**

```json
{
  "error": "Missing from or text"
}
```

---

## POST /webhook/voice

Handles inbound voice call events.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Caller's phone number (E.164) |
| `to` | string | No | Called phone number |
| `call_id` | string | Yes | Unique Telnyx call identifier |

### Example Request

```bash
curl -X POST https://<your-edge-domain>/webhook/voice \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+15551234567",
    "to": "+15559998888",
    "call_id": "CA1234567890abcdef"
  }'
```

### Response Schema

**200 OK**

```json
{
  "success": true,
  "message": "Call received and queued for agent."
}
```

**400 Bad Request**

```json
{
  "error": "Missing from or call_id"
}
```

---

## POST /api/chat

Handles in-browser chat messages from the microsite.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | No | Unique session identifier; auto-generated if omitted |
| `text` | string | Yes | Chat message from the attendee |

### Example Request

```bash
curl -X POST https://<your-edge-domain>/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "web_1719500000000",
    "text": "I want to book a demo"
  }'
```

### Response Schema

**200 OK**

```json
{
  "success": true,
  "message": "📅 Great! Let's book a demo. What's your company name?"
}
```

**400 Bad Request**

```json
{
  "error": "Missing text"
}
```

---

## POST /api/followup

Schedules a post-event follow-up message to a lead.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | Yes | Lead's phone number (E.164) |
| `channel` | string | Yes | Delivery channel: `sms`, `whatsapp`, `email`, or `voice` |
| `delaySeconds` | integer | Yes | Seconds to wait before sending the follow-up |

### Example Request

```bash
curl -X POST https://<your-edge-domain>/api/followup \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+15551234567",
    "channel": "sms",
    "delaySeconds": 3600
  }'
```

### Response Schema

**200 OK**

```json
{
  "success": true,
  "scheduledId": "task_abc123def456"
}
```

**400 Bad Request**

```json
{
  "error": "Missing phone, channel, or delaySeconds"
}
```

---

## GET /api/report

Generates an attribution report of all captured, qualified, and converted leads.

### Request

No request body or parameters required.

### Example Request

```bash
curl -X GET https://<your-edge-domain>/api/report
```

### Response Schema

**200 OK**

```json
{
  "totalCaptured": 42,
  "totalQualified": 28,
  "totalConverted": 15,
  "byChannel": {
    "sms": 20,
    "whatsapp": 8,
    "chat": 10,
    "voice": 4
  },
  "byUseCase": {
    "customer communications": 12,
    "contact center": 8,
    "voice API": 10,
    "messaging": 12
  }
}
```

---

## GET /health

Health check endpoint.

### Example Request

```bash
curl -X GET https://<your-edge-domain>/health
```

### Response Schema

**200 OK**

```json
{
  "status": "ok",
  "service": "event-sponsorship-agent"
}
```

---

## GET /

Serves the branded microsite HTML page with in-browser chat interface.

### Example Request

```bash
curl -X GET https://<your-edge-domain>/
```

### Response Schema

**200 OK** — `Content-Type: text/html`

Returns the full HTML microsite with embedded chat widget.

---

## WebSocket / (in-browser chat)

The microsite also supports a WebSocket connection for real-time chat. The `webSocket(ws, req)` handler on the agent accepts messages in the format:

```json
{
  "sessionId": "web_1719500000000",
  "text": "Hello, I have a question"
}
```

And responds with:

```json
{
  "success": true,
  "message": "Response text from the agent"
}
```

---

## Status Codes Summary

| Code | Description | Applicable Endpoints |
|------|-------------|---------------------|
| 200 | Success | All endpoints |
| 400 | Bad request — missing required fields | `/webhook/sms`, `/webhook/whatsapp`, `/webhook/voice`, `/api/chat`, `/api/followup` |
| 404 | Not found | Any unmatched route |
| 500 | Internal server error | All endpoints (unexpected failures) |

---

## Rate Limiting

All interaction endpoints are protected by per-identifier rate limiting:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/webhook/sms` | 10 requests | 60 seconds |
| `/webhook/whatsapp` | 10 requests | 60 seconds |
| `/webhook/voice` | 5 requests | 60 seconds |
| `/api/chat` | 20 requests | 60 seconds |

When the rate limit is exceeded, the response is:

```json
{
  "success": false,
  "message": "Rate limit exceeded. Please try again later."
}
```
