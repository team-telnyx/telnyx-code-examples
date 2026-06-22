# API Reference — Record Phone Calls

Endpoints exposed by `server.js`. The server listens on `$PORT` (default `3000`; `.env.example` sets `5000`). All responses are JSON.

## `POST /calls/initiate`

Initiate an outbound call from `TELNYX_PHONE_NUMBER` using the configured Call Control Application.

### Request

```json
{
  "to": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number in E.164 format (must start with `+`) |

### Response `200`

```json
{
  "call_control_id": "v3:abc123...",
  "to": "+12125559999",
  "from": "+15551234567",
  "status": "initiated"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | Identifier used by the recording and status endpoints |
| `to` | `string` | Destination number |
| `from` | `string` | Caller ID (your Telnyx number) |
| `status` | `string` | Always `initiated` on success |

### Try it

```bash
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999"}'
```

---

## `POST /calls/:callControlId/recording/start`

Start recording an active call in WAV format.

### Path parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `callControlId` | `string` | **yes** | The `call_control_id` returned by `/calls/initiate` |

### Response `200`

```json
{
  "call_control_id": "v3:abc123...",
  "recording_id": "rec-7f9c...",
  "format": "wav",
  "status": "recording"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | The call being recorded |
| `recording_id` | `string` | Telnyx recording identifier |
| `format` | `string` | Always `wav` |
| `status` | `string` | Always `recording` on success |

### Try it

```bash
curl -X POST http://localhost:5000/calls/v3:abc123.../recording/start
```

---

## `POST /calls/:callControlId/recording/stop`

Stop recording an active call.

### Path parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `callControlId` | `string` | **yes** | The `call_control_id` being recorded |

### Response `200`

```json
{
  "call_control_id": "v3:abc123...",
  "recording_id": "rec-7f9c...",
  "status": "stopped"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | The call that was recorded |
| `recording_id` | `string` | Telnyx recording identifier |
| `status` | `string` | Always `stopped` on success |

### Try it

```bash
curl -X POST http://localhost:5000/calls/v3:abc123.../recording/stop
```

---

## `GET /calls/:callControlId/status`

Retrieve the in-memory status of a call and its recording.

### Path parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `callControlId` | `string` | **yes** | The `call_control_id` to look up |

### Response `200`

```json
{
  "call_control_id": "v3:abc123...",
  "to": "+12125559999",
  "from": "+15551234567",
  "status": "answered",
  "recording_id": "rec-7f9c...",
  "recording_status": "recording"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `call_control_id` | `string` | The call identifier |
| `to` | `string` | Destination number |
| `from` | `string` | Caller ID |
| `status` | `string` | `initiated` or `answered` |
| `recording_id` | `string` \| `null` | Recording identifier, or `null` if not started |
| `recording_status` | `string` | `not_started`, `recording`, or `stopped` |

### Try it

```bash
curl http://localhost:5000/calls/v3:abc123.../status
```

---

## `POST /webhooks/call`

Receives Telnyx call lifecycle webhooks and updates in-memory call state. Configure this URL on your Call Control Application.

### Request (Telnyx webhook payload)

```json
{
  "data": {
    "event_type": "call.recording.saved",
    "call_control_id": "v3:abc123...",
    "recording_id": "rec-7f9c...",
    "recording_urls": { "wav_url": "https://.../recording.wav" }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | One of `call.answered`, `call.hangup`, `call.recording.saved` |
| `data.call_control_id` | `string` | The call the event applies to |
| `data.recording_id` | `string` | Present on `call.recording.saved` |
| `data.recording_urls.wav_url` | `string` | Download URL, present on `call.recording.saved` |

Handler behavior:

| Event | Action |
|-------|--------|
| `call.answered` | Marks the tracked call `answered` |
| `call.hangup` | Removes the call from the in-memory store |
| `call.recording.saved` | Logs and stores the recording WAV download URL |

### Response `200`

```json
{
  "received": true
}
```

---

## Telnyx API endpoints called by this app

| SDK call | HTTP endpoint | Reference |
|----------|---------------|-----------|
| `client.calls.dial()` | `POST /v2/calls` | [Dial](https://developers.telnyx.com/api-reference/call-commands/dial) |
| `client.calls.actions.startRecording()` | `POST /v2/calls/{call_control_id}/actions/record_start` | [Recording start](https://developers.telnyx.com/api-reference/call-commands/recording-start) |
| `client.calls.actions.stopRecording()` | `POST /v2/calls/{call_control_id}/actions/record_stop` | [Recording stop](https://developers.telnyx.com/api-reference/call-commands/recording-stop) |

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing `to`, invalid E.164, or unset env var |
| `401` | Invalid API key |
| `404` | Call control ID not found in the in-memory store |
| `429` | Rate limit exceeded |
| `500` | Telnyx API status error |
| `503` | Network error connecting to Telnyx |
