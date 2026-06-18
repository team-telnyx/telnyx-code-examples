# API Reference — AI Debt Collection Compliance Agent

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/collect` | Start collection. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/logs` | Get logs. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /collect`

Start collection.

### Request

```json
{
  "number": "number-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `string` | **yes** | Number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /logs`

Get a specific logs by ID.

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
  "active": "...",
  "completed": "..."
}
```

---

## Status Values

Records use these status values: `calling`, `dnc_acknowledged`, `ended`, `greeting`, `listening`, `ok`, `reprompting`, `responding`

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
