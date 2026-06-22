## `POST /assistants/create`

Create a new Telnyx AI Assistant.

### Request

```json
{
  "name": "Support Bot",
  "instructions": "You are a friendly customer support agent for Acme Corp.",
  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
  "enabled_features": ["telephony", "messaging"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name for the assistant |
| `instructions` | `string` | **yes** | System prompt / persona for the assistant |
| `model` | `string` | **yes** | LLM model ID (e.g. `meta-llama/Meta-Llama-3.1-70B-Instruct`) |
| `enabled_features` | `string[]` | **yes** | Non-empty array of features: `"telephony"` and/or `"messaging"` |

### Response `201`

```json
{
  "id": "assistant-abc123",
  "name": "Support Bot",
  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
  "instructions": "You are a friendly customer support agent for Acme Corp.",
  "enabled_features": ["telephony", "messaging"],
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique assistant identifier |
| `name` | `string` | Display name as stored by Telnyx |
| `model` | `string` | LLM model ID assigned to the assistant |
| `instructions` | `string` | System prompt as stored by Telnyx |
| `enabled_features` | `string[]` | Features enabled on the assistant |
| `created_at` | `string` | ISO 8601 creation timestamp |

**Try it:**

```bash
curl -X POST http://localhost:5000/assistants/create \
  -H "Content-Type: application/json" \
  -d '{"name": "Support Bot", "instructions": "You are a friendly support agent.", "model": "meta-llama/Meta-Llama-3.1-70B-Instruct", "enabled_features": ["telephony"]}'
```

---

## `GET /health`

Liveness check. Takes no parameters.

### Response `200`

```json
{ "status": "ok" }
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Telnyx API Endpoints Called

| Method | Path | SDK call | Purpose |
|--------|------|----------|---------|
| `POST` | `/v2/ai/assistants` | `client.ai.assistants.create(...)` | Create a new AI assistant |

[Create an Assistant — API reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `201` | Assistant created |
| `400` | Bad request — missing/invalid fields or Telnyx `APIError` |
| `401` | Invalid API key (`AuthenticationError`) |
| `429` | Rate limit exceeded (`RateLimitError`) |
| `500` | Unhandled server error |
| `503` | Network error connecting to Telnyx (`APIConnectionError`) |
