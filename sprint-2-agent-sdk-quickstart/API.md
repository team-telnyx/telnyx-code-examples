# API Reference

This document describes the HTTP endpoints exposed by the Agent SDK Quickstart sample. All endpoints return JSON unless otherwise noted.

## Base URL

When running locally, the base URL is:

```
http://localhost:5000
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Landing page with active conversation state |
| `POST` | `/webhooks/sms` | Inbound SMS webhook from Telnyx |
| `GET` | `/health` | Health check |

---

## `GET /`

Returns an HTML landing page that displays the current state of all in-memory conversations. This is useful for observing the demo workflow in a browser.

### Response

**Status: `200 OK`**

**Content-Type:** `text/html`

The response is an HTML page containing a table of active conversations with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `conversation_id` | string | Masked sender identifier containing only the final four digits |
| `status` | string | Current state: `awaiting_issue`, `awaiting_priority`, or `done` |
| `priority` | string or `null` | The priority level: `LOW`, `MEDIUM`, or `HIGH` |
| `created_at` | string | ISO 8601 timestamp when the conversation started |
| `last_updated_at` | string | ISO 8601 timestamp of the last state change |

### Example Request

```bash
curl http://localhost:5000/
```

### Example Response (HTML snippet)

```html
<h1>Telnyx Agent SDK Quickstart</h1>
<p>This demo runs a simple SMS-based issue triage flow.</p>
<table border="1" cellpadding="6">
  <tr>
    <th>Conversation ID</th>
    <th>Status</th>
    <th>Issue</th>
    <th>Priority</th>
    <th>Created (UTC)</th>
    <th>Last Updated (UTC)</th>
  </tr>
  <tr>
    <td>+15551234567</td>
    <td>done</td>
    <td>Cannot receive SMS on my number</td>
    <td>HIGH</td>
    <td>2025-01-15T14:32:10.123456+00:00</td>
    <td>2025-01-15T14:33:02.456789+00:00</td>
  </tr>
</table>
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | HTML page rendered successfully |

---

## `POST /webhooks/sms`

Receives inbound SMS webhook events from Telnyx. The endpoint verifies the Ed25519 signature, processes the message through the conversation state machine, and sends an SMS reply via the Telnyx Messaging API.

### Request

**Content-Type:** `application/json`

The request body must be a Telnyx webhook payload. The signature must be present in the `Telnyx-Signature-Ed25519` header and the timestamp in the `Telnyx-Timestamp` header.

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | The webhook event object |
| `data.event_type` | string | Yes | Must be `message.received` for processing |
| `data.payload` | object | Yes | The message payload |
| `data.payload.from` | array | Yes | Sender information |
| `data.payload.from[0].phone_number` | string | Yes | Sender's phone number (E.164) |
| `data.payload.to` | array | Yes | Recipient information |
| `data.payload.to[0].phone_number` | string | Yes | Recipient's phone number (E.164) |
| `data.payload.text` | string | Yes | The message body text |

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/sms \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <base64-encoded-signature>" \
  -H "Telnyx-Timestamp: 2025-01-15T10:32:00Z" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": [{"phone_number": "+15551234567"}],
        "to": [{"phone_number": "+15559876543"}],
        "text": "I cannot receive SMS messages"
      }
    }
  }'
```

### Response Schema

**Status:** `200 OK`

```json
{
  "status": "ok"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Webhook processed successfully |
| `200` | Event type is not `message.received` (ignored) |
| `400` | Invalid JSON body |
| `401` | Signature verification failed |
| `500` | Internal error while processing the message |

### Error Responses

**Status:** `400 Bad Request`

```json
{
  "error": "Invalid JSON"
}
```

**Status:** `401 Unauthorized`

```json
{
  "error": "Invalid signature"
}
```

**Status:** `500 Internal Server Error`

```json
{
  "error": "Internal error"
}
```

---

## `GET /health`

Returns a simple health check response.

### Request

No request body or parameters.

### Example Request

```bash
curl http://localhost:5000/health
```

### Example Response

**Status:** `200 OK`

```json
{
  "status": "ok"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Service is healthy |

---

## Webhook Signature Verification

All requests to `POST /webhooks/sms` must include the Telnyx Ed25519 signature headers:

| Header | Description |
|--------|-------------|
| `Telnyx-Signature-Ed25519` | The Ed25519 signature of the raw request body |
| `Telnyx-Timestamp` | The timestamp of when the webhook was sent |

The signature is verified using the `TELNYX_PUBLIC_KEY` environment variable. If the public key is not configured, the webhook will return `401 Unauthorized`.

---

## Error Handling

The API follows these error-handling conventions:

- **Missing environment variables** — The app logs a warning at startup if `TELNYX_API_KEY` is not set. SMS sending will fail with a `RuntimeError` if required variables are missing.
- **Failed external calls** — Errors from the Telnyx API are caught and logged via `app.logger.exception()`. The HTTP response returns a generic error message without leaking internal details.
- **Invalid webhook payloads** — Malformed JSON or missing `to`/`from` fields are logged and rejected with appropriate status codes.
