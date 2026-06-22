# API Reference

This service exposes two HTTP routes. The webhook route is driven by Telnyx
Voice API `call.*` events; the health route is for monitoring.

## `POST /webhooks/inbound-call`

Receives inbound call webhooks from Telnyx. On a `call.initiated` event the
server answers the call via Call Control. For any other `event_type` it
acknowledges the event without taking an action.

### Request

```json
{
  "data": {
    "event_type": "call.initiated",
    "call_control_id": "v3:abc123",
    "from": "+12125551234",
    "to": "+13105557890"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | `object` | **yes** | Telnyx webhook payload wrapper. Request is rejected with `400` if absent. |
| `data.call_control_id` | `string` | **yes** | Call Control identifier for the call. Request is rejected with `400` if absent. |
| `data.event_type` | `string` | no | Telnyx call event. Only `call.initiated` triggers an answer; all others are acknowledged. |
| `data.from` | `string` | no | Caller number in E.164 format. Echoed back on `call.initiated`. |
| `data.to` | `string` | no | Destination (your Telnyx) number in E.164 format. Echoed back on `call.initiated`. |

### Response `200` — call answered (`event_type` = `call.initiated`)

```json
{
  "call_control_id": "v3:abc123",
  "status": "answered",
  "from": "+12125551234",
  "to": "+13105557890"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | Call Control identifier returned by the answer action. |
| `status` | `string` | Always `answered`. |
| `from` | `string` | Caller number from the webhook. |
| `to` | `string` | Destination number from the webhook. |

### Response `200` — event acknowledged (any other `event_type`)

```json
{
  "call_control_id": "v3:abc123",
  "status": "acknowledged",
  "event_type": "call.hangup"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | Call Control identifier from the webhook. |
| `status` | `string` | Always `acknowledged`. |
| `event_type` | `string` | The event type that was acknowledged. |

## `GET /health`

Health check endpoint for monitoring.

### Request

No parameters.

### Response `200`

```json
{
  "status": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `ok`. |

## Telnyx API Endpoints Called

| Method | Path | SDK call | Purpose |
|--------|------|----------|---------|
| `POST` | `/v2/calls/{call_control_id}/actions/answer` | `client.calls.actions.answer(callControlId)` | Answer the inbound call identified by `call_control_id`. |

## Error Handling

All routes return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning | Trigger |
|--------|---------|---------|
| `200` | Success | Call answered or event acknowledged. |
| `400` | Bad request | Missing `data` object or missing `call_control_id`. |
| `401` | Authentication error | Invalid `TELNYX_API_KEY` (`Telnyx.AuthenticationError`). |
| `429` | Rate limited | Too many requests (`Telnyx.RateLimitError`). |
| `503` | Upstream connection error | Network error reaching Telnyx (`Telnyx.APIConnectionError`). |
| `error.status` | Telnyx API status error | Propagated from `Telnyx.APIError`, with `status_code` in the body. |
| `500` | Server error | Any unexpected exception. |
