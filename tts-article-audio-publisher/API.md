# API Reference — tts-article-audio-publisher

This document describes the HTTP endpoints exposed by the Flask application. All endpoints accept and return JSON.

---

## Endpoints

| Method | Path       | Description                                                                 |
|--------|------------|-----------------------------------------------------------------------------|
| GET    | `/health`  | Health-check endpoint. Returns service status and whether demo mode is active. |
| POST   | `/publish` | Accepts an article (text) and publishes it as audio via Telnyx TTS. In demo mode, logs the action without making real API calls. |
| POST   | `/webhook` | Handles inbound Telnyx webhooks. Verifies the Ed25519 signature and processes the event. |

---

## GET `/health`

### Request

No request body.

### Example Request

```bash
curl -X GET http://localhost:5000/health
```

### Response Schema

| Field       | Type    | Description                                      |
|-------------|---------|--------------------------------------------------|
| `status`    | string  | Always `"ok"`.                                   |
| `demo_mode` | boolean | Whether the application is running in demo mode. |

### Example Response

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status Codes

| Code | Description         |
|------|---------------------|
| 200  | Service is healthy. |

---

## POST `/publish`

### Request Body Schema

| Field              | Type   | Required | Description                                                                 |
|--------------------|--------|----------|-----------------------------------------------------------------------------|
| `article_text`     | string | Yes      | The full text of the article to be converted to speech and published.      |
| `destination_number` | string | No       | The E.164-formatted phone number to call. Defaults to `TELNYX_PHONE_NUMBER` if omitted. |

### Example Request

```bash
curl -X POST http://localhost:5000/publish \
  -H "Content-Type: application/json" \
  -d '{
    "article_text": "Hello, this is a test article being published as audio.",
    "destination_number": "+1555XXXXXXXX"
  }'
```

### Response Schema

#### Demo Mode (`DEMO_MODE=true`)

| Field               | Type   | Description                                      |
|---------------------|--------|--------------------------------------------------|
| `status`            | string | Always `"demo"`.                                 |
| `message`           | string | Human-readable confirmation message.             |
| `destination_number`| string | The destination phone number.                    |
| `voice`             | string | The TTS voice used.                              |
| `language`          | string | The TTS language used.                           |
| `article_length`    | integer| The character length of the article text.        |

**Example Response (Demo Mode)**

```json
{
  "status": "demo",
  "message": "Article audio published (demo mode)",
  "destination_number": "+1555XXXXXXXX",
  "voice": "male",
  "language": "en-US",
  "article_length": 56
}
```

#### Live Mode (`DEMO_MODE=false`)

| Field              | Type   | Description                                      |
|--------------------|--------|--------------------------------------------------|
| `status`           | string | Always `"published"`.                            |
| `call_id`          | string | The Telnyx call identifier.                      |
| `message`          | string | Human-readable confirmation message.             |
| `destination_number`| string | The destination phone number.                    |

**Example Response (Live Mode)**

```json
{
  "status": "published",
  "call_id": "call_abc123",
  "message": "Article audio published via Telnyx TTS",
  "destination_number": "+1555XXXXXXXX"
}
```

### Status Codes

| Code | Description                                                                 |
|------|-----------------------------------------------------------------------------|
| 200  | Article audio published successfully (demo or live).                        |
| 400  | `article_text` or `destination_number` is missing from the request body.    |
| 500  | Internal server error (e.g., Telnyx API key not configured, API failure).   |

---

## POST `/webhook`

### Request

This endpoint is invoked by Telnyx to deliver real-time call events. The request body is the raw webhook payload. The Telnyx SDK verifies the Ed25519 signature using the `Telnyx-Signature` and `Telnyx-Timestamp` headers.

#### Headers

| Header              | Type   | Required | Description                                      |
|---------------------|--------|----------|--------------------------------------------------|
| `Telnyx-Signature`  | string | Yes      | Ed25519 signature of the webhook payload.        |
| `Telnyx-Timestamp`  | string | Yes      | Timestamp used in signature verification.        |

### Example Request

```bash
curl -X POST http://localhost:5000/webhook \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature: t=1699999999,s=signature_hex" \
  -H "Telnyx-Timestamp: 1699999999" \
  -d '{
    "data": {
      "event_type": "call.started",
      "payload": {
        "call_id": "call_abc123"
      }
    }
  }'
```

### Response Schema

| Field   | Type   | Description                          |
|---------|--------|--------------------------------------|
| `status`| string | Always `"ok"` on successful processing. |

**Example Response**

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description                                                                 |
|------|-----------------------------------------------------------------------------|
| 200  | Webhook processed successfully.                                             |
| 401  | Webhook signature verification failed.                                      |
| 500  | Internal server error (e.g., Telnyx API key not configured, processing error). |

### Webhook Event Types

The following Telnyx event types are handled by this endpoint:

| Event Type               | Description                                           |
|--------------------------|-------------------------------------------------------|
| `call.started`           | A call has been initiated.                            |
| `call.answered`          | The destination party answered the call.              |
| `call.completed`         | The call has ended.                                   |
| `call.recording.created` | A recording has been created for the call.            |

---

## Environment Variables

The application reads the following environment variables (typically set in a `.env` file):

| Variable              | Required | Default   | Description                                              |
|-----------------------|----------|-----------|----------------------------------------------------------|
| `TELNYX_API_KEY`      | Yes (live mode) | —     | Your Telnyx API key.                                     |
| `TELNYX_PHONE_NUMBER` | Yes (live mode) | —     | Your Telnyx phone number (E.164 format).                 |
| `TELNYX_WEBHOOK_URL`  | No       | `""`      | Publicly accessible URL where Telnyx sends webhooks.     |
| `TTS_VOICE`           | No       | `"male"`  | The TTS voice to use (e.g., `male`, `female`).           |
| `TTS_LANGUAGE`        | No       | `"en-US"` | The TTS language/locale (e.g., `en-US`, `es-ES`).        |
| `DEMO_MODE`           | No       | `"true"`  | When `true`, no real API calls are made.                 |
| `PORT`                | No       | `5000`    | The port on which the Flask app listens.                 |
