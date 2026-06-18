# API Reference — Production-ready SIP failover routing system with Flask and Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sip/connections` | List connections. |
| `POST` | `/sip/connections` | Create a new connection. |
| `GET` | `/sip/connections/<connection_id>` | Get connection. |
| `GET` | `/sip/health` | Health check and service status. |
| `GET` | `/sip/failover-status` | Failover status. |
| `POST` | `/webhooks/call` | Receives Telnyx webhook events. |
| `POST` | `/sip/assign-number` | Assign number. |

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
{
  "name": "Jane Smith"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |

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

## `GET /sip/health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sip/failover-status`

Failover status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/call`

Receives Telnyx webhook events.

---

## `POST /sip/assign-number`

Assign number.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |
| `connection_id` | `string` | **yes** | Connection id |

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
