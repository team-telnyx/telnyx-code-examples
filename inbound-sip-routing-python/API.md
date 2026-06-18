# API Reference — Flask application for managing inbound SIP routing with Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sip/connections` | List connections. |
| `POST` | `/sip/connections` | Create a new connection. |
| `GET` | `/sip/connections/<connection_id>` | Get connection. |

---

## `GET /sip/connections`

List all connections.

### Response `200`

```json
{"connections": connections}
```

---

## `POST /sip/connections`

Create a new connection.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `sip_uri` | `string` | **yes** | Sip uri |
| `username` | `string` | **yes** | Username |
| `password` | `string` | **yes** | Password |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sip/connections/<connection_id>`

Get a specific connection by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
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
