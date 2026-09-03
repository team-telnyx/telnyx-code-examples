# API Reference — Edge LLM Semantic Cache

Typed endpoint reference for the `edge-llm-semantic-cache` Flask sample.

---

## Table of Contents

1. [GET /health](#get-health)
2. [POST /semantic-cache](#post-semantic-cache)
3. [POST /webhook](#post-webhook)

---

## GET /health

Returns the service health status and indicates whether the application is running in demo mode.

### Request

No request body.

### Example Request

```bash
curl -X GET http://localhost:5000/health
```

### Response Schema

| Field       | Type    | Description                                      |
|-------------|---------|--------------------------------------------------|
| `status`    | string  | Always `"ok"` when the service is healthy.       |
| `demo_mode` | boolean | `true` if the app is running in demo mode.       |

### Status Codes

| Code | Description                     |
|------|---------------------------------|
| 200  | Service is healthy.             |
| 500  | Internal server error.          |

### Example Response

```json
{
  "status": "ok",
  "demo_mode": true
}
```

---

## POST /semantic-cache

Accepts a user prompt, checks the in-memory semantic cache for a matching entry, and returns either the cached response or a newly generated response. In demo mode, generated responses are simulated; in live mode, this is where you would integrate with an LLM provider.

### Request Body Schema

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| `prompt` | string | Yes      | The user's question or prompt text to cache.     |

### Example Request

```bash
curl -X POST http://localhost:5000/semantic-cache \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is the capital of France?"}'
```

### Response Schema

| Field        | Type    | Description                                                        |
|--------------|---------|--------------------------------------------------------------------|
| `response`   | string  | The cached or generated response text.                             |
| `cached`     | boolean | `true` if the response was served from cache; `false` if generated.|
| `demo_mode`  | boolean | `true` if the app is running in demo mode.                         |

### Status Codes

| Code | Description                                                        |
|------|--------------------------------------------------------------------|
| 200  | Response returned successfully (cached or generated).              |
| 400  | Missing `prompt` field in the request body.                        |
| 500  | Internal server error during processing.                           |

### Example Response — Cache Miss

```json
{
  "response": "[Demo] Response to: What is the capital of France?",
  "cached": false,
  "demo_mode": true
}
```

### Example Response — Cache Hit

```json
{
  "response": "[Demo] Response to: What is the capital of France?",
  "cached": true,
  "demo_mode": true
}
```

### Example Response — Error

```json
{
  "error": "Missing 'prompt' in request body"
}
```

---

## POST /webhook

Telnyx webhook handler. Verifies the Ed25519 signature on incoming webhook payloads and processes Telnyx events (e.g., `message.received`). In demo mode, incoming SMS messages are logged but no reply is sent. In live mode, an SMS reply is sent via the Telnyx SDK.

### Request Headers

| Header                          | Type   | Required | Description                                              |
|---------------------------------|--------|----------|----------------------------------------------------------|
| `Telnyx-Signature-Ed25519`      | string | Yes      | Ed25519 signature of the webhook payload.                |
| `Telnyx-Signature-Timestamp`    | string | Yes      | Timestamp nonce used for signature verification.         |

### Request Body

The raw request body is the Telnyx webhook payload (JSON). It is passed directly to `telnyx.Webhook.construct_event` for signature verification and parsing. The structure follows the standard Telnyx webhook format:

| Field   | Type   | Description                                              |
|---------|--------|----------------------------------------------------------|
| `data`  | object | Contains the event `payload` and metadata.               |
| `type`  | string | The Telnyx event type (e.g., `message.received`).        |

### Example Request

```bash
curl -X POST http://localhost:5000/webhook \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <ed25519_signature>" \
  -H "Telnyx-Signature-Timestamp: <timestamp_nonce>" \
  -d '{"data":{"event_id":"evt_123","payload":{"from":{"phone_number":"+15551234567"},"to":[{"phone_number":"+15559999999"}],"text":"Hello"}},"type":"message.received"}'
```

### Response Schema

| Field    | Type   | Description                                              |
|----------|--------|----------------------------------------------------------|
| `status` | string | Always `"ok"` when the webhook is processed successfully.|

### Status Codes

| Code | Description                                                        |
|------|--------------------------------------------------------------------|
| 200  | Webhook processed successfully.                                    |
| 400  | Missing `Telnyx-Signature-Ed25519` or `Telnyx-Signature-Timestamp` header. |
| 403  | Signature verification failed (invalid or tampered payload).       |
| 500  | Internal server error during webhook processing.                   |

### Example Response — Success

```json
{
  "status": "ok"
}
```

### Example Response — Missing Headers

```json
{
  "error": "Missing signature headers"
}
```

### Example Response — Invalid Signature

```json
{
  "error": "Invalid signature"
}
```

### Example Response — Internal Error

```json
{
  "error": "Internal server error"
}
```

---

## Notes

- The semantic cache is an in-memory dictionary (`_cache`) keyed by the lowercased, stripped prompt text. It is suitable for demo purposes only. In production, replace with Redis, SQLite, or a vector database.
- The `/webhook` endpoint uses `telnyx.Webhook.construct_event` to verify the Ed25519 signature with a 300-second tolerance window.
- All error responses return generic messages; exception details are logged server-side via `app.logger.exception(...)` and never exposed to the client.
