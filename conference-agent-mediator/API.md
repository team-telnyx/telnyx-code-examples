# API Reference

Base URL: `http://localhost:5000`

All endpoints return JSON. Webhooks are secured via Telnyx Ed25519 signature verification.

---

## 1. Start Conference

Creates a Telnyx conference, spawns the `ConferenceAgent` to join, and returns the connection details for observers.

**Endpoint:** `POST /conference/start`

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `participants` | `list[string]` | Yes | Display names of the expected participants (e.g., `["Alice", "Bob"]`). Used for turn-taking mediation. |

### Example Request

```bash
curl -X POST http://localhost:5000/conference/start \
  -H "Content-Type: application/json" \
  -d '{"participants": ["Alice", "Bob"]}'
```

### Response Schema

**201 Created**
```json
{
  "conference_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "call_control_id": "call-uuid-here",
  "observer_ws_url": "ws://your-webhook-url/transcript/3fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **201** | Conference successfully created and agent joined. |
| **400** | Bad Request. `participants` is missing or not a non-empty list. |
| **500** | Internal Server Error. Failed to create conference or agent call. |

---

## 2. Telnyx Webhook

Receives and processes inbound Telnyx Call Control events. Verifies the Ed25519 signature.

**Endpoint:** `POST /webhooks/telnyx`

### Request Body Schema

Raw Telnyx webhook payload (JSON). The endpoint reads `data.event_type` and `data.payload`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | `string` | Yes | The Telnyx event type (e.g., `conference.ended`). |
| `data.payload` | `object` | Yes | The event payload containing conference/call details. |

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-signature-timestamp: <timestamp>" \
  -d '{"data": {"event_type": "conference.ended", "payload": {"conference_id": "conf-123"}}}'
```

### Response Schema

**200 OK**
```json
{
  "status": "ok"
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **200** | Webhook received and processed successfully. |
| **401** | Unauthorized. Webhook signature verification failed. |
| **500** | Internal Server Error. Failed to process event handler logic. |

---

## 3. Ingest Transcript

Accepts transcript chunks from an external Speech-to-Text (STT) provider and feeds them to the agent for mediation and observer broadcast.

**Endpoint:** `POST /conference/<conference_id>/transcript`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `conference_id` | `string` | The UUID of the active conference. |

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `speaker` | `string` | Yes | The name of the participant speaking. |
| `text` | `string` | Yes | The transcribed text utterance. |

### Example Request

```bash
curl -X POST http://localhost:5000/conference/3fa85f64-5717-4562-b3fc-2c963f66afa6/transcript \
  -H "Content-Type: application/json" \
  -d '{"speaker": "Alice", "text": "I think we should ship the feature on Friday."}'
```

### Response Schema

**200 OK**
```json
{
  "status": "ok"
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **200** | Transcript chunk successfully ingested. |
| **400** | Bad Request. Missing `speaker` or `text` in payload. |
| **404** | Not Found. Unknown `conference_id`. |

---

## 4. Get Summary

Retrieves the post-conference summary and full transcript. Available after the conference ends.

**Endpoint:** `GET /conference/<conference_id>/summary`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `conference_id` | `string` | The UUID of the conference. |

### Example Request

```bash
curl -X GET http://localhost:5000/conference/3fa85f64-5717-4562-b3fc-2c963f66afa6/summary
```

### Response Schema

**200 OK**
```json
{
  "conference_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "started_at": 1698765432.11,
  "ended_at": 1698765998.45,
  "summary": "- Alice proposed shipping on Friday.\n- Bob agreed.\nAction items:\n- Alice to prepare release notes.",
  "transcript": [
    {
      "ts": "2023-10-31T12:00:00Z",
      "speaker": "Alice",
      "text": "I think we should ship the feature on Friday."
    }
  ]
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **200** | Summary retrieved successfully. |
| **404** | Not Found. Unknown `conference_id`. |

---

## 5. Transcript Stream (SSE)

Server-Sent Events (SSE) endpoint for observers to listen to the live transcript stream. 

**Endpoint:** `GET /conference/<conference_id>/stream`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `conference_id` | `string` | The UUID of the conference. |

### Example Request

```bash
curl -N http://localhost:5000/conference/3fa85f64-5717-4562-b3fc-2c963f66afa6/stream
```

### Response Schema

**200 OK** (`Content-Type: text/event-stream`)
```
data: {"ts": "2023-10-31T12:00:00Z", "speaker": "Alice", "text": "I think we should ship the feature on Friday."}

data: {"ts": "2023-10-31T12:00:05Z", "speaker": "Bob", "text": "Sounds good to me."}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **200** | SSE stream opened successfully. |
| **404** | Not Found. Unknown `conference_id`. |

---

## 6. Health Check

Returns the health status of the application and count of active conferences.

**Endpoint:** `GET /health`

### Example Request

```bash
curl -X GET http://localhost:5000/health
```

### Response Schema

**200 OK**
```json
{
  "status": "ok",
  "active_conferences": 2
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| **200** | Service is healthy and reachable. |
