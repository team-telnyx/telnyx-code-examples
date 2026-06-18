# API Reference — Number Porting Status Tracker

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ports/list` | List ports. |
| `POST` | `/ports/create` | Create a new port. |
| `POST` | `/webhooks/porting` | Receives Telnyx porting status webhook events. |
| `GET` | `/ports/<order_id>` | Get port. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /ports/list`

List all ports.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /ports/create`

Create a new port.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_numbers` | `array` | no | Phone numbers |

### Response `200`

```json
{"error": resp.text}
```

---

## `POST /webhooks/porting`

Receives Telnyx porting status webhook events.

---

## `GET /ports/<order_id>`

Get a specific port by ID.

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

Records use these status values: `ok`, `submitted`

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
