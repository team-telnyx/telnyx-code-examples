# API Reference — Persistent AI Agent Memory Demo

This document describes the Telnyx Agent Memory API endpoints consumed by the `persistent-ai-agent-memory` CLI sample. The sample calls these endpoints directly via HTTP (`requests`), mirroring the documented curl requests 1:1. No SDK wrapper exists for this beta.

**Base URL:** `https://api.telnyx.com/v2/ai/memory`

**Authentication:** Bearer token (`Authorization: Bearer <TELNYX_API_KEY>`)

---

## 1. Ingest Transcript

Accepts a conversation transcript for a given profile and queues an asynchronous extraction operation.

### Endpoint

```
POST /namespaces/{namespace}/profiles/{profile_id}/ingest
```

### Path Parameters

| Parameter     | Type   | Required | Description                                                                 |
|---------------|--------|----------|-----------------------------------------------------------------------------|
| `namespace`   | string | Yes      | Isolation boundary for the demo app. Reuses `default`. Percent-encoded.    |
| `profile_id`  | string | Yes      | The specific user entity whose memory is being tested (e.g. `user_123`). Percent-encoded. |

### Query Parameters

| Parameter    | Type   | Required | Constraints                                                                 | Description                                                                 |
|--------------|--------|----------|-----------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| `session_id` | string | No       | ≤ 128 characters. Re-sending the same `session_id` re-ingests in place.     | Optional session identifier for retry-safe re-ingestion.                    |

### Request Body Schema

| Field      | Type                             | Required | Description                                                                 |
|------------|----------------------------------|----------|-----------------------------------------------------------------------------|
| `messages` | array of message objects         | Yes      | Ordered list of conversation messages.                                      |

#### Message Object Schema

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| `role`   | string | Yes      | One of `"user"` or `"assistant"`.                |
| `content`| string | Yes      | The text content of the message.                 |

### Example Request (curl)

```bash
curl -X POST \
  "https://api.telnyx.com/v2/ai/memory/namespaces/default/profiles/user_123/ingest?session_id=demo-session-001" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hi, I'\''m having trouble with my Telnyx SMS messaging."},
      {"role": "assistant", "content": "I'\''m sorry to hear that. Can you tell me more about the issue?"},
      {"role": "user", "content": "Messages are failing to send to some international destinations."},
      {"role": "assistant", "content": "Let me check your account configuration. What'\''s your account ID?"},
      {"role": "user", "content": "My account ID is AC-1234567890."},
      {"role": "assistant", "content": "Thanks. I see the issue — you need to enable international routing."},
      {"role": "user", "content": "Got it. By the way, my preferred contact method is email at user@example.com."},
      {"role": "assistant", "content": "Noted. I'\''ve enabled international routing for your account. You should be all set."}
    ]
  }'
```

### Response Schema (202 Accepted)

| Field          | Type   | Description                                                                 |
|----------------|--------|-----------------------------------------------------------------------------|
| `data`         | object | Contains the operation tracking information.                                |

#### `data` Object

| Field          | Type   | Description                                                                 |
|----------------|--------|-----------------------------------------------------------------------------|
| `operation_id` | string | The async job ID used for polling.                                          |
| `profile_id`   | string | The profile the transcript was ingested for.                                |
| `session_id`   | string | The session_id from the request (if provided).                              |
| `source_id`    | string | Identifier for the ingested source transcript.                              |

### Example Response (202)

```json
{
  "data": {
    "operation_id": "op_abc123",
    "profile_id": "user_123",
    "session_id": "demo-session-001",
    "source_id": "src_def456"
  }
}
```

### Status Codes

| Code | Meaning                                                                 |
|------|-------------------------------------------------------------------------|
| 202  | Accepted — the ingest request was queued successfully.                  |
| 400  | Bad Request — malformed body, invalid `session_id` length, etc.         |
| 401  | Unauthorized — missing or invalid API key.                              |
| 404  | Not Found — namespace or profile does not exist.                        |
| 500  | Internal Server Error — server-side failure during ingestion.           |

---

## 2. Poll Operation Status

Retrieves the status of an asynchronous ingest operation.

### Endpoint

```
GET /namespaces/{namespace}/operations/{operation_id}
```

### Path Parameters

| Parameter        | Type   | Required | Description                                                                 |
|------------------|--------|----------|-----------------------------------------------------------------------------|
| `namespace`      | string | Yes      | Isolation boundary. Reuses `default`. Percent-encoded.                     |
| `operation_id`   | string | Yes      | The operation ID returned from the ingest endpoint. Percent-encoded.        |

### Query Parameters

_None._

### Request Body

_None._

### Example Request (curl)

```bash
curl -X GET \
  "https://api.telnyx.com/v2/ai/memory/namespaces/default/operations/op_abc123" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Accept: application/json"
```

### Response Schema (200 OK)

| Field | Type   | Description                                                                 |
|-------|--------|-----------------------------------------------------------------------------|
| `data`| object | Contains the operation status and timestamps.                               |

#### `data` Object

| Field          | Type   | Description                                                                 |
|----------------|--------|-----------------------------------------------------------------------------|
| `operation_id` | string | The operation ID being polled.                                              |
| `status`       | string | One of: `pending`, `processing`, `completed`, `failed`, `cancelled`.        |
| `created_at`   | string | ISO 8601 timestamp when the operation was created.                          |
| `completed_at` | string | ISO 8601 timestamp when the operation reached a terminal status.            |

### Example Response (200)

```json
{
  "data": {
    "operation_id": "op_abc123",
    "status": "completed",
    "created_at": "2026-10-05T12:00:00Z",
    "completed_at": "2026-10-05T12:00:05Z"
  }
}
```

### Status Codes

| Code | Meaning                                                                 |
|------|-------------------------------------------------------------------------|
| 200  | OK — the operation status was retrieved successfully.                   |
| 400  | Bad Request — malformed operation_id.                                   |
| 401  | Unauthorized — missing or invalid API key.                              |
| 404  | Not Found — operation_id or namespace does not exist.                   |
| 500  | Internal Server Error — server-side failure during polling.             |

### Polling Behavior

- **Non-terminal statuses:** `pending`, `processing` — the client should continue polling.
- **Terminal statuses:** `completed`, `failed`, `cancelled` — polling stops.
- The sample polls every 2 seconds with a 60-second timeout.

---

## 3. Recall Facts

Queries the extracted memory facts for a given profile, ranked by relevance.

### Endpoint

```
POST /namespaces/{namespace}/profiles/{profile_id}/recall
```

### Path Parameters

| Parameter     | Type   | Required | Description                                                                 |
|---------------|--------|----------|-----------------------------------------------------------------------------|
| `namespace`   | string | Yes      | Isolation boundary. Reuses `default`. Percent-encoded.                     |
| `profile_id`  | string | Yes      | The user entity whose memory is being queried (e.g. `user_123`). Percent-encoded. |

### Query Parameters

_None._

### Request Body Schema

| Field    | Type   | Required | Constraints                          | Description                                      |
|----------|--------|----------|--------------------------------------|--------------------------------------------------|
| `query`  | string | Yes      | 1–4096 characters                    | The natural language question to answer.         |
| `top_k`  | integer| Yes      | 1–100                                  | Maximum number of ranked facts to return.        |

### Example Request (curl)

```bash
curl -X POST \
  "https://api.telnyx.com/v2/ai/memory/namespaces/default/profiles/user_123/recall" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the user'\''s preferred contact method?",
    "top_k": 10
  }'
```

### Response Schema (200 OK)

| Field | Type             | Description                                                                 |
|-------|------------------|-----------------------------------------------------------------------------|
| `data`| array of objects | Ranked list of memory facts, most relevant first.                           |

#### Fact Object Schema

| Field         | Type   | Description                                                                 |
|---------------|--------|-----------------------------------------------------------------------------|
| `id`          | string | Unique identifier for the memory fact (e.g. `mem_...`).                     |
| `text`        | string | The extracted fact text.                                                    |
| `recorded_at` | string | ISO 8601 timestamp when the fact was recorded.                              |
| `score`       | number | Relevance score (0.0–1.0). Higher = more relevant.                          |

### Example Response (200)

```json
{
  "data": [
    {
      "id": "mem_xyz789",
      "text": "The user's preferred contact method is email at user@example.com.",
      "recorded_at": "2026-10-05T12:00:05Z",
      "score": 0.92
    },
    {
      "id": "mem_abc123",
      "text": "The user's account ID is AC-1234567890.",
      "recorded_at": "2026-10-05T12:00:05Z",
      "score": 0.45
    }
  ]
}
```

### Status Codes

| Code | Meaning                                                                 |
|------|-------------------------------------------------------------------------|
| 200  | OK — the recall query was processed and facts were returned.            |
| 400  | Bad Request — invalid `query` length, `top_k` out of range, etc.        |
| 401  | Unauthorized — missing or invalid API key.                              |
| 404  | Not Found — namespace or profile does not exist.                        |
| 500  | Internal Server Error — server-side failure during recall.              |

### Recall Behavior

- Results are **ranked by relevance**, most relevant first.
- If the ingest operation has not yet completed, the recall may return an empty list, demonstrating the asynchronous nature of the API.
- The sample reads results in rank order and displays them with their scores.

---

## Summary of Endpoints

| # | Method | Path                                                                 | Purpose                          |
|---|--------|----------------------------------------------------------------------|----------------------------------|
| 1 | POST   | `/namespaces/{ns}/profiles/{id}/ingest`                              | Queue a transcript for extraction|
| 2 | GET    | `/namespaces/{ns}/operations/{operation_id}`                         | Poll async operation status      |
| 3 | POST   | `/namespaces/{ns}/profiles/{id}/recall`                              | Query ranked memory facts        |

All path segments (`namespace`, `profile_id`, `operation_id`) are percent-encoded using `urllib.parse.quote(segment, safe="")` to handle reserved characters.
