# Email Schedule Rescheduler — API Reference

This document describes the Telnyx Email API endpoints used by the `email-schedule-rescheduler` sample. All endpoints are part of the Telnyx v2 API and are accessed via `https://api.telnyx.com/v2`.

## Authentication

All requests require an API key passed in the `Authorization` header:

```
Authorization: Bearer <TELNYX_API_KEY>
```

The API key is read from the `TELNYX_API_KEY` environment variable. Never hardcode credentials.

---

## POST /v2/email_messages

Creates a new email message. When a future `scheduled_at` timestamp is provided, the email is scheduled for delivery at that time instead of being sent immediately.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Sender email address. Must be a verified Telnyx sender. |
| `to` | string | Yes | Recipient email address. |
| `subject` | string | Yes | Email subject line. |
| `text_body` | string | Yes | Plain-text body of the email. |
| `scheduled_at` | string (ISO 8601) | No | Future UTC timestamp for scheduled delivery. If omitted, the email is sent immediately. |

### Example Request

```bash
curl -X POST https://api.telnyx.com/v2/email_messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Scheduled Email Demo",
    "text_body": "This email was scheduled and then rescheduled.",
    "scheduled_at": "2026-08-01T12:30:00+00:00"
  }'
```

### Response — 202 Accepted

```json
{
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Scheduled Email Demo",
    "text_body": "This email was scheduled and then rescheduled.",
    "scheduled_at": "2026-08-01T12:30:00+00:00",
    "status": "queued",
    "created_at": "2026-08-01T10:00:00+00:00"
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 202 | Email created and scheduled successfully. Returns the message ID. |
| 400 | Invalid request. Missing required fields or malformed JSON. |
| 401 | Unauthorized. Invalid or missing API key. |
| 422 | Validation error. For example, `scheduled_at` is in the past. |
| 500 | Internal server error. |

---

## PATCH /v2/email_messages/{id}/schedule

Reschedules an already-scheduled email to a new delivery time. The new timestamp must be in the future.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | The ID of the email message to reschedule. |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scheduled_at` | string (ISO 8601 UTC) | Yes | New future UTC timestamp for delivery. Must be in the future. |

### Example Request

```bash
curl -X PATCH https://api.telnyx.com/v2/email_messages/8f85f64-5717-4562-b3fc-2c963f66afa6/schedule \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduled_at": "2026-08-01T11:30:00+00:00"
  }'
```

### Response — 200 OK

```json
{
  "data": {
    "id": "8f85f64-5717-4562-b3fc-2c963f66afa6",
    "scheduled_at": "2026-08-01T11:30:00+00:00",
    "status": "queued",
    "updated_at": "2026-08-01T10:05:00+00:00"
  }
}
```

### Response — 422 Unprocessable Entity

Returned when the `scheduled_at` timestamp is in the past or otherwise invalid. The email is **not** sent immediately and its status remains unchanged.

```json
{
  "errors": [
    {
      "code": "10010",
      "title": "Invalid scheduled_at timestamp",
      "detail": "scheduled_at must be a future timestamp. Received: 2026-08-01T09:55:00+00:00",
      "source": {
        "pointer": "/data/attributes/scheduled_at"
      }
    }
  ]
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Reschedule successful. Returns the updated `scheduled_at`. |
| 400 | Invalid request body or malformed JSON. |
| 401 | Unauthorized. Invalid or missing API key. |
| 404 | Email message with the given `id` not found. |
| 422 | Unprocessable entity. `scheduled_at` is in the past or otherwise invalid. |
| 500 | Internal server error. |

---

## GET /v2/email_messages/{id}

Retrieves a single email message by its ID.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | The ID of the email message to retrieve. |

### Example Request

```bash
curl -X GET https://api.telnyx.com/v2/email_messages/8f85f64-5717-4562-b3fc-2c963f66afa6 \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — 200 OK

```json
{
  "data": {
    "id": "8f85f64-5717-4562-b3fc-2c963f66afa6",
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Scheduled Email Demo",
    "text_body": "This email was scheduled and then rescheduled.",
    "scheduled_at": "2026-08-01T11:30:00+00:00",
    "status": "queued",
    "created_at": "2026-08-01T10:00:00+00:00",
    "updated_at": "2026-08-01T10:05:00+00:00"
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Email message retrieved successfully. |
| 401 | Unauthorized. Invalid or missing API key. |
| 404 | Email message with the given `id` not found. |
| 500 | Internal server error. |

---

## DELETE /v2/email_messages/{id}/schedule

Cancels a scheduled email so it will not be sent. Used for post-demo cleanup in this sample.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (UUID) | Yes | The ID of the email message whose schedule to cancel. |

### Example Request

```bash
curl -X DELETE https://api.telnyx.com/v2/email_messages/8f85f64-5717-4562-b3fc-2c963f66afa6/schedule \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — 200 OK

```json
{
  "data": {
    "id": "8f85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "cancelled"
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Schedule cancelled successfully. |
| 401 | Unauthorized. Invalid or missing API key. |
| 404 | Email message with the given `id` not found, or no schedule exists. |
| 500 | Internal server error. |

---

## Error Response Format

All error responses follow the Telnyx standard error envelope:

```json
{
  "errors": [
    {
      "code": "<string>",
      "title": "<string>",
      "detail": "<string>",
      "source": {
        "pointer": "<string>"
      }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `errors` | array | List of error objects. At least one entry is always present. |
| `errors[].code` | string | Machine-readable error code. |
| `errors[].title` | string | Short human-readable error summary. |
| `errors[].detail` | string | Detailed explanation of the error. |
| `errors[].source.pointer` | string | JSON pointer to the field that caused the error (when applicable). |

---

## Notes on the Sample Implementation

- The sample uses the Telnyx Python SDK (`telnyx`) for `POST /v2/email_messages`, `GET /v2/email_messages/{id}`, and `DELETE /v2/email_messages/{id}/schedule`.
- The reschedule call (`PATCH /v2/email_messages/{id}/schedule`) is implemented as a raw HTTP request because the SDK (v4.181.0) does not expose a patch-schedule method.
- In demo mode (`DEMO_MODE=true`), the sample logs the requests it would make without hitting the live API. Set `DEMO_MODE=false` to run against the real Telnyx API.
- Sender and recipient addresses are read from `TELNYX_EMAIL_FROM` and `TELNYX_EMAIL_TO` environment variables — never hardcoded.
