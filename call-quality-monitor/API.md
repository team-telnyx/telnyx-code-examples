# Call Quality Monitor — API Reference

This document describes the HTTP endpoints exposed by the Call Quality Monitor Flask application. All routes are defined in `app.py`.

---

## Table of Contents

- [POST /webhooks/call-quality](#post-webhookscall-quality)
- [GET /](#get-)
- [GET /api/metrics](#get-apimetrics)
- [GET /api/quality/&lt;call_id&gt;](#get-apiqualitycall_id)
- [GET /health](#get-health)

---

## POST /webhooks/call-quality

Receives Telnyx Call Control webhook events containing call quality metrics (MOS, jitter, latency). Verifies the Ed25519 signature, updates per-call KV state, inserts metrics into SQL, evaluates threshold alerts, and pushes live updates to the WebSocket dashboard.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | object | Yes | Raw Telnyx webhook payload. See [Telnyx Call Control Events](https://developers.telnyx.com/docs/v2/call-control/api/webhooks) for full schema. |
| `headers` | object | Yes | HTTP headers including `Telnyx-Signature`, `Telnyx-Timestamp`, and `Telnyx-Digest` for Ed25519 verification. |

#### Relevant Payload Fields (inside `data.payload`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_id` | string | Yes | Unique identifier for the Telnyx call. |
| `mos` | number | No | Mean Opinion Score (0.0–5.0). Lower values indicate poorer audio quality. |
| `jitter` | number | No | Network jitter in milliseconds. |
| `latency` | number | No | Network latency in milliseconds. |
| `quality` | object | No | Optional nested object containing `mos`, `jitter`, and `latency` if not at top level. |

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/call-quality \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature: t=1699999999,v1=ed25519_signature_here" \
  -H "Telnyx-Timestamp: 1699999999" \
  -H "Telnyx-Digest: sha256_digest_here" \
  -d '{
    "data": {
      "payload": {
        "call_id": "call_abc123",
        "mos": 2.8,
        "jitter": 45,
        "latency": 180
      }
    },
    "event_type": "call.status"
  }'
```

### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{"status": "ok"}` | Webhook processed successfully. |
| `400` | `{"error": "Missing call_id"}` | The webhook payload did not contain a `call_id`. |
| `401` | `{"error": "Invalid signature"}` | Ed25519 signature verification failed. |
| `500` | `{"error": "Internal server error"}` | Unexpected server error. |

### Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| 200 | OK | Webhook verified and processed. |
| 400 | Bad Request | `call_id` missing from payload. |
| 401 | Unauthorized | Signature verification failed. |
| 500 | Internal Server Error | Unhandled exception during processing. |

---

## GET /

Serves the live call quality monitoring dashboard. The dashboard uses WebSocket (Socket.IO) to receive real-time `quality_update` and `quality_alert` events.

### Request

No parameters.

### Example Request

```bash
curl http://localhost:5000/
```

### Response

| Status Code | Content-Type | Description |
|-------------|--------------|-------------|
| `200` | `text/html` | HTML dashboard page with embedded JavaScript for WebSocket connections. |

### Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| 200 | OK | Dashboard HTML rendered. |
| 500 | Internal Server Error | Template rendering failure. |

---

## GET /api/metrics

Returns historical call quality metrics from the SQL database. Can be filtered by `call_id`.

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `call_id` | string | No | — | Filter metrics to a specific call. If omitted, returns the most recent metrics across all calls. |
| `limit` | integer | No | `100` | Maximum number of records to return. |

### Example Request

```bash
# All recent metrics
curl http://localhost:5000/api/metrics

# Metrics for a specific call
curl "http://localhost:5000/api/metrics?call_id=call_abc123&limit=50"
```

### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `array[object]` | Array of metric objects (see below). |
| `500` | `{"error": "Internal server error"}` | Database query failure. |

#### Metric Object Schema

| Field | Type | Description |
|-------|------|-------------|
| `call_id` | string | The call identifier. |
| `mos` | number | Mean Opinion Score. |
| `jitter` | number | Jitter in milliseconds. |
| `latency` | number | Latency in milliseconds. |
| `timestamp` | string | ISO 8601 UTC timestamp of the metric. |

### Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| 200 | OK | Metrics retrieved successfully. |
| 500 | Internal Server Error | SQL query or database error. |

---

## GET /api/quality/&lt;call_id&gt;

Returns the current per-call quality state from the KV store.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `call_id` | string | Yes | The unique call identifier. |

### Example Request

```bash
curl http://localhost:5000/api/quality/call_abc123
```

### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `object` | Current quality state for the call (see below). |
| `404` | `{"error": "Call not found"}` | No KV entry exists for the given `call_id`. |
| `500` | `{"error": "Internal server error"}` | Unexpected error. |

#### Quality State Object Schema

| Field | Type | Description |
|-------|------|-------------|
| `call_id` | string | The call identifier. |
| `mos` | number | Mean Opinion Score. |
| `jitter` | number | Jitter in milliseconds. |
| `latency` | number | Latency in milliseconds. |
| `timestamp` | string | ISO 8601 UTC timestamp of the last update. |
| `event_type` | string | The Telnyx event type (e.g., `call.status`). |

### Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| 200 | OK | Quality state retrieved from KV. |
| 404 | Not Found | No KV entry for the specified `call_id`. |
| 500 | Internal Server Error | Unexpected error. |

---

## GET /health

Simple health check endpoint.

### Request

No parameters.

### Example Request

```bash
curl http://localhost:5000/health
```

### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{"status": "ok"}` | Application is running. |

### Status Codes Summary

| Code | Meaning | Trigger |
|------|---------|---------|
| 200 | OK | Always returns healthy status. |

---

## WebSocket Events

The dashboard connects via Socket.IO (WebSocket). The following events are emitted server-side:

### `quality_update`

Broadcast on every processed webhook. Contains the full quality state object.

**Payload:**

| Field | Type | Description |
|-------|------|-------------|
| `call_id` | string | The call identifier. |
| `mos` | number | Mean Opinion Score. |
| `jitter` | number | Jitter in milliseconds. |
| `latency` | number | Latency in milliseconds. |
| `timestamp` | string | ISO 8601 UTC timestamp. |
| `event_type` | string | Telnyx event type. |

### `quality_alert`

Broadcast when any threshold is breached (MOS below threshold, jitter above threshold, or latency above threshold).

**Payload:**

| Field | Type | Description |
|-------|------|-------------|
| `call_id` | string | The call identifier. |
| `alerts` | array[string] | List of human-readable alert messages. |
| `mos` | number | Current MOS value. |
| `jitter` | number | Current jitter value. |
| `latency` | number | Current latency value. |
| `timestamp` | string | ISO 8601 UTC timestamp. |

---

## Environment Variables

The application reads the following environment variables (loaded via `python-dotenv`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELNYX_API_KEY` | No | `""` | Telnyx API key for SDK authentication. |
| `TELNYX_PUBLIC_KEY` | No | `""` | Telnyx public key for webhook verification. |
| `TELNYX_APP_ID` | No | `""` | Telnyx application ID. |
| `FLASK_SECRET_KEY` | No | `"dev-secret-key"` | Flask session secret key. |
| `MOS_THRESHOLD` | No | `3.5` | MOS alert threshold (below triggers alert). |
| `JITTER_THRESHOLD_MS` | No | `30` | Jitter alert threshold in ms (above triggers alert). |
| `LATENCY_THRESHOLD_MS` | No | `150` | Latency alert threshold in ms (above triggers alert). |
| `DB_PATH` | No | `"metrics.db"` | SQLite database file path. |
| `PORT` | No | `5000` | Port to run the Flask server on. |
