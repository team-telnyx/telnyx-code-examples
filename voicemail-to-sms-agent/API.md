# API Reference — `voicemail-to-sms-agent`

This document defines the HTTP API contract for the Voicemail-to-SMS Agent Telnyx Edge application.

## Base URL

All endpoints are relative to your deployed Edge function base URL (e.g., `https://<func-id>.telnyxcompute.com`).

## Authentication

The webhook endpoint verifies the Telnyx Ed25519 signature header (`Telnyx-Signature-Ed25519`) and timestamp (`Telnyx-Timestamp`) on every inbound request using the `TELNYX_PUBLIC_KEY` env var. When the public key is not configured, verification is skipped in demo mode (`LIVE_MODE=false`) and unverified requests are rejected in live mode.
This document defines the HTTP API contract for the Voicemail-to-SMS Agent Telnyx Edge application. 

## Base URL

All endpoints are relative to your deployed Edge worker base URL (e.g., `https://your-worker.telnyx.app`).

## Authentication

Webhook endpoints are secured by verifying the Telnyx Ed25519 signature header (`telnyx-signature-ed25519`) and timestamp (`telnyx-signature-timestamp`) on every inbound request using the public key.

## Endpoints

### 1. Telnyx Webhook Receiver

Receives Telnyx webhooks (e.g., `call.recording.saved` after a voicemail is left). Triggers the `VoicemailAgent` to download the recording, transcribe it, summarize it via LLM, send an SMS to the mailbox owner, and archive the audio to Cloud Storage.
Receives Call Control webhooks from Telnyx. When a `call.status` event with `status = voicemail` is detected, it triggers the `VoicemailAgent` to download the audio, transcribe it, summarize it via LLM, send an SMS to the mailbox owner, and archive the audio to Cloud Storage.

**Endpoint:** `POST /webhook`

#### Request Body Schema

The endpoint expects a standard Telnyx webhook payload.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `event` | `string` | No | The event type (e.g., `call.recording.saved`). Informational — the agent processes any payload carrying recording metadata. |
| `data.payload.call_control_id` | `string` | Yes | Unique identifier for the Call Control session. |
| `data.payload.from` | `string` | No | The caller's phone number (included in the SMS summary). |
| `data.payload.recording_url` | `string` | Conditional | Direct URL to the voicemail audio. Preferred when present. |
| `data.payload.recording_id` | `string` | Conditional | Recording ID — resolved via `GET /v2/recordings/{id}` when `recording_url` is absent. |

Either `recording_url` or `recording_id` must be present.
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
curl -X POST https://<func-id>.telnyxcompute.com/webhook \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -d '{
    "event": "call.recording.saved",
    "data": {
      "payload": {
        "call_control_id": "v2:...",
        "from": "+15559876543",
        "recording_id": "rec-abc-123",
        "recording_url": "https://storage.telnyx.com/..."
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
  "status": "success",
  "recording_id": "rec-abc-123",
  "summary": "John called about tomorrow's 3pm meeting, asked you to confirm.",
  "sms_sent": false,
  "archived": false
}
```

`sms_sent` and `archived` are `false` in demo mode (`LIVE_MODE=false`); the SMS payload is logged instead.

  "status": "received"
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Voicemail processed successfully. |
| **400** | `Bad Request` - Malformed JSON body. |
| **401** | `Unauthorized` - Signature verification failed (or public key missing in live mode). |
| **500** | `Internal Server Error` - Processing failed (details logged server-side, not returned). |

---

### 2. List Processed Voicemails

Returns the most recent voicemails processed by the agent (persisted in actor storage, capped at 100).

**Endpoint:** `GET /voicemails`
| **200** | `OK` - Webhook successfully received and signature verified. Agent task is queued/started. |
| **400** | `Bad Request` - Signature verification failed or malformed payload. |
| **500** | `Internal Server Error` - Unhandled error during webhook processing. |

---

### 2. Health Check

Simple liveness probe for the Edge worker.

**Endpoint:** `GET /health`

#### Example Request

```bash
curl -X GET https://<func-id>.telnyxcompute.com/voicemails
curl -X GET https://your-worker.telnyx.app/health
```

#### Response Schema

```json
{
  "voicemails": [
    {
      "recording_id": "rec-abc-123",
      "caller": "+15559876543",
      "transcript_preview": "Hi, it's John. I wanted to confirm tomorrow's meeting...",
      "summary": "John called about tomorrow's 3pm meeting, asked you to confirm.",
      "sms_sent": true,
      "archived": true,
      "processed_at": "2026-09-02T16:45:00.000Z"
    }
  ]
  "status": "ok",
  "timestamp": 1696152345
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Returns the list (possibly empty). |

---

### 3. Agent Stats

Returns aggregate counters for processed voicemails.

**Endpoint:** `GET /stats`

#### Example Request

```bash
curl -X GET https://<func-id>.telnyxcompute.com/stats
```

#### Response Schema

```json
{
  "total_voicemails": 12,
  "sms_sent": 10,
  "archived": 9
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Returns the counters. |

---

### 4. Debug Events

Returns the last 20 recorded runtime events (webhook events, Call Control action results, pipeline steps and failures). Useful for diagnosing webhook/flow issues without access to function logs.

**Endpoint:** `GET /debug/events`

#### Example Request

```bash
curl -X GET https://<func-id>.telnyxcompute.com/debug/events
```

#### Response Schema

```json
{
  "events": [
    { "ts": "2026-09-03T00:56:21.876Z", "step": "sms_sent", "to": "+15551234567" },
    { "ts": "2026-09-03T00:56:03.647Z", "event": "call.recording.saved" },
    { "ts": "2026-09-03T00:55:40.000Z", "action": "record_start", "ok": true }
  ]
}
```

#### Status Codes

| Status Code | Description |
| :--- | :--- |
| **200** | `OK` - Returns the event list (possibly empty). |

---

### 5. Health Checks

Liveness/readiness probes for the Edge function.

**Endpoints:** `GET /health/liveness` and `GET /health/readiness`

#### Example Request

```bash
curl -X GET https://<func-id>.telnyxcompute.com/health/liveness
```

#### Response

Plain-text `ok` with HTTP 200.

## Behavior Notes

- **Duplicate suppression** — a dual-channel call produces multiple `call.recording.saved` webhooks (one per recording file). The agent dedupes by `recording_id` and by `call_session_id`, so one call produces at most one SMS.
- **Caller enrichment** — `call.recording.saved` payloads may omit the caller number; the agent falls back to the `from` captured at `call.initiated`.
- **Archiving is best-effort** — if the Cloud Storage binding/bucket is unavailable, processing continues (`archived: false`) and the failure is logged to `/debug/events`.
| **200** | `OK` - Worker is live and ready to receive traffic. |
| **500** | `Internal Server Error` - Worker is unresponsive or failing runtime checks. |
