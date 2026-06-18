# API Reference — Production-ready Flask application for cloning AI Assistants via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/assistants/<assistant_id>` | Get assistant. |
| `POST` | `/assistants/<assistant_id>/clone` | Clone assistant endpoint. |

---

## `GET /assistants/<assistant_id>`

Get a specific assistant by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /assistants/<assistant_id>/clone`

Clone assistant endpoint.

### Request

```json
{
  "name": "Jane Smith",
  "instructions": "instructions-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `instructions` | `string` | **yes** | Instructions |

### Response `200`

```json
{ "status": "ok", "data": { } }
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
