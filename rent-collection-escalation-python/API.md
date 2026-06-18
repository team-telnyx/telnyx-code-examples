# API Reference — Rent Collection Escalation

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/collections/run` | Run cycle. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/tenants` | List tenants. |
| `PUT` | `/tenants/<int:idx>/status` | Update status. |
| `GET` | `/collections/log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /collections/run`

Run cycle.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `day_overdue` | `string` | no | Day overdue |

### Response `200`

```json
{"results": results}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.answered` | Begins interaction (TTS greeting or gather) |

---

## `GET /tenants`

List all tenants.

### Response `200`

```json
{"tenants": tenants}
```

---

## `PUT /tenants/<int:idx>/status`

Update status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /collections/log`

Get a specific log by ID.

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
  "overdue": "..."
}
```

---

## Status Values

Records use these status values: `current`, `ok`

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
