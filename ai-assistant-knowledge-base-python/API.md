# API Reference — AI Assistant Knowledge Base

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/documents` | Add document. |
| `POST` | `/ask` | Ask question. |
| `GET` | `/documents` | List documents. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /documents`

Add document.

### Request

```json
{
  "title": "title-value",
  "content": "content-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | no | Title |
| `content` | `string` | no | Content |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /ask`

Ask question.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | no | Question |
| `top_k` | `string` | no | Top k |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /documents`

List all documents.

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
  "documents": "...",
  "chunks": "..."
}
```

---

## Status Values

Records use these status values: `indexed`, `ok`

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
