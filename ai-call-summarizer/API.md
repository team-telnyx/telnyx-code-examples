# API Reference — AI Call Summarizer

This document describes the HTTP endpoints exposed by the **AI Call Summarizer** Edge application. The application receives Telnyx Call Control webhooks, generates a post-call summary via OpenAI, sends the summary to the caller via SMS, and logs the result to a SQL database for analytics.

---

## Table of Contents

- [Endpoints](#endpoints)
  - [POST `/webhooks/telnyx`](#post-webhookstelnyx)
- [Status Codes](#status-codes)

---

## Endpoints

### POST `/webhooks/telnyx`

Receives inbound Telnyx Call Control webhooks. The handler verifies the Ed25519 signature, inspects the event type, and — when a `call.hangup` event is received — triggers the summarization pipeline.

#### Request Body Schema

| Field                     | Type     | Required | Description                                                                 |
|---------------------------|----------|----------|-----------------------------------------------------------------------------|
| `data`                    | object   | Yes      | Top-level wrapper containing the event payload.                             |
| `data.event`              | string   | Yes      | The Telnyx event type (e.g., `call.hangup`, `call.answered`).               |
| `data.payload`            | object   | Yes      | The event payload containing call details.                                  |
| `data.payload.call_id`    | string   | Yes      | Unique identifier for the Telnyx call.                                      |
| `data.payload.caller`     | object   | Yes      | Caller information object.                                                  |
| `data.payload.caller.number` | string | Yes      | The caller's phone number in E.164 format.                                  |
| `data.payload.callee`     | object   | No       | Callee information object (if available).                                   |
| `data.payload.callee.number` | string | No       | The callee's phone number in E.164 format.                                  |
| `data.payload.duration`   | integer  | No       | Call duration in seconds (present on hangup events).                        |
| `data.payload.start_time` | string   | No       | ISO 8601 timestamp of when the call started.                                |
| `data.payload.end_time`   | string   | No       | ISO 8601 timestamp of when the call ended.                                  |
| `data.payload.recording_url` | string | No       | URL to the call recording (if recording was enabled).                       |
| `data.payload.conversation_history` | array | No | Array of message objects representing the conversation (if available). |
| `data.payload.conversation_history[].role` | string | No | Role of the message sender (`user`, `assistant`, `system`). |
| `data.payload.conversation_history[].content` | string | No | Text content of the message. |

#### Example Request (curl)

```bash
curl -X POST https://<your-edge-app>.telnyx.io/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -H "User-Agent: Telnyx-Webhook" \
  -H "X-Telnyx-Signature: t=1700000000,v1=base64encodedsignature" \
  -d '{
    "data": {
      "event": "call.hangup",
      "payload": {
        "call_id": "ca5b3d4a-1234-5678-9abc-def012345678",
        "caller": {
          "number": "+15551234567"
        },
        "callee": {
          "number": "+15559876543"
        },
        "duration": 180,
        "start_time": "2024-01-15T10:00:00Z",
        "end_time": "2024-01-15T10:03:00Z",
        "conversation_history": [
          {
            "role": "user",
            "content": "Hello, I need help with my order."
          },
          {
            "role": "assistant",
            "content": "Sure, I can help with that. What's your order number?"
          },
          {
            "role": "user",
            "content": "It's order 12345."
          }
        ]
      }
    }
  }'
```

#### Response Schema

**200 OK** — Webhook accepted and processed successfully.

```json
{
  "status": "ok",
  "message": "Webhook received and processed."
}
```

**202 Accepted** — Webhook accepted; summarization pipeline initiated asynchronously.

```json
{
  "status": "accepted",
  "message": "Summarization pipeline triggered."
}
```

**400 Bad Request** — Webhook payload is malformed or missing required fields.

```json
{
  "status": "error",
  "message": "Invalid webhook payload."
}
```

**401 Unauthorized** — Webhook signature verification failed.

```json
{
  "status": "error",
  "message": "Webhook signature verification failed."
}
```

**500 Internal Server Error** — An unexpected error occurred during processing.

```json
{
  "status": "error",
  "message": "Internal server error."
}
```

---

## Status Codes

| Status Code | Description                                      | Response Body                                                                 |
|-------------|--------------------------------------------------|-------------------------------------------------------------------------------|
| `200`       | Webhook accepted and processed synchronously.    | `{ "status": "ok", "message": "Webhook received and processed." }`            |
| `202`       | Webhook accepted; summarization triggered async. | `{ "status": "accepted", "message": "Summarization pipeline triggered." }`    |
| `400`       | Malformed or invalid webhook payload.            | `{ "status": "error", "message": "Invalid webhook payload." }`                |
| `401`       | Ed25519 signature verification failed.           | `{ "status": "error", "message": "Webhook signature verification failed." }`  |
| `500`       | Unexpected internal error.                       | `{ "status": "error", "message": "Internal server error." }`                  |

---

## Notes

- **Signature Verification**: All requests to `/webhooks/telnyx` must include a valid `X-Telnyx-Signature` header. The application uses `telnyx.webhooks.unwrap()` to verify the Ed25519 signature before processing the payload.
- **Event Filtering**: Only `call.hangup` events trigger the summarization pipeline. Other event types (e.g., `call.answered`, `call.started`) are acknowledged with a `200 OK` but do not initiate summarization.
- **Conversation History**: The `conversation_history` field in the payload is passed to OpenAI's chat completion API to generate a summary. If no conversation history is available, the summarizer will note this in the generated summary.
- **SMS Delivery**: In demo mode, SMS messages are logged but not sent. In live mode, the summary is sent to the caller's phone number via `telnyx.messages.send()`.
- **SQL Logging**: After summarization, the result is logged to the `summaries` table with columns: `call_id`, `caller`, `summary`, `duration`, and `timestamp`.
