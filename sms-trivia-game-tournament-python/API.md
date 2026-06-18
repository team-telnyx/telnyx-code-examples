# API Reference — SMS Trivia Game Tournament

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tournament/create` | Create a new tournament. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `POST` | `/tournament/<tid>/next` | Next round. |
| `GET` | `/tournament/<tid>/leaderboard` | Leaderboard. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /tournament/create`

Create a new tournament.

### Request

```json
{
  "name": "Jane Smith",
  "category": "category-value",
  "rounds": "rounds-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | no | Display name or label |
| `category` | `string` | no | Category |
| `rounds` | `string` | no | Rounds |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `POST /tournament/<tid>/next`

Next round.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /tournament/<tid>/leaderboard`

Leaderboard.

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
  "tournaments": "..."
}
```

---

## Status Values

Records use these status values: `active`, `answered`, `finished`, `ignored`, `info`, `joined`, `lobby`, `ok`

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
