# API Reference

Typed reference for every HTTP route the Express app exposes, plus the Telnyx API endpoints it calls.

## `POST /sip/connections`

Create a SIP connection for inbound routing. The inbound URI and authentication come from the environment (`SIP_ENDPOINT`, `SIP_USERNAME`, `SIP_PASSWORD`).

### Request

```json
{
  "connection_name": "inbound-routing-prod"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `connection_name` | `string` | **yes** | Human-readable name for the new SIP connection |

### Response `201`

```json
{
  "id": "1234567890",
  "connection_name": "inbound-routing-prod",
  "inbound_uri": "sip:user@example.com",
  "created_at": "2026-06-18T12:00:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `connection_name` | `string` | Name assigned to the connection |
| `inbound_uri` | `string` | Inbound SIP URI calls are routed to (from `SIP_ENDPOINT`) |
| `created_at` | `string` | ISO 8601 creation timestamp |

### Try it

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{"connection_name": "inbound-routing-prod"}'
```

---

## `GET /sip/connections`

List all SIP connections on the account. No request body.

### Response `200`

```json
[
  {
    "id": "1234567890",
    "connection_name": "inbound-routing-prod",
    "inbound_uri": "sip:user@example.com",
    "created_at": "2026-06-18T12:00:00Z"
  }
]
```

Array of objects, each with the same fields as the `POST` response.

### Try it

```bash
curl http://localhost:5000/sip/connections
```

---

## `GET /sip/connections/:id`

Retrieve a single SIP connection by its Telnyx ID.

### Path parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | **yes** | Telnyx SIP connection ID |

### Response `200`

```json
{
  "id": "1234567890",
  "connection_name": "inbound-routing-prod",
  "inbound_uri": "sip:user@example.com",
  "inbound_authentication_username": "your_sip_username",
  "created_at": "2026-06-18T12:00:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `connection_name` | `string` | Name assigned to the connection |
| `inbound_uri` | `string` | Inbound SIP URI calls are routed to |
| `inbound_authentication_username` | `string` | Username configured for inbound authentication |
| `created_at` | `string` | ISO 8601 creation timestamp |

### Try it

```bash
curl http://localhost:5000/sip/connections/1234567890
```

---

## `POST /webhooks/inbound-call`

Receive inbound call webhooks from Telnyx. The handler logs the event fields below and immediately acknowledges. It does not validate the payload — extend it to route calls.

### Request

Telnyx sends a call event. The handler reads these fields from `data`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | `string` | no | Call event type (e.g. `call.initiated`) |
| `data.call_session_id` | `string` | no | Session ID grouping legs of the call |
| `data.from` | `string` | no | Caller number (E.164) |
| `data.to` | `string` | no | Called number (E.164) |
| `data.occurred_at` | `string` | no | ISO 8601 event timestamp |

### Response `200`

```json
{
  "status": "received"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/webhooks/inbound-call \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "call.initiated", "call_session_id": "abc-123", "from": "+12125551234", "to": "+13105550000", "occurred_at": "2026-06-18T12:00:00Z"}}'
```

---

## Telnyx API Endpoints Called

The app calls these Telnyx API endpoints via the Node.js SDK (`client.credentialConnections`):

| SDK method | HTTP | Telnyx endpoint | Used by |
|------------|------|-----------------|---------|
| `credentialConnections.create()` | `POST` | `/v2/sip_connections` | `POST /sip/connections` |
| `credentialConnections.list()` | `GET` | `/v2/sip_connections` | `GET /sip/connections` |
| `credentialConnections.retrieve(id)` | `GET` | `/v2/sip_connections/{id}` | `GET /sip/connections/:id` |

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success (list, retrieve, webhook ack) |
| `201` | SIP connection created |
| `400` | Bad request — missing `connection_name` or `id` |
| `401` | Invalid API key (`Telnyx.AuthenticationError`) |
| `429` | Rate limit exceeded (`Telnyx.RateLimitError`) |
| `503` | Network error reaching Telnyx (`Telnyx.APIConnectionError`) |
| `500` | Internal server error |

The status code from a `Telnyx.APIError` is passed through with the upstream message.
