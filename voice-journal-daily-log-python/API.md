# API Reference — Voice Journal Daily Log

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/journal` | List entries. |
| `GET` | `/journal/insights` | Insights. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /journal`

List all entries.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /journal/insights`

Insights.

### Response `200`

```json
{
  "message": "No entries yet"
}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "entries": "..."
}
```

---

## Status Values

Records use these status values: `answering`, `captured`, `greeting`, `listening`, `ok`, `saved`

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
