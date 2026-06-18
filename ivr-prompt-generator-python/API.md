# API Reference — IVR Prompt Generator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/prompts/generate` | Generate prompts. |
| `POST` | `/prompts/<set_id>/preview` | Preview prompt. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/prompts/<set_id>` | Get prompt set. |
| `GET` | `/prompt-types` | Get prompt types. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /prompts/generate`

Generate prompts.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `business_name` | `string` | no | Business name |
| `business_type` | `string` | no | Business type |
| `hours` | `string` | no | Hours |
| `departments` | `string` | no | Departments |
| `voice` | `string` | no | TTS voice identifier |
| `prompt_types` | `string` | no | Prompt types |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /prompts/<set_id>/preview`

Preview prompt.

### Request

```json
{
  "phone": "+12125559999",
  "type": "type-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | no | Phone number in E.164 format (e.g., `+12125551234`) |
| `type` | `string` | no | Type |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /prompts/<set_id>`

Get prompt set.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /prompt-types`

Get prompt types.

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

Records use these status values: `calling`, `complete`, `failed`, `ok`, `rendering`, `writing`

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
