# API Reference — AI Call Center Quality Scorer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/score` | Score call. |
| `POST` | `/score/batch` | Batch score. |
| `GET` | `/scorecards` | List scorecards. |
| `GET` | `/scorecards/summary` | Summary. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /score`

Score call.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript` | `string` | no | Transcript |
| `call_id` | `string` | no | Call id |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /score/batch`

Batch score.

### Request

```json
{
  "transcripts": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcripts` | `array` | no | Transcripts |

### Response `200`

```json
{"results": results}
```

---

## `GET /scorecards`

List all scorecards.

### Response `200`

```json
{"scorecards": scorecards[-50:]}
```

---

## `GET /scorecards/summary`

Summary.

### Response `200`

```json
{
  "message": "No scorecards yet"
}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "scorecards": "..."
}
```

---

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
