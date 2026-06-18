# API Reference — AI Assistant Multi-Tool

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Chat. |
| `GET` | `/tools` | List tools. |
| `GET` | `/tool-calls` | List tool calls. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /chat`

Chat.

### Request

```json
{
  "messages": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | `array` | no | Messages |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /tools`

List all tools.

### Response `200`

```json
{"tools": TOOLS}
```

---

## `GET /tool-calls`

List tool calls.

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
  "tools": "...",
  "calls": "..."
}
```

---

## Status Values

Records use these status values: `booked`, `ok`, `processing`, `shipped`

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
