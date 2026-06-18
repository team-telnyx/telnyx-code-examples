# API Reference — Migrate from ElevenLabs

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/elevenlabs` | Audit elevenlabs. |
| `POST` | `/migrate/voice-config` | Migrate voice. |
| `GET` | `/mapping/voices` | Voice mapping. |
| `GET` | `/cost-comparison` | Cost comparison. |
| `POST` | `/test-tts` | Test tts. |
| `GET` | `/migration-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /audit/elevenlabs`

Audit elevenlabs.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /migrate/voice-config`

Migrate voice.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `elevenlabs_voice_name` | `string` | no | Elevenlabs voice name |
| `speed` | `string` | no | Speed |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /mapping/voices`

Voice mapping.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /cost-comparison`

Cost comparison.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /test-tts`

Test tts.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | no | Text content |
| `voice_id` | `string` | no | Voice id |

### Response `200`

```json
{"status": "generated", "voice": voice}
```

---

## `GET /migration-log`

Get a specific log by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "migrations": "..."
}
```

---

## Status Values

Records use these status values: `generated`, `ok`

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
