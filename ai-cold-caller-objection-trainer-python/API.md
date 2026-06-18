# API Reference — AI Cold Caller Objection Trainer

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/train` | Start training. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/results` | Get results. |
| `GET` | `/personas` | List personas. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /train`

Start training.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rep_number` | `string` | **yes** | Rep number |
| `persona` | `number` | no | Persona |

### Response `200`

```json
{"status": "calling", "persona": persona["name"]}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /results`

Get a specific results by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /personas`

List all personas.

### Response `200`

```json
{"personas": [{"index": i, "name": p["name"], "style": p["style"]}
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

Records use these status values: `calling`, `ended`, `in_character`, `listening`, `ok`, `reprompting`, `responding`

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
