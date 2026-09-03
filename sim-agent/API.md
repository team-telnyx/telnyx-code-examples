# API Reference — SIMAgent

The SIMAgent sample exposes a single HTTP endpoint that serves as the webhook receiver for Telnyx events. All other interactions (SMS, calls, provisioning) are driven by the agent's internal scheduling and inference logic.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | Receives Telnyx webhook events (SMS, calls, data usage) and dispatches them to the appropriate SIMAgent instance. |

---

## POST /webhook

Receives inbound Telnyx webhook events. The handler verifies the Ed25519 signature, parses the event type from `data.payload`, and routes the event to the correct `SIMAgent` instance based on the SIM card identifier.

### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | Top-level wrapper containing the event payload. |
| `data.payload` | object | Yes | The Telnyx event payload. Structure varies by event type. |
| `data.payload.event` | string | Yes | The Telnyx event type (e.g., `sms.received`, `call.initiated`, `data_usage.threshold`). |
| `data.payload.data` | object | Yes | Event-specific data. For SMS events, contains `from`, `to`, and `text`. For call events, contains `call_control_id`, `from`, and `to`. For data usage events, contains `sim_card_id`, `usage_bytes`, and `threshold_percent`. |
| `data.payload.data.sim_card_id` | string | Conditional | The Telnyx SIM card identifier. Present in data usage and provisioning events. |
| `data.payload.data.from` | string | Conditional | The sender's phone number (E.164 format). Present in SMS and call events. |
| `data.payload.data.to` | string | Conditional | The recipient's phone number (E.164 format). Present in SMS and call events. |
| `data.payload.data.text` | string | Conditional | The body of an inbound SMS message. Present in `sms.received` events. |
| `data.payload.data.call_control_id` | string | Conditional | The Telnyx Call Control ID. Present in call events. |
| `data.payload.data.usage_bytes` | integer | Conditional | Current data usage in bytes. Present in data usage events. |
| `data.payload.data.threshold_percent` | integer | Conditional | The usage threshold percentage that triggered the event. Present in data usage events. |

### Example Request (curl)

```bash
curl -X POST https://<your-edge-app>.telnyx.run/webhook \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature: t=1700000000,v1=ed25519_signature_hex" \
  -d '{
    "data": {
      "payload": {
        "event": "sms.received",
        "data": {
          "from": "+15551234567",
          "to": "+15559998888",
          "text": "what are my options?"
        }
      }
    }
  }'
```

### Response Schema

#### 200 OK

```json
{
  "status": "processed",
  "event": "sms.received",
  "sim_card_id": "sim-abc123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"processed"`. Indicates the webhook was received and dispatched. |
| `event` | string | The Telnyx event type that was processed. |
| `sim_card_id` | string | The SIM card identifier associated with the event. |

#### 400 Bad Request

```json
{
  "error": "Invalid request body"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Generic error message. No internal details are exposed. |

#### 401 Unauthorized

```json
{
  "error": "Invalid signature"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Returned when the Ed25519 signature verification fails. |

#### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Generic error message. Exception details are logged server-side but never returned to the client. |

### Status Codes

| Status Code | Meaning | Description |
|-------------|---------|-------------|
| 200 | OK | Webhook event was received, signature verified, and dispatched to the appropriate SIMAgent instance. |
| 400 | Bad Request | The request body is malformed or missing required fields. |
| 401 | Unauthorized | The Telnyx Ed25519 signature could not be verified. |
| 500 | Internal Server Error | An unexpected error occurred while processing the webhook. Details are logged internally. |

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `Content-Type` | string | Yes | Must be `application/json`. |
| `Telnyx-Signature` | string | Yes | The Ed25519 signature header sent by Telnyx for webhook verification. |

### Notes

- **Signature Verification**: The handler uses `telnyx.webhooks.unwrap(rawBody, signature)` to verify the Ed25519 signature before processing the event. Requests with invalid signatures are rejected with a 401.
- **Agent Dispatch**: After verification, the handler extracts the `sim_card_id` from the payload and routes the event to the corresponding `SIMAgent` instance via the Telnyx Edge SDK's agent dispatch mechanism.
- **Safe Demo Mode**: In demo mode, the agent logs all outbound actions (SMS sends, call initiations, plan upgrades) instead of executing them against the live Telnyx API. Switch to live mode by setting `TELNYX_DEMO_MODE=false` in the environment.
- **No Real Phone Numbers**: All phone numbers in this sample use placeholder formats (e.g., `+1555XXXXXXXX`). Replace with real numbers only when switching to live mode.
