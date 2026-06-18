# API Reference — AI Assistant Phone Setup

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/assistants` | Create a new assistant. |
| `GET` | `/assistants` | List assistants. |
| `GET` | `/assistants/<assistant_id>` | Get assistant. |
| `PATCH` | `/assistants/<assistant_id>` | Update assistant. |
| `POST` | `/assistants/<assistant_id>/wire` | Wire to number. |
| `POST` | `/assistants/<assistant_id>/test` | Test assistant. |
| `GET` | `/models` | List models. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /assistants`

Create a new assistant.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |
| `instructions` | `string` | no | Instructions |
| `model` | `string` | no | AI model name |
| `voice_provider` | `string` | no | Voice provider |
| `voice_id` | `string` | no | Voice id |
| `speed` | `string` | no | Speed |
| `greeting` | `string` | no | Greeting |
| `hold_music_url` | `string` | **yes** | Hold music url |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /assistants`

List all assistants.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /assistants/<assistant_id>`

Get a specific assistant by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `PATCH /assistants/<assistant_id>`

Update assistant.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /assistants/<assistant_id>/wire`

Wire to number.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /assistants/<assistant_id>/test`

Test assistant.

### Request

```json
{
  "message": "Hello from the API"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | no | Message content to send |

### Response `200`

```json
{"response": resp."...".get("choices", [{}
```

---

## `GET /models`

List all models.

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
  "assistants": "..."
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
