# API Reference — AI Avatar Conversation Desk

Typed contract for every HTTP route exposed by `app.py`, plus the outbound Telnyx
endpoints the sample calls on your behalf. All routes are served by the Flask app
(`python app.py`, default port `5000`).

Base URL (local): `http://localhost:5000`

All request and response bodies are JSON unless noted. Errors return a single
`error` string field — internal exception details are logged server-side and never
returned to the client.

---

## `GET /health`

Liveness probe. Reports whether the process is running in demo mode.

### Request

No parameters, no body.

### Example request

```bash
curl -s http://localhost:5000/health
```

### Response — `200 OK`

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"ok"` when the process is up. |
| `demo_mode` | boolean | `true` when `DEMO_MODE` is enabled — no real Telnyx calls are made. |

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Process is up. |

---

## `POST /avatars`

Validates a portrait image against the documented avatar constraints and uploads it
to `POST /v2/ai/avatars` as `multipart/form-data`. Returns the created avatar record.
The `id` field is the value you must pass to `POST /assistants` — never `image_url`.

### Request

`Content-Type: multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `image_file` | file | yes | Portrait image. JPEG, PNG, or WebP. Max 10 MiB. 256–8192 px per side. Max 40 MP total. |
| `name` | string | yes | Avatar name. 1–255 characters after trimming. |

Validation runs **before** any network call. A rejected image never reaches Telnyx.

### Example request

```bash
curl -s -X POST http://localhost:5000/avatars \
  -F "image_file=@./portrait.png;type=image/png" \
  -F "name=Desk Portrait"
```

### Response — `201 Created`

| Field | Type | Description |
|---|---|---|
| `id` | string | Avatar ID. **Use this** when wiring the assistant. |
| `name` | string | Avatar name as stored. |
| `width` | integer | Validated image width in pixels. |
| `height` | integer | Validated image height in pixels. |
| `bytes` | integer | Validated image size in bytes. |
| `demo` | boolean | Present and `true` only in demo mode. |

```json
{
  "id": "avatar_demo_0001",
  "name": "Desk Portrait",
  "width": 1024,
  "height": 1024,
  "bytes": 284913,
  "demo": true
}
```

### Response — `400 Bad Request`

Returned when `image_file` is missing, the name is out of range, or the image fails
any constraint check.

```json
{ "error": "image exceeds 10 MiB limit" }
```

Possible `error` values:

| Message | Cause |
|---|---|
| `image_file is required` | No file part in the multipart body. |
| `name must be 1-255 characters` | Empty or over-long name. |
| `image must be JPEG, PNG, or WebP` | MIME type and extension both unrecognized. |
| `image file is empty` | Zero-byte upload. |
| `image exceeds 10 MiB limit` | File larger than 10 MiB. |
| `could not read image dimensions (corrupt or unsupported)` | Header parse failed. |
| `width {n}px outside 256-8192px` | Width out of range. |
| `height {n}px outside 256-8192px` | Height out of range. |
| `image is {n}px, over 40000000px total` | Total pixel count over 40 MP. |

### Response — `502 Bad Gateway`

Telnyx rejected the upload or was unreachable. Details are logged, not returned.

```json
{ "error": "avatar upload failed" }
```

### Status codes

| Code | Meaning |
|---|---|
| `201` | Avatar created (or simulated in demo mode). |
| `400` | Validation failed — see the table above. |
| `502` | Upstream Telnyx error. |

---

## `POST /assistants`

Creates or updates an AI Assistant with `avatar_settings` pointing at the supplied
avatar ID, then reads the configuration back and returns it. Passing an
`assistant_id` updates that assistant; omitting it creates a new one.

### Request

`Content-Type: application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| `avatar_id` | string | yes | The `id` from `POST /avatars`. Must not be a URL — values starting with `http` are rejected. |
| `assistant_id` | string | no | Existing assistant to update. Omit to create a new assistant. |

The assistant body is assembled from environment variables:

| Env var | Default | Used as |
|---|---|---|
| `ASSISTANT_NAME` | `Avatar Desk Assistant` | `name` |
| `ASSISTANT_MODEL` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | `model` |
| `ASSISTANT_INSTRUCTIONS` | `You are a friendly restaurant host. Keep replies short and spoken.` | `instructions` |
| `TELNYX_TTS_VOICE` | `Telnyx.KokoroTTS.af` | `voice_settings.voice` |

`avatar_settings` is always written as:

```json
{
  "provider": "telnyx",
  "model": "foxtrot-1",
  "avatar_id": "<avatar_id>"
}
```

### Example request

```bash
curl -s -X POST http://localhost:5000/assistants \
  -H "Content-Type: application/json" \
  -d '{"avatar_id": "avatar_demo_0001"}'
```

Update an existing assistant:

```bash
curl -s -X POST http://localhost:5000/assistants \
  -H "Content-Type: application/json" \
  -d '{"avatar_id": "avatar_demo_0001", "assistant_id": "assistant_abc123"}'
```

### Response — `200 OK`

The assistant record as read back from `GET /v2/ai/assistants/{id}`.

| Field | Type | Description |
|---|---|---|
| `id` | string | Assistant ID. Pass this to `POST /session`. |
| `avatar_settings` | object | `{provider, model, avatar_id}` as written. |
| `demo` | boolean | Present and `true` only in demo mode. |

```json
{
  "id": "assistant_demo_0001",
  "avatar_settings": {
    "provider": "telnyx",
    "model": "foxtrot-1",
    "avatar_id": "avatar_demo_0001"
  },
  "demo": true
}
```

### Response — `400 Bad Request`

```json
{ "error": "avatar_id is required" }
```

| Message | Cause |
|---|---|
| `avatar_id is required` | Field missing or empty. |
| `avatar_id must be the avatar data.id, not an image URL` | Value starts with `http`. |

### Response — `502 Bad Gateway`

```json
{ "error": "assistant wiring failed" }
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Assistant created or updated. |
| `400` | Missing or malformed `avatar_id`. |
| `502` | Upstream Telnyx error. |

---

## `POST /session`

Opens the avatar conversation WebSocket and drives the full handshake:
`session.update` first, then the avatar signaling exchange, then
`avatar.media.ready`. Returns an event log proving the ordering and reporting which
failure path (if any) was exercised.

Two flags reproduce the documented failure taxonomy:

- `break_media` — skips `avatar.media.ready`, producing a fatal `1011` close.
- `inject_error` — simulates a non-fatal `avatar.error`, switching playback to the
  `response.output_audio.delta` voice-only fallback without closing the socket.

### Request

`Content-Type: application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| `assistant_id` | string | yes | Assistant ID from `POST /assistants`. |
| `break_media` | boolean | no | Skip `avatar.media.ready` to trigger the fatal `1011` path. Default `false`. |
| `inject_error` | boolean | no | Simulate a non-fatal `avatar.error` to trigger the voice-only fallback. Default `false`. |

### Example request

Normal session:

```bash
curl -s -X POST http://localhost:5000/session \
  -H "Content-Type: application/json" \
  -d '{"assistant_id": "assistant_demo_0001"}'
```

Fatal path:

```bash
curl -s -X POST http://localhost:5000/session \
  -H "Content-Type: application/json" \
  -d '{"assistant_id": "assistant_demo_0001", "break_media": true}'
```

Fallback path:

```bash
curl -s -X POST http://localhost:5000/session \
  -H "Content-Type: application/json" \
  -d '{"assistant_id": "assistant_demo_0001", "inject_error": true}'
```

### Response — `200 OK`

| Field | Type | Description |
|---|---|---|
| `event_log` | string[] | Ordered log of frames sent and received, plus any failure annotations. |
| `session_update_first` | boolean | `true` when `session.update` was the first frame sent. |
| `media_ready_before_session_created` | boolean | `true` when `avatar.media.ready` was sent before `session.created` arrived. |
| `fallback_active` | boolean | `true` when a non-fatal `avatar.error` switched playback to voice-only. |
| `fatal_1011` | boolean | `true` when the socket closed with `1011` or a fatal error was logged. |

```json
{
  "event_log": [
    "sent session.update (first frame)",
    "recv session.created",
    "recv avatar.signaling.offer",
    "answered avatar signaling frame",
    "sent avatar.media.ready",
    "recv response.output_audio.delta"
  ],
  "session_update_first": true,
  "media_ready_before_session_created": false,
  "fallback_active": false,
  "fatal_1011": false
}
```

Fatal path (`break_media: true`):

```json
{
  "event_log": [
    "sent session.update (first frame)",
    "recv session.created",
    "FATAL: session.created before avatar.media.ready",
    "socket closed: ConnectionClosedError"
  ],
  "session_update_first": true,
  "media_ready_before_session_created": false,
  "fallback_active": false,
  "fatal_1011": true
}
```

Fallback path (`inject_error: true`):

```json
{
  "event_log": [
    "sent session.update (first frame)",
    "recv session.created",
    "sent avatar.media.ready",
    "recv avatar.error",
    "avatar.error non-fatal -> voice-only fallback",
    "recv response.output_audio.delta",
    "audio delta (voice-only path)"
  ],
  "session_update_first": true,
  "media_ready_before_session_created": false,
  "fallback_active": true,
  "fatal_1011": false
}
```

### Response — `400 Bad Request`

```json
{ "error": "assistant_id is required" }
```

### Response — `502 Bad Gateway`

Returned when the WebSocket cannot be opened or the session raises before the log
is produced.

```json
{ "error": "avatar session failed" }
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Session ran to completion; inspect the log for the outcome. |
| `400` | Missing `assistant_id`. |
| `502` | WebSocket or session failure. |

---

## Outbound Telnyx endpoints

These are the upstream calls the sample makes when `DEMO_MODE=false`. They are
documented here so you can reproduce the flow without the Flask wrapper.

### `POST https://api.telnyx.com/v2/ai/avatars`

`multipart/form-data`. Fields: `image_file` (binary), `name` (string). Returns
`data.id` — the avatar ID. `data.image_url` is a rendering URL and must never be
used as the avatar ID.

### `POST https://api.telnyx.com/v2/ai/assistants`

`application/json`. Creates an assistant. Body includes `avatar_settings`:

```json
{
  "provider": "telnyx",
  "model": "foxtrot-1",
  "avatar_id": "<avatar_id>"
}
```

### `POST https://api.telnyx.com/v2/ai/assistants/{assistant_id}`

Same body shape as above, targeting an existing assistant.

### `GET https://api.telnyx.com/v2/ai/assistants/{assistant_id}`

Reads the assistant back so the sample can print the persisted `avatar_settings`.

### `wss://api.telnyx.com/v2/ai/assistants/{assistant_id}/conversation?avatar=true&input_sample_rate=16000`

The avatar conversation socket. `Authorization: Bearer <TELNYX_API_KEY>` is sent as
a connection header.

Frames sent by the client:

| Frame | When | Notes |
|---|---|---|
| `session.update` | First frame, always | Configures `input_audio_format` and `output_audio_format` as `pcm16`. |
| `avatar.signaling.answer` | On each `avatar.signaling.*` frame | Answers the WebRTC offer. |
| `avatar.media.ready` | Once the media receiver is ready | Must arrive before `session.created` or the socket closes `1011`. |
| PCM16 audio | After `session.update` | 16 kHz mono, streamed as binary. |

Frames received from the server:

| Frame | Meaning |
|---|---|
| `session.created` | Session accepted. Arriving before `avatar.media.ready` is fatal. |
| `avatar.signaling.*` | WebRTC signaling exchange. |
| `avatar.error` | `fatal: true` closes the socket; `fatal: false` triggers voice-only fallback. |
| `response.output_audio.delta` | Assistant audio. Suppressed while the avatar is active; the live path after a non-fatal error. |

---

## Error handling contract

- All error responses are `{"error": "<generic message>"}`.
- Exception details, stack traces, and upstream response bodies are written to the
  application log via `app.logger.exception(...)` and never returned.
- `400` responses are deterministic and safe to branch on — the `error` strings are
  stable.
- `502` responses indicate an upstream or transport failure and are safe to retry
  with backoff.
- Credentials are read from `TELNYX_API_KEY` at call time. A missing key raises
  before any request is made and surfaces as a `502` on the route.
=== END FILE ===
