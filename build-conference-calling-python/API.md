# API Reference — Production-ready Flask application for managing conference calls via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conference/create` | Create conference endpoint. |
| `POST` | `/conference/<conference_name>/add-participant` | Add participant endpoint. |
| `POST` | `/conference/<conference_name>/end` | End conference endpoint. |
| `GET` | `/conference/<conference_name>/status` | Get conference status endpoint. |
| `POST` | `/webhooks/call-events` | Receives Telnyx webhook events. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /conference/create`

Create conference endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conference_name` | `string` | **yes** | Conference name |
| `participants` | `array` | no | List of participant phone numbers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /conference/<conference_name>/add-participant`

Add participant endpoint.

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

## `POST /conference/<conference_name>/end`

End conference endpoint.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /conference/<conference_name>/status`

Get conference status endpoint.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/call-events`

Receives Telnyx webhook events.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "healthy"
}
```

---

## Status Values

Records use these status values: `active`, `answered`, `ended`, `hangup`, `healthy`, `initiated`, `received`

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
