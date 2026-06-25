# API Reference

This example exposes one Telnyx webhook route and one health route.

## `POST /webhooks/voice`

Receives Telnyx Voice API webhook events.

### `call.initiated`

Inbound calls are answered with the Voice API Answer Call command.

Request:

```json
{
  "data": {
    "event_type": "call.initiated",
    "payload": {
      "call_control_id": "v3:abc123",
      "direction": "incoming",
      "from": { "number": "+12125551234" },
      "to": { "number": "+15551111111" }
    }
  }
}
```

Response:

```json
{
  "status": "answering",
  "call_control_id": "v3:abc123"
}
```

### `call.answered`

After the Telnyx Voice API call is answered, the server selects a business config and starts the base Telnyx AI Assistant with runtime instructions.

Request:

```json
{
  "data": {
    "event_type": "call.answered",
    "payload": {
      "call_control_id": "v3:abc123",
      "to": { "number": "+15551111111" }
    }
  }
}
```

Response:

```json
{
  "status": "ai_assistant_started",
  "call_control_id": "v3:abc123",
  "business_config": "smile-dental",
  "business_name": "Smile Dental"
}
```

### `client_state` Routing

For optional outbound testing, `client_state` can select a business config:

```json
{
  "business_config": "northside-medical"
}
```

The value must be base64-encoded before being sent through Telnyx Voice API. If `client_state` is present and valid, it takes priority over called-number routing.

### Other Events

Events other than `call.initiated` and `call.answered` are acknowledged without a Voice API action.

Response:

```json
{
  "status": "acknowledged",
  "event_type": "call.hangup",
  "call_control_id": "v3:abc123"
}
```

## `GET /health`

Health check endpoint.

Request:

```bash
curl http://localhost:5000/health
```

Response:

```json
{
  "status": "ok",
  "webhook": "/webhooks/voice",
  "configs": ["smile-dental", "northside-medical", "brightcare-physical-therapy"]
}
```

## Telnyx API Endpoints Called

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v2/calls/{call_control_id}/actions/answer` | Answer inbound Telnyx Voice API calls on `call.initiated` |
| `POST` | `/v2/calls/{call_control_id}/actions/ai_assistant_start` | Start the reusable Telnyx AI Assistant with runtime instructions and greeting |
| `POST` | `/v2/calls` | Optional Telnyx Voice API outbound test call helper |

## Error Handling

All server responses are JSON.

| Status | Meaning | Trigger |
|--------|---------|---------|
| `200` | Success | Webhook event was handled or acknowledged |
| `400` | Bad request | Missing `call_control_id`, missing number route, unknown config, or missing environment variable |
| `401` | Invalid signature | `TELNYX_PUBLIC_KEY` is configured and the webhook signature is invalid or missing |
| `4xx/5xx` | Telnyx API error | Voice API returned an error for answer, start assistant, or create call |
| `500` | Server error | Unexpected exception |

Example error:

```json
{
  "error": "no business config mapped for called number +15550000000"
}
```
