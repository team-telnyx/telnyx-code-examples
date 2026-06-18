# API Reference — Conference Call with AI Summary

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conference/create` | Create a new conference. |
| `POST` | `/conference/<conf_id>/invite` | Invite participant. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/conference/<conf_id>/summary` | Get summary. |
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

## `POST /conference/<conf_id>/invite`

Invite participant.

### Request

```json
{
  "number": "number-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | `string` | **yes** | Number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /conference/<conf_id>/summary`

Get a specific summary by ID.

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

Records use these status values: `active`, `answering`, `greeting`, `invited`, `ok`

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
