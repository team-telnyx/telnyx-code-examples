# API Reference — Live Podcast Call-In Show

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/shows/start` | Start show. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `POST` | `/shows/<show_id>/next-caller` | Admit next caller. |
| `POST` | `/shows/<show_id>/fact-check` | Fact check. |
| `GET` | `/shows/<show_id>/queue` | View queue. |
| `GET` | `/shows` | List shows. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /shows/start`

Start show.

### Request

```json
{
  "hosts": [],
  "topic": "topic-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hosts` | `array` | no | Hosts |
| `topic` | `string` | no | Topic |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `POST /shows/<show_id>/next-caller`

Admit next caller.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /shows/<show_id>/fact-check`

Fact check.

### Request

```json
{
  "claim": "claim-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claim` | `string` | no | Claim |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /shows/<show_id>/queue`

View queue.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /shows`

List all shows.

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

Records use these status values: `live`, `ok`, `queued`, `rejected`, `screening`

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
