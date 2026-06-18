# API Reference — Run LLM inference on Telnyx — OpenAI-compatible chat completions API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/inference/chat` | Chat endpoint. |
| `POST` | `/inference/ask` | Ask endpoint. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /inference/chat`

Chat endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | `string` | **yes** | AI model name |
| `max_tokens` | `number` | no | Maximum tokens for AI response |
| `temperature` | `string` | no | Temperature |

### Response `200`

```json
{"error": "Request body must include "messages" array"}
```

---

## `POST /inference/ask`

Ask endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `system_prompt` | `string` | **yes** | System prompt |

### Response `200`

```json
{"error": "Request body must include "question""}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
