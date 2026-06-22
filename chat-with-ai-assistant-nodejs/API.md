# API Reference

Typed reference for the HTTP routes exposed by `server.js` and the Telnyx API endpoints it calls.

## HTTP Endpoints

### `POST /chat`

Send a message to the AI Assistant identified by the `AI_ASSISTANT_ID` environment variable and return its response.

#### Request

```json
{
  "message": "What are your business hours?"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | **yes** | The user message to send to the assistant. Must contain at least one non-whitespace character. |

> The assistant is chosen by the `AI_ASSISTANT_ID` environment variable, not the request body.

#### Response `200`

```json
{
  "assistant_id": "assistant-1234abcd",
  "user_message": "What are your business hours?",
  "assistant_response": "We are open Monday to Friday, 9am to 5pm.",
  "timestamp": "2026-06-18T14:32:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `assistant_id` | `string` | ID of the assistant that handled the request |
| `user_message` | `string` | Echo of the submitted `message` |
| `assistant_response` | `string` | The assistant's reply (`response.content` from the Telnyx SDK) |
| `timestamp` | `string` | ISO 8601 timestamp of when the response was built |

**Try it:**

```bash
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are your business hours?"}'
```

---

### `GET /health`

Liveness check. Takes no parameters.

#### Response `200`

```json
{
  "status": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` when the server is up |

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Telnyx API Endpoints Called

| Method | Path | SDK call | Purpose |
|--------|------|----------|---------|
| `POST` | `/v2/ai/assistants/{assistant_id}/chat` | `client.ai.assistants.chat(assistantId, { messages })` | Send a `user` message to the assistant and receive a generated response |

The SDK request payload mirrors the chat schema:

```json
{
  "messages": [
    { "role": "user", "content": "What are your business hours?" }
  ]
}
```

See the [Chat with an Assistant API reference](https://developers.telnyx.com/api-reference/assistants/chat-with-an-assistant) for the full schema.

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning | Trigger |
|--------|---------|---------|
| `400` | Bad request | Missing `message`, empty/whitespace `message`, or other validation failure |
| `401` | Unauthorized | Invalid `TELNYX_API_KEY` (`Telnyx.AuthenticationError`) |
| `429` | Rate limited | Account rate limit exceeded (`Telnyx.RateLimitError`) |
| `500` | Server error | `AI_ASSISTANT_ID` not set, or an unspecified Telnyx API error (`Telnyx.APIError`) |
| `503` | Service unavailable | Network error reaching Telnyx (`Telnyx.APIConnectionError`) |
