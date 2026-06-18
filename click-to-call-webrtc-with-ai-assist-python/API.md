# API Reference — Click-to-Call WebRTC with AI Assist

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Index. |
| `POST` | `/webrtc/token` | Get token. |
| `POST` | `/coaching` | Get coaching. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /`

Index.

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /webrtc/token`

Get a specific token by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /coaching`

Get a specific coaching by ID.

### Request

```json
{
  "transcript": "transcript-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transcript` | `string` | no | Transcript |

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
  "status": "ok"
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
