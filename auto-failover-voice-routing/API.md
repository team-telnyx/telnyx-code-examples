# API Reference — Auto-Failover Voice Routing

This document describes every HTTP endpoint exposed by the Flask application in `app.py`. All endpoints are stateless HTTP handlers; circuit-breaker state is persisted in an in-memory KV store (demo mode) or an external KV store (production mode).

---

## Table of Contents

1. [POST /webhooks/call-control](#post-webhookscall-control)
2. [POST /api/route](#post-apiroute)
3. [GET /api/circuit-state](#get-apicircuit-state)
4. [POST /api/circuit-reset](#post-apireset)
5. [GET /health](#get-health)

---

## POST /webhooks/call-control

Receives inbound Call Control webhooks from Telnyx. Verifies the Ed25519 signature, then dispatches based on `event_type`. Call failures on the primary connection increment the circuit-breaker failure counter and trip the breaker when the threshold is reached.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `Telnyx-Signature` | string (header) | Yes | Ed25519 signature header from Telnyx. |
| `Telnyx-Signature-Timestamp` | string (header) | Yes | Timestamp header from Telnyx. |
| Body | JSON object | Yes | Raw webhook payload (see below). |

#### Webhook Payload Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `data.event_type` | string | Yes | Telnyx event type (e.g., `call.state_changed`). |
| `data.payload` | object | Yes | Event-specific payload. |
| `data.payload.state` | string | Conditional | Call state (`failed`, `busy`, `no_answer`, `completed`, etc.). |
| `data.payload.connection_id` | string | Conditional | SIP connection ID associated with the call. |

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/call-control \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature: t=1699999999,v1=ed25519_signature_here" \
  -H "Telnyx-Signature-Timestamp: 1699999999" \
  -d '{
    "data": {
      "event_type": "call.state_changed",
      "payload": {
        "state": "failed",
        "connection_id": "primary_connection_id_here",
        "call_id": "call_abc123",
        "from": "+15551234567",
        "to": "+15559876543"
      }
    }
  }'
```

### Response

#### 200 OK

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Webhook processed successfully. |
| 500 | Internal server error — signature verification failed or unhandled exception. |

---

## POST /api/route

Determines which SIP connection (primary or backup) should be used for an outbound call. Checks the circuit-breaker state and routes to the backup connection if the breaker is tripped and cooldown has not expired.

### Request

| Field | Type | Required | Description |
|---|---|---|---|
| `to` | string | Yes | Destination phone number in E.164 format (e.g., `+15551234567`). |

### Example Request

```bash
curl -X POST http://localhost:5000/api/route \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567"
  }'
```

### Response

#### 200 OK (Demo Mode)

```json
{
  "demo": true,
  "to": "+15551234567",
  "connection_id": "primary_connection_id_here",
  "circuit_state": {
    "failures": 0,
    "last_fail": 0,
    "tripped": false
  },
  "message": "Demo mode: no real call placed."
}
```

#### 201 Created (Live Mode)

```json
{
  "call_id": "call_abc123",
  "connection_id": "primary_connection_id_here",
  "circuit_state": {
    "failures": 0,
    "last_fail": 0,
    "tripped": false
  }
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Call routed successfully (demo mode). |
| 201 | Call created successfully (live mode). |
| 400 | Missing `to` parameter in request body. |
| 500 | Internal server error — Telnyx API call failed or unhandled exception. |

---

## GET /api/circuit-state

Returns the current circuit-breaker state for the primary SIP connection, including failure count, last failure timestamp, tripped status, and derived circuit status (`closed`, `open`, or `half-open`).

### Request

No request body or parameters required.

### Example Request

```bash
curl -X GET http://localhost:5000/api/circuit-state
```

### Response

#### 200 OK

```json
{
  "failures": 3,
  "last_fail": 1699999999.0,
  "tripped": true,
  "status": "open"
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Circuit state retrieved successfully. |

---

## POST /api/circuit-reset

Manually resets the circuit breaker to the `closed` state. Clears failure count, tripped flag, and last failure timestamp.

### Request

No request body or parameters required.

### Example Request

```bash
curl -X POST http://localhost:5000/api/circuit-reset
```

### Response

#### 200 OK

```json
{
  "status": "reset",
  "circuit_state": {
    "failures": 0,
    "last_fail": 0,
    "tripped": false
  }
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Circuit breaker reset successfully. |

---

## GET /health

Simple health-check endpoint. Returns application status and whether demo mode is active.

### Request

No request body or parameters required.

### Example Request

```bash
curl -X GET http://localhost:5000/health
```

### Response

#### 200 OK

```json
{
  "status": "healthy",
  "demo_mode": true
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Application is healthy and responding. |
