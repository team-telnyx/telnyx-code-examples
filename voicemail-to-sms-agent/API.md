# API Reference

The `voicemail-to-sms-agent` exposes a minimal Flask API consisting of an inbound webhook receiver for Telnyx Call Control events and a health check endpoint.

## Endpoints

- [`POST /webhooks/voicemail`](#post-webhooksvoicemail)
- [`GET /health`](#get-health)

---

## `POST /webhooks/voicemail`

Receives Telnyx Call Control webhooks. The endpoint verifies the Telnyx Ed25519 signature, filters for `call.status` events where the status is `voicemail`, and triggers the `VoicemailAgent` to transcribe, summarize, SMS the summary, and archive the audio.

### Request Headers

| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `telnyx-signature-ed25519` | string | Yes | Telnyx Ed25519 webhook signature used for verification. |
| `Content-Type` | string | Yes | Typically `application/json`. |

### Request Body Schema

The body must be a raw Telnyx webhook event payload. The application reads the raw bytes (`request.get_data()`) to perform signature verification before parsing the JSON.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `data.event_type` | string | Yes | The type of Telnyx event. Must be `call.status` to be processed. |
| `data.payload.status` | string | Yes | The call status. Must be `voicemail` to be processed. |
| `data.payload.call_control_id` | string | Yes | Unique identifier for the call control session. |
| `data.payload.call_session_id` | string | No | Unique identifier for the overall call session. |
| `data.payload.recording_urls` | array[string] | Yes | List of URLs pointing to the voicemail audio recording. |
| `data.payload.from` | string | No | The caller's phone number (E.164 format). |

### Example Request

```bash
curl -X POST https://your-domain.com/webhooks/voicemail \
  -H "telnyx-signature-ed25519: $TELNYX_SIGNATURE" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.status",
      "payload": {
        "call_control_id": "v2:AgX9Jx1Z...",
        "call_session_id": "v2:AgX9Jx1Z-session...",
        "status": "voicemail",
        "from": "+13125551234",
        "recording_urls": [
          "https://storage.telnyx.com/recordings/voicemail-123.wav"
        ]
      }
    }
  }'
```

### Response Schema

#### `200 OK` - Event Processed or Ignored
Returned when the webhook is successfully verified and either processed as a voicemail or explicitly ignored because it did not match the `call.status` + `voicemail` criteria.

```json
{
  "status": "processed",
  "result": {
    "status": "ok",
    "transcript_length": 142,
    "summary_length": 85
  }
}
```

#### `401 Unauthorized` - Signature Verification Failed
Returned if the `telnyx-signature-ed25519` header is missing, invalid, or fails cryptographic verification against the `TELNYX_PUBLIC_KEY`.

```json
{
  "error": "Unauthorized"
}
```

#### `500 Internal Server Error` - Agent Failure
Returned if an unhandled exception occurs during `VoicemailAgent.onTask()` execution. Exception details are logged via `app.logger.exception()` but are not exposed in the response for security.

```json
{
  "error": "Internal error processing voicemail"
}
```

### Status Codes

| Status Code | Description |
| :--- | :--- |
| `200 OK` | Webhook verified. Event was either processed or safely ignored. |
| `401 Unauthorized` | Webhook signature verification failed. |
| `500 Internal Server Error` | An unexpected error occurred during agent processing. |

---

## `GET /health`

Simple liveness check for the Flask application. Useful for load balancers, uptime monitors, and container orchestration platforms.

### Request Body Schema

No request body required.

### Example Request

```bash
curl -X GET https://your-domain.com/health
```

### Response Schema

#### `200 OK` - Service Healthy

```json
{
  "status": "ok",
  "service": "voicemail-to-sms-agent"
}
```

### Status Codes

| Status Code | Description |
| :--- | :--- |
| `200 OK` | The service is running and reachable. |
| `404 Not Found` | The endpoint was not found (e.g., wrong path or port). |
| `500 Internal Server Error` | The Flask application failed to handle the request. |
