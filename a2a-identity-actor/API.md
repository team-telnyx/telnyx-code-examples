# API Reference — a2a-identity-actor

This document is the typed API contract for the `IdentityAgent` actor (`agent-billing-svc`). All routes are served by the actor's `fetch()` handler. The actor is reachable at the base URL of your deployed Edge runtime.

**Base URL:** `https://<your-deployment>.telnyx-edge.com`

**Authentication for A2A routes:** Peers present their own AMP-issued Bearer token in the `Authorization` header. The actor introspects the token via AMP's `/oauth/introspect` endpoint.

---

## Routes Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/identity/:agentId` | Retrieve full identity state + peer registry (tokens redacted) |
| `POST` | `/api/identity/:agentId/retry` | Manually trigger token refresh (DEGRADED → TOKEN_REFRESHING) |
| `POST` | `/api/identity/:agentId/revoke` | Revoke actor identity (any state → REVOKED) |
| `POST` | `/api/identity/:agentId/authorize` | Authorize a peer agent to communicate |
| `POST` | `/a2a/message` | Receive an A2A JSON-RPC message from a peer agent |

---

## `GET /api/identity/:agentId`

Returns the full identity state and peer registry for the actor. OAuth tokens are **redacted** — only the token type and remaining lifetime are exposed.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | `string` | Yes | The agent ID. Must be `agent-billing-svc`. |

### Response — `200 OK`

```json
{
  "agentId": "agent-billing-svc",
  "identityProvider": "AMP",
  "oauth": {
    "accessToken": "••••",
    "expiresIn": 3599,
    "tokenType": "Bearer"
  },
  "peers": [
    {
      "agentId": "agent-shipping-svc",
      "authorized": true,
      "firstContact": "2026-08-01T14:23:10.000Z",
      "lastContact": "2026-08-01T14:23:10.000Z",
      "messageCount": 3
    }
  ],
  "status": "ACTIVE",
  "lastHealthCheck": "2026-08-01T14:25:00.000Z",
  "createdAt": "2026-08-01T14:00:00.000Z"
}
```

### Response Schema

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `string` | The actor's agent ID. |
| `identityProvider` | `string` | Identity provider (`"AMP"` or `"KEYCLOAK"`). |
| `oauth.accessToken` | `string` | Always `"••••"` — redacted. |
| `oauth.expiresIn` | `number` | Seconds until token expiry. |
| `oauth.tokenType` | `string` | Token type (e.g. `"Bearer"`). |
| `peers[]` | `array` | Peer registry entries. |
| `peers[].agentId` | `string` | Peer agent ID. |
| `peers[].authorized` | `boolean` | Whether the peer is authorized. |
| `peers[].firstContact` | `string \| null` | ISO timestamp of first contact. |
| `peers[].lastContact` | `string \| null` | ISO timestamp of last contact. |
| `peers[].messageCount` | `number` | Number of messages exchanged. |
| `status` | `string` | Actor status: `INITIALIZING`, `ACTIVE`, `TOKEN_REFRESHING`, `DEGRADED`, `REVOKED`. |
| `lastHealthCheck` | `string \| null` | ISO timestamp of last successful health check. |
| `createdAt` | `string` | ISO timestamp of actor creation. |

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Identity state returned successfully. |
| `404` | Agent not found (agentId does not match `agent-billing-svc`). |

---

## `POST /api/identity/:agentId/retry`

Manually triggers a token refresh. Only valid when the actor is in `DEGRADED` state. Transitions `DEGRADED → TOKEN_REFRESHING`.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | `string` | Yes | The agent ID. Must be `agent-billing-svc`. |

### Request Body

None required.

### Response — `200 OK`

```json
{
  "ok": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Retry initiated (or actor was not in DEGRADED state — no-op). |
| `404` | Agent not found. |

---

## `POST /api/identity/:agentId/revoke`

Revokes the actor identity. Transitions any state → `REVOKED`. Once revoked, the actor rejects all A2A messages and stops health checks.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | `string` | Yes | The agent ID. Must be `agent-billing-svc`. |

### Request Body

None.

### Response — `200 OK`

```json
{
  "ok": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Actor revoked. |
| `404` | Agent not found. |

---

## `POST /api/identity/:agentId/authorize`

Authorizes a peer agent to send A2A messages to this actor. The peer must present its own AMP-issued token on subsequent A2A requests.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | `string` | Yes | The agent ID. Must be `agent-billing-svc`. |

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `peerId` | `string` | Yes | The peer agent ID to authorize. |

**Example request body:**

```json
{
  "peerId": "agent-shipping-svc"
}
```

### Response — `200 OK`

```json
{
  "ok": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Peer authorized (or already authorized). |
| `400` | `peerId` missing from request body. |
| `404` | Agent not found. |

---

## `POST /a2a/message`

Handles an incoming A2A JSON-RPC 2.0 message from a peer agent. The peer must present a valid AMP-issued Bearer token and be authorized in the actor's peer registry.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <AMP-issued-token>` for the peer agent. |
| `Content-Type` | Yes | `application/json` |

### Request Body

JSON-RPC 2.0 message envelope:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jsonrpc` | `string` | Yes | Must be `"2.0"`. |
| `id` | `string` | Yes | Request ID, echoed in the response. |
| `method` | `string` | Yes | Method name. Must be `"message/send"`. |
| `params.intent` | `string` | No | Intent key for canned response lookup. |
| `params.content` | `string` | No | Message content from the peer. |

**Example request:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "message/send",
  "params": {
    "intent": "invoice_status",
    "content": "What is the status of invoice INV-1042?"
  }
}
```

### Response — `200 OK` (success)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "agentId": "agent-billing-svc",
    "turn": 4,
    "reply": "Invoice INV-1042 is paid."
  }
}
```

### Response — `200 OK` (queued while DEGRADED)

When the actor is in `DEGRADED` state, the message is queued and replayed after token refresh succeeds.

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "queued": true,
    "status": "DEGRADED"
  }
}
```

### Response — `401 Unauthorized` (invalid/missing peer token)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32001,
    "message": "invalid peer token"
  }
}
```

### Response — `403 Forbidden` (valid token, unauthorized peer)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32002,
    "message": "peer not authorized"
  }
}
```

### Response — `200 OK` (method not found)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32601,
    "message": "method not found"
  }
}
```

### Response — `200 OK` (actor revoked)

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32601,
    "message": "actor revoked"
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Message processed, queued, or JSON-RPC error returned (method not found, actor revoked). |
| `401` | Missing `Authorization` header, or peer token invalid/inactive. |
| `403` | Peer token valid but peer not authorized in registry. |

---

## Canned Response Lookup Table

The actor replies with canned billing-service responses keyed by `params.intent`:

| Intent | Reply |
|--------|-------|
| `invoice_status` | `"Invoice INV-1042 is paid."` |
| `payment_method` | `"Your default payment method is Visa ending in 4242."` |
| `balance` | `"Your current balance is $1,250.00."` |
| `default` (or missing) | `"Thank you for contacting billing. A representative will follow up."` |

---

## Error Handling

All errors are returned as JSON-RPC 2.0 error objects (for `/a2a/message`) or plain JSON `{ "error": "..." }` (for management routes). No exception details are leaked to the client.

| HTTP Status | JSON-RPC Code | Meaning |
|-------------|---------------|---------|
| `200` | `-32601` | Method not found, or actor revoked. |
| `401` | `-32001` | Invalid or inactive peer token. |
| `403` | `-32002` | Peer not authorized. |
| `400` | — | Missing required body field (e.g. `peerId`). |
| `404` | — | Unknown agent ID or route. |
| `500` | — | Internal error (generic message returned). |
