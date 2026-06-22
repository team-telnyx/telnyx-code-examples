# API Reference — Setup SIP Trunk

The Gin server listens on `:8080` and exposes the routes below. All requests and responses are JSON.

## `POST /sip-connections`

Create a SIP trunk connection with credential authentication and one SIP endpoint.

### Request

```json
{
  "name": "My PBX Trunk",
  "username": "sip_user",
  "password": "s3cure_p@ss",
  "sip_endpoint_ip": "192.0.2.10",
  "sip_endpoint_port": 5060,
  "outbound_voice_profile_id": "1293384261075731499"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Connection name (sent as `connection_name` to Telnyx) |
| `username` | `string` | **yes** | SIP credential username |
| `password` | `string` | **yes** | SIP credential password |
| `sip_endpoint_ip` | `string` | **yes** | Public IP or domain of the SIP endpoint |
| `sip_endpoint_port` | `integer` | **yes** | SIP endpoint port (1–65535) |
| `outbound_voice_profile_id` | `string` | no | Outbound voice profile to attach to the connection |

### Response `201`

```json
{
  "id": "1293384261075731234",
  "name": "My PBX Trunk",
  "username": "sip_user",
  "sip_endpoint_ip": "192.0.2.10",
  "sip_endpoint_port": 5060,
  "outbound_voice_profile_id": "1293384261075731499",
  "created_at": "2026-06-18 12:00:00 +0000 UTC"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Telnyx SIP connection ID |
| `name` | `string` | Connection name |
| `username` | `string` | SIP credential username |
| `sip_endpoint_ip` | `string` | First SIP endpoint address |
| `sip_endpoint_port` | `integer` | First SIP endpoint port |
| `outbound_voice_profile_id` | `string` | Attached outbound voice profile (omitted/empty if none) |
| `created_at` | `string` | Creation timestamp |

---

## `GET /sip-connections`

List all SIP trunk connections.

### Request

No body or query parameters.

### Response `200`

An array of SIP connection objects (same shape as the create response). `sip_endpoint_ip` and `sip_endpoint_port` are only populated when the connection has at least one endpoint.

```json
[
  {
    "id": "1293384261075731234",
    "name": "My PBX Trunk",
    "username": "sip_user",
    "sip_endpoint_ip": "192.0.2.10",
    "sip_endpoint_port": 5060,
    "outbound_voice_profile_id": "1293384261075731499",
    "created_at": "2026-06-18 12:00:00 +0000 UTC"
  }
]
```

---

## `GET /sip-connections/:id`

Retrieve a single SIP trunk connection by ID.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (path) | **yes** | Telnyx SIP connection ID |

### Response `200`

A single SIP connection object (same shape as the create response).

```json
{
  "id": "1293384261075731234",
  "name": "My PBX Trunk",
  "username": "sip_user",
  "sip_endpoint_ip": "192.0.2.10",
  "sip_endpoint_port": 5060,
  "outbound_voice_profile_id": "1293384261075731499",
  "created_at": "2026-06-18 12:00:00 +0000 UTC"
}
```

---

## `GET /health`

Liveness probe.

### Response `200`

```json
{ "status": "ok" }
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

Telnyx API errors (matched as `*telnyx.Error`) also include a `status_code` field echoing the upstream Telnyx status.

| Status | Meaning |
|--------|---------|
| `200` | Success (list / retrieve / health) |
| `201` | SIP connection created |
| `400` | Bad request — missing/invalid fields or port out of range |
| `401` | Invalid API key |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Network error connecting to Telnyx |

---

## Telnyx API Endpoints Called

The application calls the following Telnyx API endpoints via the Go SDK (`github.com/team-telnyx/telnyx-go/v4`):

| App route | SDK call | Telnyx endpoint |
|-----------|----------|-----------------|
| `POST /sip-connections` | `client.CredentialConnections.New(ctx, ...)` | `POST /v2/credential_connections` |
| `GET /sip-connections` | `client.CredentialConnections.List(ctx, ...)` | `GET /v2/credential_connections` |
| `GET /sip-connections/:id` | `client.CredentialConnections.Get(ctx, id)` | `GET /v2/credential_connections/{id}` |
