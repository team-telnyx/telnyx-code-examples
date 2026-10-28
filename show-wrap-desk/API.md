# API Reference — show-wrap-desk

Base URL for all requests: `https://<your-deployment>.telnyxcompute.com`
(the URL `npm run deploy` prints).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/wrap` | Register a new episode for wrapping (or resume a mid-wrap episode). |
| `GET` | `/wrapstatus/{episodeId}?show={show}` | Retrieve the wrap ledger for a specific episode. |
| `GET` | `/health/liveness` | Liveness check. |
| `GET` | `/health/readiness` | Readiness check. |

## `POST /wrap`

Register a new episode for wrapping. The first call for a show births the
`show:<show>` actor desk; subsequent calls for new episodes reuse the same
desk instance. Re-POSTing the same `show` + `audioUrl` while an episode is
mid-wrap **resumes** it instead of duplicating it.

```bash
curl -X POST https://your-deployment.telnyx.com/wrap \
  -H "Content-Type: application/json" \
  -d '{"show": "tok-podcast", "audioUrl": "https://archive.org/download/sonnet_116_librivox/sonnet_116_shakespeare_add_64kb.mp3"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `show` | `string` | **Yes** | The show identifier. The desk actor is `show:<show>`. |
| `audioUrl` | `string` | No | Publicly fetchable mp3/wav. Defaults to the `EPISODE_URL` binding. |

**Response (202 Accepted):**

| Field | Type | Description |
|-------|------|-------------|
| `episodeId` | `string` | UUID for this episode. Use with `GET /wrapstatus/{episodeId}`. |
| `status` | `string` | `transcribing` for a new episode; the current status on resume. |
| `resumed` | `boolean` | `true` when an unfinished episode with the same `audioUrl` was found and re-armed. |

```json
{ "episodeId": "3f9b8c1e-9a4d-4f6e-8c2a-1b7d5e9f0a3c", "status": "transcribing", "resumed": false }
```

## `GET /wrapstatus/{episodeId}?show={show}`

Returns the ledger row for one episode plus the desk's full episode ledger.

```bash
curl "https://your-deployment.telnyx.com/wrapstatus/3f9b8c1e-9a4d-4f6e-8c2a-1b7d5e9f0a3c?show=tok-podcast"
```

| Parameter | In | Type | Required | Description |
|-----------|-----|------|----------|-------------|
| `episodeId` | path | `string` | **Yes** | The episode UUID returned by `POST /wrap`. |
| `show` | query | `string` | **Yes** | The show identifier; routes to the same `show:<show>` actor that wrapped the episode. |

**Response (200):**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `transcribing` \| `chapterizing` \| `notes` \| `wrapped` |
| `error` | `string` | Present when the last stage attempt failed (the scheduler retries with backoff). |
| `chapters` | `array` | `{title, start, end}` per chapter, in order. |
| `notesPreview` | `string` | First 200 characters of the show notes markdown. |
| `trailerBytes` | `number` | Decoded size of the trailer mp3, in bytes (0 until cut). |
| `episodes` | `array` | Every episode on this desk: `{ep_id, audio_url, status, created_at, wrapped_at}`. |

```json
{
  "status": "wrapped",
  "chapters": [
    { "title": "A Sonnet About Constant Love", "start": 5.68, "end": 21.04 },
    { "title": "The Marriage of True Minds", "start": 22.1, "end": 45.8 }
  ],
  "notesPreview": "# Show Notes\n\nIn this episode, we read Shakespeare's Sonnet 116...",
  "trailerBytes": 156960,
  "episodes": [
    {
      "ep_id": "3f9b8c1e-9a4d-4f6e-8c2a-1b7d5e9f0a3c",
      "audio_url": "https://archive.org/download/sonnet_116_librivox/sonnet_116_shakespeare_add_64kb.mp3",
      "status": "wrapped",
      "created_at": "2026-10-14T13:00:00.000Z",
      "wrapped_at": "2026-10-14T13:02:11.000Z"
    }
  ]
}
```

## The wrap pipeline

`POST /wrap` is asynchronous. The pipeline progresses through four statuses:

```
transcribing → chapterizing → notes → wrapped
```

Each stage is idempotent: it checks its `assets`/`chapters` rows before
running, and the wrap task is scheduled once per episode under the stable id
`wrap:<epId>`. If a worker crashes mid-pipeline, the next wake — the re-armed
task, or the same `POST /wrap` again — resumes at the unfinished stage with
earlier output intact. Poll `GET /wrapstatus/{episodeId}?show=...` to observe
progress.

## Telnyx endpoints consumed by this service

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /v2/ai/audio/transcriptions` | POST | Diarized transcription (`deepgram/nova-3`, `verbose_json`) — [reference](https://developers.telnyx.com/api-reference/audio/transcribe-speech-to-text) |
| `wss://api.telnyx.com/v2/text-to-speech/speech` | WebSocket | Trailer synthesis until `isFinal: true` — [reference](https://developers.telnyx.com/api-reference/websockets/stream-text-to-speech-over-websocket) |
| `ai.openai.chat.createCompletion` (TELNYX binding) | — | Chapter titles, show notes, trailer script — [models](https://developers.telnyx.com/docs/inference/models) |

## Error responses

| Status | Cause |
|--------|-------|
| `400` | Missing `show`/`audioUrl` on `/wrap`, or missing `episodeId`/`show` on `/wrapstatus`. |
| `404` | Route not found (e.g. `/wrapstatus` with no id). |
| `5xx` | Stage failure; check the `error` field on the ledger row. |
