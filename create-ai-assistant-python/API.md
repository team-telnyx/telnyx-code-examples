# API Reference — Create AI Assistant

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ai/assistants` | Create assistant endpoint. |

---

## `POST /ai/assistants`

Create assistant endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `instructions` | `string` | **yes** | Instructions |
| `model` | `string` | no | AI model name |
| `enabled_features` | `string` | no | Enabled features |

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
