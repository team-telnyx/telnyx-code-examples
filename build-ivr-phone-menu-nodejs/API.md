# API Reference

This Express app exposes four HTTP routes. The three `/webhooks/*` routes receive Telnyx Call Control webhook events; `/health` is a monitoring probe. All routes return JSON.

## `POST /webhooks/call-initiated`

Handles the `call.initiated` event. Answers the call, stores call state, then speaks the menu greeting and collects a single DTMF digit in one `gather_using_speak` command.

### Request

```json
{
  "data": {
    "event_type": "call.initiated",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.call_control_id` | `string` | **yes** | Telnyx call control ID for the inbound call |

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /webhooks/dtmf-received`

Handles the `call.dtmf.received` event. Routes the call based on the pressed digit.

### Request

```json
{
  "data": {
    "event_type": "call.dtmf.received",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "dtmf": { "digits": "1" }
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.call_control_id` | `string` | **yes** | Telnyx call control ID for the active call |
| `data.payload.dtmf.digits` | `string` | **yes** | Digit the caller pressed |

### DTMF Menu Options

| Digit | Action |
|-------|--------|
| `1` | Speak "Transferring to sales", then transfer to the sales number |
| `2` | Speak "Transferring to support", then transfer to the support number |
| `3` | Repeat the menu prompt and gather DTMF again |
| any other | Speak "Invalid selection" and gather DTMF again |

### Response `200`

```json
{ "status": "ok" }
```

---

## `POST /webhooks/call-hangup`

Handles the `call.hangup` event. Deletes the call's in-memory state.

### Request

```json
{
  "data": {
    "event_type": "call.hangup",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.call_control_id` | `string` | **yes** | Telnyx call control ID for the ended call |

### Response `200`

```json
{ "status": "ok" }
```

---

## `GET /health`

Health check for monitoring. Takes no request body.

### Response `200`

```json
{
  "status": "healthy",
  "timestamp": "2026-06-18T14:30:00.000Z"
}
```

---

## Telnyx API Endpoints Called

The app calls these Telnyx Call Control endpoints via the Node.js SDK (`client.calls.actions.*`):

| SDK method | HTTP endpoint | Used in |
|------------|---------------|---------|
| `client.calls.actions.answer(callControlId)` | `POST /v2/calls/{call_control_id}/actions/answer` | `call-initiated` |
| `client.calls.actions.gatherUsingSpeak(callControlId, { payload, voice, language, maximum_digits, timeout_millis })` | `POST /v2/calls/{call_control_id}/actions/gather_using_speak` | greeting menu, repeat, invalid retry |
| `client.calls.actions.speak(callControlId, { payload, voice, language })` | `POST /v2/calls/{call_control_id}/actions/speak` | transfer prompts |
| `client.calls.actions.transfer(callControlId, { to })` | `POST /v2/calls/{call_control_id}/actions/transfer` | digit `1` (sales), digit `2` (support) |

## Error Handling

Errors are returned as JSON by the Express error middleware:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `401` | Invalid API key (`Telnyx.AuthenticationError`) |
| `429` | Rate limit exceeded (`Telnyx.RateLimitError`) |
| `500` | Internal server error or unhandled Telnyx API error |
| `503` | Network error connecting to Telnyx (`Telnyx.APIConnectionError`) |
