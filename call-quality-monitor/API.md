# API Reference — Call Quality Monitor

This document describes the HTTP endpoints exposed by the Call Quality Monitor sample. All endpoints return JSON responses.

## Base URL

When running locally, the base URL is `http://localhost:5000` (or the port specified by the `PORT` environment variable).

---

## Webhook Endpoint

### POST `/webhooks/call-quality`

Receives Telnyx call quality webhook events. The request must include a valid Telnyx webhook signature in the headers.

#### Request Body Schema

The request body is a Telnyx webhook event. The relevant fields are in `data.payload`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_leg_id` | string | Yes* | Unique identifier for the call leg. Used as the call ID if `call_session_id` is absent. |
| `call_session_id` | string | Yes* | Unique identifier for the call session. Used as the call ID if `call_leg_id` is absent. |
| `event_type` | string | Yes | Type of event. Must contain `quality` or `call.quality` to be processed as a quality metric. |
| `mos` | number | No | Mean Opinion Score (MOS) for the call, typically between 1 and 5. |
| `jitter` | number | No | Jitter in milliseconds. |
| `latency` | number | No | Latency in milliseconds. |
| `packet_loss` | number | No | Packet loss percentage. |
| `source` | string | No | Source of the quality metric. |
| `from` | string | No | The caller's phone number. |
| `to` | string | No | The destination phone number. |

*At least one of `call_leg_id` or `call_session_id` is required.*

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/call-quality \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "call.quality",
      "payload": {
        "call_leg_id": "call-leg-123",
        "call_session_id": "call-session-456",
        "mos": 3.2,
        "jitter": 45,
        "latency": 180,
        "packet_loss": 0.5,
        "source": "webrtc",
        "from": "+15551234567",
        "to": "+15557654321"
      }
    }
  }'
```

### Response Schema

**200 OK**

```json
{
  "status": "ok"
}
```

**400 Bad Request**

```json
{
  "error": "Invalid signature"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Webhook processed successfully |
| `400` | Invalid webhook signature |

---

## Call Quality Endpoints

### GET `/api/quality/<call_id>`

Returns all quality metrics for a specific call, ordered by timestamp ascending.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `call_id` | string | Yes | The call ID (call leg ID or session ID) to retrieve metrics for. |

### Example Request

```bash
curl http://localhost:8080/api/quality/call-leg-123
```

### Response Schema

**200 OK** — Array of metric objects:

```json
[
  {
    "id": 1,
    "call_id": "call-leg-123",
    "timestamp": "2025-01-15T12:00:00+00:00",
    "mos": 3.2,
    "jitter": 45.0,
    "latency": 180.0,
    "packet_loss": 0.5,
    "source": "webrtc",
    "raw": "{\"call_leg_id\":\"call-leg-123\",\"mos\":3.2}",
    "from_number": "+15551234567",
    "to_number": "+15557654321"
  }
]
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Metrics retrieved successfully |
| `404` | Call ID not found |
| `500` | Internal server error |

---

### GET `/api/quality`

Returns all quality metrics with optional filters.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `call_id` | string | No | Filter by call ID |
| `start` | string (ISO 8601) | No | Return metrics with timestamp greater than or equal to this value |
| `end` | string (ISO 8601) | No | Return metrics with timestamp less than or equal to this value |
| `limit` | integer | No | Maximum number of results to return (default: `100`) |

### Example Request

```bash
curl "http://localhost:8080/api/quality?call_id=call-leg-123&start=2025-01-15T00:00:00Z&limit=50"
```

### Response Schema

**200 OK** — Returns an array of metric objects (same shape as `GET /api/quality/<call_id>`).

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Metrics retrieved successfully |
| `500` | Internal server error |

---

### GET `/api/quality/stats`

Returns aggregate statistics for all stored quality metrics.

### Example Request

```bash
curl http://localhost:8080/api/quality/stats
```

### Response Schema

**200 OK**

```json
{
  "total_samples": 150,
  "avg_mos": 3.8,
  "min_mos": 2.1,
  "max_mos": 4.9,
  "avg_jitter": 22.5,
  "max_jitter": 78.0,
  "avg_latency": 95.0,
  "max_latency": 320.0,
  "avg_packet_loss": 0.3,
  "max_packet_loss": 2.5
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Statistics retrieved successfully |
| `500` | Internal server error |

---

### GET `/api/quality/alerts`

Returns all threshold alerts that have been triggered, across all calls.

### Example Request

```bash
curl http://localhost:8080/api/quality/alerts
```

### Response Schema

**200 OK** — Returns an array of alert objects:

```json
[
  {
    "call_id": "call-leg-123",
    "alert": "MOS 3.2 below threshold 3.5"
  },
  {
    "call_id": "call-leg-456",
    "alert": "Jitter 45ms above threshold 30ms"
  }
]
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Alerts retrieved successfully |
| `500` | Internal server error |

---

## WebSocket Endpoint

### GET `/ws`

WebSocket endpoint for the live dashboard. Requires a WebSocket connection (e.g., via `websocket-client` or a browser WebSocket). Messages are broadcast to all connected clients.

### Message Types

**Quality Metric Message**

```json
{
  "type": "quality_metric",
  "data": {
    "call_id": "call-leg-123",
    "timestamp": "2025-01-15T12:34:00+00:00",
    "mos": 3.2,
    "jitter": 45.0,
    "latency": 180.0,
    "packet_loss": 0.5,
    "source": "webrtc",
    "from_number": "+15551234567",
    "to_number": "+15557654321"
  },
  "alerts": ["MOS 3.2 below threshold 3.5"]
}
```

**Call Event Message**

```json
{
  "type": "call_event",
  "call_id": "call-leg-123",
  "event": "call.initiated"
}
```

### Example Connection (Python)

```python
import websocket

ws = websocket.WebSocket()
ws.connect("ws://localhost:8080/ws")

while True:
    message = ws.recv()
    print(message)
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | WebSocket connection established |
| `400` | Not a WebSocket connection |

---

## Health Check

### GET `/health`

Returns the health status of the service.

### Example Request

```bash
curl http://localhost:8080/health
```

### Response Schema

**200 OK**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:34:00+00:00"
}
```

### Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Service is healthy |

---

## Error Handling

### 404 Not Found

Returned when a route does not exist.

```json
{
  "error": "Not found"
}
```

### 500 Internal Server Error

Returned when an unexpected error occurs. Error details are logged server-side but not exposed in the response.

```json
{
  "error": "Internal server error"
}
```

---

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TELNYX_API_KEY` | string | — | Telnyx API key |
| `TELNYX_PUBLIC_KEY` | string | — | Telnyx public key for webhook signature verification |
| `DB_PATH` | string | `call_quality.db` | Path to the SQLite database file |
| `MOS_THRESHOLD` | number | `3.5` | MOS value below which an alert is triggered |
| `JITTER_THRESHOLD` | number | `30` | Jitter value (ms) above which an alert is triggered |
| `LATENCY_THRESHOLD` | number | `150` | Latency value (ms) above which an alert is triggered |
| `PORT` | integer | `5000` | Port on which the Flask server runs |
