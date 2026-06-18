# API Reference — Multilingual Voice-Over Kit

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/kits/create` | Create a new kit. |
| `GET` | `/kits/<kit_id>` | Get kit. |
| `POST` | `/kits/<kit_id>/add-language` | Add language. |
| `GET` | `/kits` | List kits. |
| `GET` | `/languages` | List languages. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /kits/create`

Create a new kit.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `script` | `string` | no | Script |
| `source_language` | `string` | no | Source language |
| `target_languages` | `string` | no | Target languages |
| `project` | `string` | no | Project |
| `style` | `string` | no | Style |

### Response `200`

```json
{"error": "Provide "script" text"}
```

---

## `GET /kits/<kit_id>`

Get a specific kit by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /kits/<kit_id>/add-language`

Add language.

### Request

```json
{
  "language": "language-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `language` | `string` | **yes** | Language code (e.g., `en-US`) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /kits`

List all kits.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /languages`

List all languages.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `complete`, `ok`, `pending`, `translated`, `translating`, `translation_failed`, `tts_failed`

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
