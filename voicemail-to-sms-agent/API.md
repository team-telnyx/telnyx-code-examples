# API Reference — `voicemail-to-sms-agent`

This document defines the HTTP API contract for the Voicemail-to-SMS Agent Telnyx Edge application. 

## Base URL

All endpoints are relative to your deployed Edge worker base URL (e.g., `https://your-worker.telnyx.app`).

## Authentication

Webhook endpoints are secured by verifying the Telnyx Ed25519 signature header (`telnyx-signature-ed25519`) and timestamp (`telnyx-signature-timestamp`) on every inbound request using the public key.

## Endpoints

### 1. Telnyx Webhook Receiver

Receives Call Control webhooks from Telnyx. When a `call.status` event with `status = voicemail` is detected, it triggers the `VoicemailAgent` to download the audio, transcribe it, summarize it via LLM, send an SMS to the mailbox owner, and archive the audio to Cloud Storage.

**Endpoint:** `POST /webhook`

#### Request Body Schema

The endpoint expects a standard Telnyx Call Control webhook payload.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `data` | `object` | Yes | The top-level webhook data container. |
| `data.event_type` | `string` | Yes | The type of event (e.g., `call.status`). |
| `data.payload` | `object` | Yes | The payload containing call details. |
| `data.payload.call_control_id` | `string` | Yes | Unique identifier for the Call Control session. |
| `data.payload.status` | `string` | Yes | The status of the call. The agent triggers on `voicemail`. |
| `data.payload.recording_urls` | `string[]` | No | URLs to the voicemail audio recording. |
| `data.payload.to` | `string` | Yes | The destination phone number (mailbox owner). |

#### Example Request

```bash
curl -X POST https://your-worker.telnyx.app/webhook \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-signature-timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "call.status",
      "payload": {
        "call_control_id": "v2:...",
        "status": "voicemail",
        "recording_urls": ["https://storage.telnyx.com/..."],
        "to": "+15551234567"
      }
    }
  }'
```

#### Response Schema

```json
{
  "status": "received"
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Webhook successfully received and signature verified. Agent task is queued/started. |
| **400** | `Bad Request` - Signature verification failed or malformed payload. |
| **500** | `Internal Server Error` - Unhandled error during webhook processing. |

---

### 2. Health Check

Simple liveness probe for the Edge worker.

**Endpoint:** `GET /health`

#### Example Request

```bash
curl -X GET https://your-worker.telnyx.app/health
```

#### Response Schema

```json
{
  "status": "ok",
  "timestamp": 1696152345
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Worker is live and ready to receive traffic. |
| **500** | `Internal Server Error` - Worker is unresponsive or failing runtime checks. |
