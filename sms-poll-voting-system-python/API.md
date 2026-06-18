# API Reference — SMS Poll Voting System — text-to-vote polling with real-time results.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/polls` | Create a new poll. |
| `POST` | `/polls/<pid>/broadcast` | Broadcast poll. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/polls/<pid>/results` | Results. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /polls`

Create a new poll.

### Request

```json
{
  "options": [],
  "question": "question-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `options` | `array` | no | Options |
| `question` | `string` | **yes** | Question |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /polls/<pid>/broadcast`

Broadcast poll.

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

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /polls/<pid>/results`

Results.

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
  "polls": "..."
}
```

---

## Status Values

Records use these status values: `active`, `ignored`, `no_poll`, `ok`, `voted`

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
