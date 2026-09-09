# API Reference — Webhook Aggregator Fanout

This document describes the HTTP endpoints exposed by the `webhook-aggregator-fanout` sample. All endpoints return JSON.

Base URL: `http://localhost:5000` (configurable via the `PORT` environment variable)

---

## `POST /webhooks`

Receives inbound Telnyx webhooks, verifies the Ed25519 signature, deduplicates events, logs them to SQLite, and fans out to action queues.

### Request

The request body is the raw Telnyx webhook payload. The `Content-Type` header should be `application/json`.

The following headers are required for signature verification:

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-Telnyx-Signature-Ed25519` | `string` | Yes | Ed25519 signature of the request body |
| `X-Telnyx-Timestamp` | `string` | Yes | Unix timestamp of when the webhook was sent |

### Request Body Schema

The body is the raw Telnyx webhook event. Key fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.id` | `string` | No | Unique event ID. If absent, an ID is generated from the payload hash. |
| `data.event_type` | `string` | Yes | Type of event (e.g., `call.answered`, `message.received`). Determines fanout target. |
| `data.payload` | `object` | Yes | Event-specific payload. Contents vary by event type. |
| `data.payload.call_control_id` | `string` | No | Present for call events. Used to control the call. |
| `data.payload.from` | `string` | No | Present for SMS events. Sender number. |
| `data.payload.to` | `string` | No | Present for SMS events. Recipient number. |
| `data.payload.text` | `string` | No | Present for SMS events. Message body. |

### Example Request

```bash
curl -X POST http://localhost:5000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telnyx-Signature-Ed25519: <signature>" \
  -H "X-Telnyx-Timestamp: 1710000000" \
  -d '{
    "data": {
      "id": "event_123",
      "event_type": "call.answered",
      "payload": {
        "call_control_id": "call_456"
      }
    }
  }'
```

### Response Schema

#### 200 — Success

```json
{
  "status": "success",
  "event_id": "event_123"
}
```

#### 200 — Duplicate

Returned when the same `event_id` was seen within the deduplication TTL window.

```json
{
  "status": "duplicate"
}
```

#### 500 — Internal Server Error

```json
{
  "error": "Internal server error"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Webhook processed successfully (including duplicates). |
| `500` | Processing failed. Details are logged server-side only. |

---

## GET /health

Health check endpoint. Returns service status and current queue sizes.

### Response Schema

#### 200 — OK

```json
{
  "status": "healthy",
  "timestamp": "2025-03-10T12:00:00+00:00",
  "queues": {
    "call": 0,
    "sms": 0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"healthy"` when the service is running. |
| `timestamp` | `string` | ISO 8601 timestamp of the response. |
| `queues` | `object` | Map of action type → current queue size. |

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Service is healthy. |

---

## GET `/events`

Retrieves the most recent 100 logged webhook events from the SQLite database, ordered newest-first.

### Request Parameters

None.

### Response Schema

#### 200 — OK

```json
{
  "events": [
    {
      "id": 1,
      "event_id": "evt_123",
      "event_type": "call.answered",
      "payload": {
        "call_control_id": "call_456"
      },
      "received_at": "2025-01-10T10:00:00+00:00",
      "processed_at": "2025-01-10T10:00:00+00:00"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `events` | `array` | List of event objects. |
| `events[].id` | `integer` | Auto-incrementing database ID. |
| `events[].event_id` | `string` | Unique event identifier. |
| `events[].event_type` | `string` | Telnyx event type. |
| `events[].payload` | `object` | Parsed event payload. |
| `events[].received_at` | `string` | ISO 8601 timestamp when the event was received. |
| `events[].processed_at` | `string` | ISO 8601 timestamp when the event was processed. |

#### 500 — Internal Server Error

```json
{
  "error": "Internal server error"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Events retrieved successfully. |
| `500` | Database query failed. |

---

## GET `/queues`

Returns the current state of the in-memory action queues, including the last 10 items in each queue.

### Request Parameters

None.

### Response Schema

#### 200 — OK

```json
{
  "queues": {
    "call": {
      "size": 2,
      "items": [
        {
          "data": {
            "id": "evt_123",
            "event_type": "call.answered",
            "payload": {
              "call_control_id": "call_456"
            }
          }
        }
      ]
    },
    "sms": {
      "size": 0,
      "items": []
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `queues` | `object` | Map of action type → queue state. |
| `queues[].size` | `integer` | Current number of items in the queue. |
| `queues[].items` | `array` | Last 10 items in the queue (oldest of the 10 first). |

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Queue state retrieved successfully. |

---

## Common Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Request succeeded. |
| `400` | Malformed request (not explicitly returned by this sample; the SDK may reject invalid signatures). |
| `404` | Route not found. |
| `500` | Internal server error. Details are logged server-side and never exposed in the response body. |

---

## Notes

- **Signature verification**: All requests to `/webhook` must include valid `X-Telnyx-Signature-Ed25519` and `X-Telnyx-Timestamp` headers. Requests with invalid signatures fail verification and return `500`.
- **Deduplication**: Events with the same `data.id` (or payload hash) are ignored for `DEDUP_TTL_SECONDS` (default: 300 seconds).
- **Queue processing**: In this sample, queues are processed synchronously within the webhook handler. In production, this would be a separate worker process.
- **Error responses**: Never expose internal exception details. All failures return a generic `{"error": "Internal server error"}` with status `500`.
