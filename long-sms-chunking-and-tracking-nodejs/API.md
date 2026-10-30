# API Reference — Long SMS Chunking and Tracking

The local Express server runs at `http://localhost:5000` by default.

## `POST /profile/enable-chunking`

Updates `TELNYX_MESSAGING_PROFILE_ID` with `features.auto_chunk_long_messages: true`.

```bash
curl -X POST http://localhost:5000/profile/enable-chunking
```

## `POST /sms/send-long`

Sends a message longer than 1,530 characters. Telnyx chunks it server-side.

```bash
curl -X POST http://localhost:5000/sms/send-long \
  -H 'Content-Type: application/json' \
  -d '{"to":"+12125551234","text":"<a message longer than 1,530 characters>"}'
```

Response:

```json
{
  "parent_message_id": "4b8...",
  "child_message_id": "5c9...",
  "status": "queued",
  "text_length": 1600
}
```

## `POST /webhooks/messaging`

Receives signed `message.sent` and `message.finalized` events. The handler correlates each child chunk with `parent_message_id` and stores the latest status in memory.

## `GET /deliveries/:parentMessageId`

Returns the in-memory delivery record, including all observed child chunk IDs and statuses.

## Errors

| Status | Meaning |
|---|---|
| `400` | Invalid phone number, message length, or payload |
| `401` | Invalid API key or webhook signature |
| `404` | Unknown parent message ID |
| `429` | Telnyx rate limit |
| `500` | Unexpected local or upstream error |
