# API Reference — Conference Live Poll via DTMF

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conference/create` | Create a new conference. |
| `POST` | `/conference/<cid>/invite` | Invite. |
| `POST` | `/conference/<cid>/poll` | Start poll. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/conference/<cid>/results` | Poll results. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /conference/create`

Create a new conference.

### Request

```json
{
  "name": "Jane Smith"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /conference/<cid>/invite`

Invite.

### Request

```json
{
  "numbers": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numbers` | `array` | no | List of phone numbers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /conference/<cid>/poll`

Start poll.

### Request

```json
{
  "question": "question-value",
  "options": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | **yes** | Question |
| `options` | `array` | no | Options |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /conference/<cid>/results`

Poll results.

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
  "conferences": "..."
}
```

---

## Status Values

Records use these status values: `active`, `joined`, `left`, `ok`, `ringing`, `voted`

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
