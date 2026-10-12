# API Reference — Show Wrap Desk

This document is the typed HTTP contract for the Show Wrap Desk sample. It covers every route exposed by the deployed Edge worker.

Base URL for all requests: `https://<your-deployment>.telnyx-edge.com`

All request and response bodies are JSON (`Content-Type: application/json`) unless otherwise noted.

---

## Routes Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/wrap` | Register a new episode for wrapping (or resume an existing desk). |
| `GET` | `/api/wrapstatus/{episodeId}` | Retrieve the wrap ledger for a specific episode. |
| `*` | `*` | Any other path/method returns `404 Not Found`. |

---

## `POST /api/wrap`

Registers an episode with the wrap desk. The first call for a given `show` births the durable desk actor (`env.DESKS.get("show:" + show)`). Subsequent calls for the same `show` reuse the same desk instance — the episode ledger, message history, and resume state persist.

The desk immediately stores the episode with status `transcribing` and arms the wrap task. The wrap pipeline (transcribe → chapterize → notes → trailer) runs asynchronously; this endpoint returns as soon as the episode is registered.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `show` | `string` | **Yes** | The show identifier. Used as the actor name (`ctx.env.DESK.get("show:" + show)`). Must be a non-empty string. |
| `audioUrl` | `string` | **Yes** | Publicly accessible URL to the raw episode audio file (MP3/WAV, ≤100 MB for live STT). Must be a non-empty string. |

### Example Request

```bash
curl -X POST https://your-deployment.telnyx.com/api/wrap \
  -H "Content-Type: application/json" \
  -d '{
    "show": "tok-podcast",
    "audioUrl": "https://example.com/episodes/ep-42.mp3"
  }'
```

### Response — `202 Accepted`

| Field | Type | Description |
|-------|------|-------------|
| `episodeId` | `string` | The UUID assigned to this episode. Use this with `GET /api/wrapstatus/{episodeId}`. |
| `status` | `string` | Always `"transcribing"` at registration time. |

```json
{
  "episodeId": "3f2b8c1e-9a4d-4f6e-8c2a-1b7d5e9f0a3c",
  "status": "transcribing"
}
```

### Response — `400 Bad Request`

Returned when `show` or `audioUrl` is missing or empty.

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Human-readable error message. |

```json
{
  "error": "show and audioUrl required"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `202` | Episode registered; wrap pipeline started. |
| `400` | Missing or invalid `show` / `audioUrl`. |
| `500` | Internal error (e.g., actor could not be reached, state store failure). |

---

## `GET /api/wrapstatus/{episodeId}`

Returns the wrap ledger row for a given episode: current status, chapter list, show-notes preview, and trailer byte count.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `episodeId` | `string` | **Yes** | The episode UUID returned by `POST /api/wrap`. |

### Example Request

```bash
curl https://your-deployment-address.telnyx.com/api/wrapstatus/3f9b8c1e-9a4d-4f6e-8c2a-1b7d5e9f0a3c
```

### Response — `200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | One of `"transcribing"`, `"chapterizing"`, `"notes"`, `"wrapped"`, or `"unknown"` if the episode does not exist. |
| `chapters` | `array` | List of chapter objects. Empty array if not yet chapterized. |
| `chapters[].title` | `string` | LLM-generated chapter title. |
| `chapters[].start` | `number` | Start time in seconds (float). |
| `chapters[].end` | `number` | End time in seconds (float). |
| `notesPreview` | `string` | First 200 characters of the show notes markdown. Empty string if notes not yet written. |
| `trailerBytes` | `number` | Byte count of the generated trailer audio. `0` if trailer not yet generated. |

```json
{
  "status": "wrapped",
  "chapters": [
    { "title": "Cold Open: The Hook", "start": 0.0, "end": 84.2 },
    { "title": "Interview: The Guest", "start": 144.7, "end": 612.9 },
    { "title": "Wrap-Up & Takeaways", "start": 613.0, "end": 720.5 }
  ],
  "notesPreview": "# Show Notes\n\nIn this episode we dive into the future of AI-driven podcast production...",
  "trailerBytes": 245760
}
```

### Response — `404 Not Found`

Returned when the path does not match a known route (e.g., missing `episodeId`).

```json
{
  "error": "Not Found"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Ledger row returned (even if episode is unknown — `status` will be `"unknown"`). |
| `404` | Route not found (e.g., `/api/wrapstatus/` with no ID). |
| `500` | Internal error (e.g., SQL query failure). |

---

## Error Handling

All error responses follow a consistent JSON shape:

| Field | Type | Description |
|-------|------|-------------|
| `error` | `string` | Short, human-readable error description. |

Internal exceptions are logged server-side via `app.logger.exception(...)` and never leak stack traces or sensitive details into the HTTP response.

---

## Notes on the Wrap Pipeline

The `POST /api/wrap` endpoint is asynchronous. The pipeline progresses through four stages:

1. **`transcribing`** — Audio is sent to the STT API (`deepgram/nova-3` with diarization). The transcript is stored exactly once.
2. **`chapterizing`** — Words are grouped into speaker turns; gaps > 60s become chapter boundaries; the LLM writes titles.
3. **`notes`** — Show notes markdown is composed from the transcript + chapters.
4. **`wrapped`** — Trailer audio is generated via TTS WebSocket and stored.

Each stage is idempotent. If the worker crashes mid-pipeline, the next wake resumes from the last completed stage — no stage is re-run. Poll `GET /api/wrapstatus/{episodeId}` to observe progress.
