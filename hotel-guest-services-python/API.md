# Hotel Guest Services Line — API Reference

This document lists every endpoint exposed by `app.py`, with request and
response shapes that match the actual implementation.

## Webhooks

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events. The handler is idempotent: it deduplicates by the Telnyx event ID for one hour.

**Events handled**

| Event | App behavior |
|-------|--------------|
| `call.initiated` (inbound) | Answer the call |
| `call.answered` | Speak greeting (guest name when caller ID matches a known room) |
| `call.speak.ended` | Start speech gather |
| `call.gather.ended` | Extract room number, classify request with AI, record it |
| `call.hangup` | Drop call session |

You cannot usefully curl this endpoint from your terminal — Telnyx delivers events automatically. To test locally, drive it from the [Telnyx Portal](https://portal.telnyx.com) or use [ngrok](https://ngrok.com).

```bash
curl -X POST http://localhost:5000/webhooks/voice
```

Returns `200 {"status":"ok"}` once verified. Returns `401 {"error":"invalid signature"}` if `TELNYX_PUBLIC_KEY` is set and the signature does not verify.

### `POST /webhooks/sms`

Receives [Telnyx Messaging](https://developers.telnyx.com/docs/messaging) webhook events. Deduplicated by event ID.

```bash
curl -X POST http://localhost:5000/webhooks/sms
```

## Local API

### `GET /requests`

List service requests, optionally filtered.

**Query params**

- `department` — `room_service|housekeeping|concierge|maintenance`
- `status` — `open|completed`

**Example**

```bash
curl http://localhost:5000/requests
curl "http://localhost:5000/requests?department=maintenance&status=open"
```

**Response `200`**

```json
{
  "requests": [
    {
      "id": 0,
      "room": "205",
      "guest": "Chen",
      "phone": "+15559005678",
      "channel": "voice",
      "department": "room_service",
      "urgency": "normal",
      "summary": "Club sandwich and sparkling water",
      "details": "One club sandwich and one bottle of sparkling water",
      "original": "Can I order a club sandwich and sparkling water?",
      "status": "open",
      "created_at": "2026-07-14T18:42:00Z"
    }
  ],
  "total": 1
}
```

### `POST /requests/<idx>/complete`

Mark a request complete and send the guest a fulfilment SMS. `idx` is the request id returned by `GET /requests`.

**Example**

```bash
curl -X POST http://localhost:5000/requests/0/complete
```

**Response `200`**

```json
{
  "request": {
    "id": 0,
    "room": "205",
    "guest": "Chen",
    "phone": "+15559005678",
    "channel": "voice",
    "department": "room_service",
    "urgency": "normal",
    "summary": "Club sandwich and sparkling water",
    "details": "One club sandwich and one bottle of sparkling water",
    "original": "Can I order a club sandwich and sparkling water?",
    "status": "completed",
    "created_at": "2026-07-14T18:42:00Z",
    "completed_at": "2026-07-14T18:55:12Z"
  }
}
```

**Response `404`**

```json
{"error": "not found"}
```

### `GET /health`

**Example**

```bash
curl http://localhost:5000/health
```

**Response `200`**

```json
{
  "status": "ok",
  "open_requests": 1,
  "active_calls": 0
}
```

## Department Values

`room_service`, `housekeeping`, `concierge`, `maintenance`.

## Urgency Values

`normal`, `urgent`. Urgent is set when the LLM classifies it that way OR when the caller text matches a hardcoded urgent phrase list (`fire`, `flood`, `leak`, `locked out`, `gas`, `medical`, etc).

## Status Values

`open`, `completed`.

## Error Format

All errors return JSON:

```json
{"error": "message"}
```

| HTTP status | Meaning |
|-------------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid body |
| `401` | Invalid webhook signature |
| `404` | Request index out of range |
