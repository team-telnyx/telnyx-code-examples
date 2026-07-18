# API Reference — Edge Compute Backend for AI Assistant

## Endpoints

All requests are `POST /` to the Edge Compute function URL. The handler dispatches on body shape.

### Signature Verification

Every request must include these headers (set by Telnyx):

| Header | Description |
|-------|-------------|
| `telnyx-signature-ed25519` | Base64-encoded Ed25519 signature |
| `telnyx-timestamp` | Unix timestamp (seconds) |

Signed message: `"{timestamp}|{raw_body}"`. Requests with missing, stale (>5 min skew), or invalid signatures receive `403 Forbidden`.

---

### POST `/` — Dynamic Variables

Resolves `{{variable}}` placeholders in the assistant's instructions and greeting at call start.

**Detection:** Body contains `data.event_type`.

#### Request

```json
{
  "data": {
    "event_type": "dynamic_variables",
    "payload": {
      "telnyx_conversation_channel": "voice",
      "telnyx_agent_target": "+16282564269",
      "telnx_end_user_target": "+17177247292",
      "call_control_id": "v3:abc123",
      "assistant_id": "assistant-..."
    }
  }
}
```

#### Response — 200 OK

```json
{
  "dynamic_variables": {
    "company_name": "Pinecrest Home Services",
    "timeframe": "two business days",
    "placeholder_transfer_destination": "+15551234567"
  }
}
```

> Variables **must** be nested under `dynamic_variables`. A flat object is silently ignored.

#### Error Responses

| Status | Cause |
|--------|-------|
| `400` | Malformed JSON body |
| `403` | Invalid or missing signature |
| `405` | Non-POST method |

---

### POST `/` — Webhook Tool: `schedule_estimate`

Called by the assistant when the LLM decides to schedule an on-site estimate.

**Detection:** Body is a flat JSON object (no `data` wrapper).

#### Request

```json
{
  "customer_name": "John Doe",
  "phone_number": "+17177247292",
  "service_type": "roof repair",
  "service_address": "123 Main St, San Francisco, CA",
  "preferred_date": "2025-04-10",
  "preferred_time": "10:00"
}
```

#### Response — 200 OK

```json
{
  "scheduled_date": "2025-04-10",
  "scheduled_time": "10:00",
  "confirmation_number": "CONF-1715234567",
  "estimate_id": "EST-1715234567"
}
```

#### Error Responses

| Status | Cause |
|--------|-------|
| `400` | Malformed JSON body |
| `403` | Invalid or missing signature |
| `405` | Non-POST method |

---

## Health Probes

The Edge Compute platform automatically handles `/health/liveness` and `/health/readiness` probes. Do not add custom health routes.
