## `GET /assistants`

List all AI assistants in the Telnyx account.

### Request

No request body or query parameters. Send a plain `GET`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| — | — | — | This endpoint takes no parameters. |

### Response `200`

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "assistant-f5d7a7e0-1234-5678",
      "name": "Support Bot",
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "instructions": "You are a helpful support assistant.",
      "enabled_features": ["telephony"],
      "created_at": "2025-01-15T12:00:00Z"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | `true` when the list call succeeded |
| `count` | `number` | Number of assistants returned |
| `data` | `array` | Array of assistant objects (see below) |
| `data[].id` | `string` | Unique assistant identifier |
| `data[].name` | `string` | Assistant display name |
| `data[].model` | `string` | Underlying inference model |
| `data[].instructions` | `string` | System instructions / persona |
| `data[].enabled_features` | `array` | Features enabled on the assistant |
| `data[].created_at` | `string` | ISO 8601 creation timestamp |

**Try it:**

```bash
curl http://localhost:5000/assistants
```

---

## `GET /health`

Liveness probe.

### Request

No request body or parameters.

### Response `200`

```json
{
  "status": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` while the server is running |

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Telnyx API Endpoints Called

The server calls the following Telnyx API on your behalf via the Node.js SDK:

| SDK call | HTTP | Path | Reference |
|----------|------|------|-----------|
| `client.ai.assistants.list()` | `GET` | `/v2/ai/assistants` | [List Assistants](https://developers.telnyx.com/api-reference/assistants/get-assistants) |

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning | Source |
|--------|---------|--------|
| `200` | Success | — |
| `401` | Invalid API key | `Telnyx.AuthenticationError` |
| `429` | Rate limit exceeded | `Telnyx.RateLimitError` |
| `503` | Network error reaching Telnyx | `Telnyx.APIConnectionError` |
| `4xx`/`5xx` | Telnyx API error (passes through `error.status`) | `Telnyx.APIError` |
| `500` | Unexpected server error | catch-all |
