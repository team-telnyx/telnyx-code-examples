# API Reference

## `GET /`

Returns the local dashboard for live demo status.

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Telnyx calls this endpoint automatically.

### Events handled

| Event | Action |
| --- | --- |
| `call.initiated` | Answers inbound calls. |
| `call.answered` | Starts the configured Telnyx AI Assistant. |
| `call.conversation.ended` | Records sanitized activity for the dashboard. |
| `call.conversation_insights.generated` | Records sanitized activity for the dashboard. |
| `call.hangup` | Clears local active-call state. |

### Response `200`

```json
{
  "status": "ok"
}
```

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events. Telnyx calls this endpoint automatically.

The app processes `message.received` events, categorizes the text with Telnyx AI Inference, logs a local request, and sends an SMS confirmation.

### Response `200`

```json
{
  "status": "ok",
  "request": {
    "id": 0,
    "room": "205",
    "guest": "Chen",
    "phone": "+15559005678",
    "channel": "sms",
    "department": "housekeeping",
    "urgency": "normal",
    "summary": "extra towels",
    "original": "room 205 needs extra towels",
    "status": "open",
    "created_at": "2026-07-17T21:00:00Z"
  }
}
```

Non-`message.received` events are acknowledged and ignored:

```json
{
  "status": "ignored"
}
```

## `GET /requests`

Lists locally logged SMS requests.

### Query parameters

| Parameter | Description |
| --- | --- |
| `department` | Optional filter: `room_service`, `housekeeping`, `concierge`, or `maintenance`. |
| `status` | Optional filter: `open` or `completed`. |

### Response `200`

```json
{
  "requests": [
    {
      "id": 0,
      "room": "205",
      "guest": "Chen",
      "phone": "+15559005678",
      "channel": "sms",
      "department": "housekeeping",
      "urgency": "normal",
      "summary": "extra towels",
      "original": "room 205 needs extra towels",
      "status": "open",
      "created_at": "2026-07-17T21:00:00Z"
    }
  ],
  "total": 1
}
```

## `POST /requests/<idx>/complete`

Marks a locally logged SMS request complete and sends a completion SMS to the guest.

### Response `200`

```json
{
  "request": {
    "id": 0,
    "status": "completed",
    "completed_at": "2026-07-17T21:05:00Z"
  }
}
```

### Response `404`

```json
{
  "error": "not found"
}
```

## `GET /events`

Lists sanitized, high-level voice assistant events for the local dashboard. Raw call IDs and webhook payloads are not returned.

### Response `200`

```json
{
  "events": [
    {
      "type": "conversation ended",
      "created_at": "2026-07-17T21:10:00Z"
    }
  ],
  "total": 1
}
```

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "assistant_configured": true,
  "active_calls": 0,
  "open_requests": 0
}
```

## Error Responses

Invalid webhook signatures return:

```json
{
  "error": "invalid signature"
}
```

Invalid JSON payloads return:

```json
{
  "error": "invalid request body"
}
```
