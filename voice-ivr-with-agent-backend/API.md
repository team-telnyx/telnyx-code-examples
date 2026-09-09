# API Reference

This document defines the HTTP API contract for the `voice-ivr-with-agent-backend` sample. All endpoints are served by the Flask application in `app.py`.

## Authentication

- **Management API** (`/api/*`, `/health`): No authentication required for this sample. In production, protect these endpoints with an API key or OAuth.
- **Telnyx Webhook** (`/webhooks/voice`): Verified via Telnyx Ed25519 webhook signature. The `verify_telnyx_webhook` decorator validates the `Telnyx-Signature-Ed25519` and `Telnyx-Signature-Timestamp` headers against your `TELNYX_PUBLIC_KEY`.

---

## Endpoints

### 1. Telnyx Voice Webhook

Receives Call Control events from Telnyx to manage the IVR agent lifecycle.

#### `POST /webhooks/voice`

**Request Body Schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | The Telnyx event payload wrapper. |
| `data.event_type` | string | Yes | The type of call event (e.g., `call.initiated`, `call.answered`, `call.gather.ended`). |
| `data.payload` | object | Yes | The event-specific payload. |
| `data.payload.call_control_id` | string | Yes | The unique identifier for the call control session. |
| `data.payload.to` | string | No | The dialed number (E.164). Required for `call.initiated`. |
| `data.payload.speech` | object | No | The speech transcription object. Required for `call.gather.ended`. |
| `data.payload.speech.text` | string | No | The transcribed text from the caller's speech. |

**Example Request**

```bash
curl -X POST http://localhost:5000/webhooks/voice \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Signature-Timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "call.gather.ended",
      "payload": {
        "call_control_id": "call-control-id-uuid",
        "speech": {
          "text": "I need help with my invoice"
        }
      }
    }
  }'
```

**Response Schema**

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| 200 | `{"status": "ivr_started"}` | Call answered and IVR agent initialized. |
| 200 | `{"status": "intent_routed"}` | Gather completed and intent routed via LLM. |
| 200 | `{"status": "answered"}` | Call initiated and answered successfully. |
| 200 | `{"status": "ignored"}` | Webhook received but ignored (missing payload). |
| 200 | `{"status": "unhandled", "event": "<event_type>"}` | Event type not explicitly handled. |
| 401 | `{"error": "Missing signature"}` | Missing Telnyx signature headers. |
| 401 | `{"error": "Invalid signature"}` | Webhook signature verification failed. |
| 500 | `{"error": "Failed to answer"}` | Call Control failed to answer the inbound call. |
| 500 | `{"error": "Internal server error"}` | Unexpected internal error. |
| 503 | `{"error": "Webhook verification not configured"}` | `TELNYX_PUBLIC_KEY` environment variable is missing. |

**Status Codes**

| Code | Meaning |
|------|---------|
| 200 | OK - Event processed successfully or ignored. |
| 401 | Unauthorized - Webhook signature missing or invalid. |
| 500 | Internal Server Error - Failed to execute Call Control action. |
| 503 | Service Unavailable - Webhook verification not configured. |

---

### 2. Get IVR Menu Configuration

Retrieves the IVR menu configuration for a specific phone number from the KV store.

#### `GET /api/menu-config/<phone_number>`

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phone_number` | string | Yes | The dialed phone number in E.164 format (e.g., `+18005550000`). |

**Example Request**

```bash
curl -X GET http://localhost:5000/api/menu-config/+18005550000
```

**Response Schema**

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| 200 | `{"phone_number": "+18005550000", "config": {...}}` | Menu configuration found. |
| 404 | `{"error": "No configuration found for this number"}` | Phone number not in KV store. |

**200 OK Response Example**

```json
{
  "phone_number": "+18005550000",
  "config": {
    "business_name": "Acme Corp",
    "greeting": "Welcome to Acme Corp. How can I help you today?",
    "departments": [
      {
        "name": "billing",
        "description": "questions about invoices, payments, or account charges",
        "transfer_to": "+18005551000",
        "keywords": ["billing", "invoice", "payment", "charge", "bill", "account"]
      }
    ]
  }
}
```

**Status Codes**

| Code | Meaning |
|------|---------|
| 200 | OK - Configuration retrieved successfully. |
| 404 | Not Found - No configuration exists for the provided number. |

---

### 3. Update IVR Menu Configuration

Updates or creates the IVR menu configuration for a specific phone number in the KV store.

#### `PUT /api/menu-config/<phone_number>`

**Path Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phone_number` | string | Yes | The dialed phone number in E.164 format. |

**Request Body Schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | Yes | The menu configuration object. |
| `config.business_name` | string | Yes | The name of the business. |
| `config.greeting` | string | Yes | The fallback greeting message. |
| `config.departments` | array | Yes | List of department objects. |
| `config.departments[].name` | string | Yes | Department name (lowercase). |
| `config.departments[].description` | string | Yes | Description used for LLM intent routing. |
| `config.departments[].transfer_to` | string | Yes | E.164 number to transfer calls to. |
| `config.departments[].keywords` | array | Yes | List of keyword strings for fallback matching. |

**Example Request**

```bash
curl -X PUT http://localhost:5000/api/menu-config/+18005550000 \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "business_name": "Acme Corp",
      "greeting": "Welcome to Acme Corp. How can I help you today?",
      "departments": [
        {
          "name": "billing",
          "description": "questions about invoices, payments, or account charges",
          "transfer_to": "+18005551000",
          "keywords": ["billing", "invoice", "payment", "charge", "bill", "account"]
        }
      ]
    }
  }'
```

**Response Schema**

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| 200 | `{"status": "updated", "phone_number": "+18005550000"}` | Configuration updated successfully. |
| 400 | `{"error": "Missing 'config' in request body"}` | Missing `config` field in JSON body. |
| 400 | `{"error": "Missing required field: <field>"}` | Missing a required field in the config object. |
| 500 | `{"error": "Failed to update configuration"}` | Internal error updating KV store. |

**Status Codes**

| Code | Meaning |
|------|---------|
| 200 | OK - Configuration updated successfully. |
| 400 | Bad Request - Invalid or incomplete request body. |
| 500 | Internal Server Error - Failed to update configuration. |

---

### 4. List Active IVR Agents

Returns a list of currently active IVR agents (useful for debugging).

#### `GET /api/agents`

**Example Request**

```bash
curl -X GET http://localhost:5000/api/agents
```

**Response Schema**

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| 200 | `{"active_agents": [...], "count": 0}` | List of active agents. |

**200 OK Response Example**

```json
{
  "active_agents": [
    {
      "call_control_id": "call-control-id-uuid",
      "dialed_number": "+18005550000",
      "state": "awaiting_input",
      "turn_count": 1
    }
  ],
  "count": 1
}
```

**Status Codes**

| Code | Meaning |
|------|---------|
| 200 | OK - Active agents retrieved successfully. |

---

### 5. Health Check

Returns the health status of the application.

#### `GET /health`

**Example Request**

```bash
curl -X GET http://localhost:5000/health
```

**Response Schema**

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| 200 | `{"status": "ok", "timestamp": "...", "service": "voice-ivr-with-agent-backend"}` | Service is healthy. |

**200 OK Response Example**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00+00:00",
  "service": "voice-ivr-with-agent-backend"
}
```

**Status Codes**

| Code | Meaning |
|------|---------|
| 200 | OK - Service is running. |
