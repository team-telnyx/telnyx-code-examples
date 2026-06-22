## `POST /sip/connections`

Create a new credential-authenticated SIP connection.

### Request

```json
{
  "name": "office-pbx",
  "username": "pbxuser01",
  "password": "s3cretp4ss",
  "endpoint": "sip.example.com:5060"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Human-readable connection name (sent as `connection_name`) |
| `username` | `string` | **yes** | SIP credential username |
| `password` | `string` | **yes** | SIP credential password |
| `endpoint` | `string` | **yes** | SIP host or `host:port`; must contain a `.` or `:` |

### Response `201`

```json
{
  "id": "1234567890",
  "name": "office-pbx",
  "username": "pbxuser01",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `name` | `string` | Connection name |
| `username` | `string` | SIP credential username (echoed from request) |
| `status` | `string` | `active` or `inactive` |
| `created_at` | `string` | ISO 8601 creation timestamp |

**Try it:**

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{"name": "office-pbx", "username": "pbxuser01", "password": "s3cretp4ss", "endpoint": "sip.example.com:5060"}'
```

---

## `GET /sip/connections/:id`

Retrieve a single SIP connection by ID.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (path) | **yes** | Telnyx SIP connection ID |

### Response `200`

```json
{
  "id": "1234567890",
  "name": "office-pbx",
  "status": "active",
  "created_at": "2026-06-18T12:00:00.000Z",
  "updated_at": "2026-06-18T12:05:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `name` | `string` | Connection name |
| `status` | `string` | `active` or `inactive` |
| `created_at` | `string` | ISO 8601 creation timestamp |
| `updated_at` | `string` | ISO 8601 last-updated timestamp |

**Try it:**

```bash
curl http://localhost:5000/sip/connections/1234567890
```

---

## `GET /sip/connections`

List all SIP connections on the account.

### Request

No parameters.

### Response `200`

```json
[
  {
    "id": "1234567890",
    "name": "office-pbx",
    "status": "active",
    "created_at": "2026-06-18T12:00:00.000Z"
  }
]
```

Returns an array of objects, each with:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `name` | `string` | Connection name |
| `status` | `string` | `active` or `inactive` |
| `created_at` | `string` | ISO 8601 creation timestamp |

**Try it:**

```bash
curl http://localhost:5000/sip/connections
```

---

## Telnyx API Endpoints Called

The application wraps these Telnyx SIP Trunking endpoints via the `telnyx` Node.js SDK:

| SDK call | Telnyx endpoint | Used by |
|----------|-----------------|---------|
| `client.credentialConnections.create(...)` | `POST /v2/sip_connections` | `POST /sip/connections` |
| `client.credentialConnections.retrieve(id)` | `GET /v2/sip_connections/{id}` | `GET /sip/connections/:id` |
| `client.credentialConnections.list()` | `GET /v2/sip_connections` | `GET /sip/connections` |

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success (retrieve / list) |
| `201` | Created (new SIP connection) |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key |
| `429` | Rate limit exceeded |
| `503` | Network error connecting to Telnyx |
