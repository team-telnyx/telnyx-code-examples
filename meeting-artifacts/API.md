# API Reference — Meeting-Bot Artifact Desk

Typed contract for every HTTP surface exposed by `app.py` (Flask) plus the Telnyx Meeting Sessions API endpoints the sample calls. All Telnyx calls go through the SDK request surface (`telnyx.Telnyx.request`) against `/v2/...` paths.

---

## Local Flask Routes

### `GET /health`

Liveness probe. Reports whether the process is running in demo mode.

**Request body:** none.

**Example request**

```bash
curl -s http://localhost:5000/health
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "status": "ok", "demo_mode": <boolean> }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Service is up. |
| `500` | Unhandled server error (logged via `app.logger.exception`). |

---

### `POST /webhooks/telnyx`

Telnyx webhook receiver. Handles `session_status_changed`, `artifact_completed`, and `artifact_failed`. When `TELNYX_PUBLIC_KEY` is set, the Ed25519 signature is verified with `telnyx.Webhook.construct_event`; otherwise the raw JSON body is parsed (demo mode).

**Request headers**

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `telnyx-signature-ed25519` | string | yes (when `TELNYX_PUBLIC_KEY` set) | Ed25519 signature over the raw body. |
| `telnyx-timestamp` | string | yes (when `TELNYX_PUBLIC_KEY` set) | Unix timestamp used in the signed payload. |
| `content-type` | string | yes | `application/json`. |

**Request body schema** (Telnyx event envelope)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | string | yes | One of `session_status_changed`, `artifact_completed`, `artifact_failed`. |
| `data.payload.session_id` | string | yes | Meeting session the event refers to. |
| `data.payload.status` | string | no | Present on `session_status_changed` (`joining`, `waiting_for_admission`, `active`, `leaving`, `ended`, `failed`, `admission_denied`). |
| `data.payload.artifact_id` | string | no | Present on artifact events. |
| `data.payload.artifact_type` | string | no | `summary`, `action_items`, `decisions`, `topics`, `open_questions`, `custom`. |
| `data.payload.failure_reason` | string | no | Present on `artifact_failed`. |

**Example request**

```bash
curl -s -X POST http://localhost:5000/webhooks/telnyx \
  -H 'content-type: application/json' \
  -H 'telnyx-signature-ed25519: <signature>' \
  -H 'telnyx-timestamp: 1730000000' \
  -d '{
    "data": {
      "event_type": "artifact_completed",
      "payload": {
        "session_id": "sess_abc123",
        "artifact_id": "art_001",
        "artifact_type": "summary"
      }
    }
  }'
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "received": true }` |
| `400` | `{ "error": "invalid signature" }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Event accepted and logged. |
| `400` | Signature verification failed or body was not valid JSON. |
| `500` | Unhandled server error (logged via `app.logger.exception`). |

---

## Telnyx Meeting Sessions API (called by the sample)

### `POST /v2/meeting_sessions`

Create a meeting session and attach an AI assistant by ID. In demo mode (`DEMO_MODE=true`) the payload is logged and a synthetic session is returned.

**Request body schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meeting_url` | string | yes | Meeting URL (e.g. `https://meet.google.com/abc-defg-hij`). |
| `assistant` | object | yes | `{ "id": "<assistant_id>" }` — assistant attached by ID only. Legacy call-control/SIP fields (`connection_id`, `from`, `to`, `call_control_id`, `sip_uri`, `sip_username`) are rejected. |
| `audio_gate` | string | no | `half_duplex` (default) or `full_duplex`. `full_duplex` multiplies per-minute cost by participant count. |
| `leave_on_end` | boolean | no | Default `true`. When `false`, the bot stays after the assistant stops. |
| `webhook_url` | string | no | HTTPS endpoint receiving `session_status_changed` / `artifact_completed` / `artifact_failed`. |
| `dynamic_variables` | object | no | Up to 63 entries; keys 1–128 chars, string values. Reserved keys `streaming_audio`, `ai_assistant_streaming_audio`, `meeting_session_id` are rejected with `400 invalid_request`. |
| `join_at` | string (ISO 8601) | no | Scheduled join time. |
| `metadata` | object | no | Arbitrary key/value metadata. |
| `avatar` | object | no | Beta avatar configuration. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/meeting_sessions \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "meeting_url": "https://meet.google.com/abc-defg-hij",
    "assistant": { "id": "assistant_123" },
    "audio_gate": "half_duplex",
    "leave_on_end": true,
    "webhook_url": "https://example.com/webhooks/telnyx",
    "dynamic_variables": { "visitor_name": "Demo Visitor" }
  }'
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `201` | `{ "id": "<session_id>", "status": "joining", "joined_at": null, "join_at": null, "ended_at": null, "failure_reason": null }` |
| `202` | Accepted for scheduled join (`join_at` in the future). |

**Status codes**

| Code | Meaning |
|------|---------|
| `201` | Session created. |
| `202` | Session accepted for scheduled join. |
| `400` | Invalid request — reserved `dynamic_variables` key, legacy call-control field, or malformed payload. |
| `404` | Assistant ID not found. |
| `500` | Upstream error. |

---

### `GET /v2/meeting_sessions/{id}`

Poll session lifecycle. The sample calls this in `wait_for_active` until the status leaves `joining` / `waiting_for_admission`.

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Meeting session ID. |

**Example request**

```bash
curl -s https://api.telnyx.com/v2/meeting_sessions/sess_abc123 \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "id": "<session_id>", "status": "active", "joined_at": "<iso8601>", "join_at": "<iso8601>", "ended_at": null, "failure_reason": null }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Session found. |
| `404` | Session not found. |
| `500` | Upstream error. |

---

### `POST /v2/meeting_sessions/{id}/artifacts`

Request an artifact asynchronously. Always returns `202 Accepted`; completion or failure is delivered by webhook (`artifact_completed` / `artifact_failed`) or observed via polling.

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Meeting session ID. |

**Request body schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | One of `summary`, `action_items`, `decisions`, `topics`, `open_questions`, `custom`. |

**Example request**

```bash
curl -s -X POST https://api.telnyx.com/v2/meeting_sessions/sess_abc123/artifacts \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'content-type: application/json' \
  -d '{ "type": "summary" }'
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `202` | `{ "id": "<artifact_id>", "type": "summary", "status": "pending" }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `202` | Artifact request accepted; processing asynchronously. |
| `400` | Invalid artifact type or malformed body. |
| `404` | Session not found. |
| `500` | Upstream error. |

---

### `GET /v2/meeting_sessions/{id}/artifacts`

List artifacts for a session. Used by the `--poll` fallback path (`poll_artifacts`) every 10 seconds until every artifact is `completed` or `failed`.

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Meeting session ID. |

**Example request**

```bash
curl -s https://api.telnyx.com/v2/meeting_sessions/sess_abc123/artifacts \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "artifacts": [ { "id": "<artifact_id>", "type": "summary", "status": "completed", "content": "<text>", "failure_reason": null } ] }` |

Artifact `status` values: `pending`, `completed`, `failed`. On `failed`, `failure_reason` is populated and surfaced in `meeting_record.md`.

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Artifact list returned. |
| `404` | Session not found. |
| `500` | Upstream error. |

---

### `GET /v2/meeting_sessions/{id}/artifacts/{artifact_id}`

Fetch a single artifact by ID.

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Meeting session ID. |
| `artifact_id` | string | yes | Artifact ID returned by the create call. |

**Example request**

```bash
curl -s https://api.telnyx.com/v2/meeting_sessions/sess_abc123/artifacts/art_001 \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "id": "art_001", "type": "summary", "status": "completed", "content": "<text>", "failure_reason": null }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Artifact found. |
| `404` | Session or artifact not found. |
| `500` | Upstream error. |

---

### `GET /v2/meeting_sessions/{id}/transcript`

Fetch the full transcript. Written to `transcript.txt` alongside `meeting_record.md`.

**Path parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Meeting session ID. |

**Example request**

```bash
curl -s https://api.telnyx.com/v2/meeting_sessions/sess_abc123/transcript \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

**Response schema**

| Status | JSON shape |
|--------|------------|
| `200` | `{ "transcript": "<full transcript text>" }` |

**Status codes**

| Code | Meaning |
|------|---------|
| `200` | Transcript returned. |
| `404` | Session not found. |
| `500` | Upstream error. |

---

## Webhook Events (outbound from Telnyx)

| Event | Trigger | Key payload fields |
|-------|---------|--------------------|
| `session_status_changed` | Session transitions between `joining`, `waiting_for_admission`, `active`, `leaving`, `ended`, `failed`, `admission_denied`. | `session_id`, `status`, `joined_at`, `ended_at`, `failure_reason` |
| `artifact_completed` | Artifact finished processing. | `session_id`, `artifact_id`, `artifact_type`, `content` |
| `artifact_failed` | Artifact could not be produced (e.g. content cannot support the requested type). | `session_id`, `artifact_id`, `artifact_type`, `failure_reason` |

All events arrive at `POST /webhooks/telnyx` and are verified with the Ed25519 signature when `TELNYX_PUBLIC_KEY` is configured.
