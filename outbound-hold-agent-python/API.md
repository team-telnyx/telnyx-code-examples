# API Reference

## `GET /health`

Returns dry-run status, missing real-call configuration, and session count.

## `POST /calls/outbound`

Creates an outbound call session and dials the target number.

```json
{
  "to": "+15551234567",
  "objective": "book a hotel reservation for Friday night",
  "target_company": "Willow Creek Hotel",
  "context": {
    "guest_name": "Alex Morgan",
    "party_size": 2
  }
}
```

## `POST /webhooks/telnyx`

Receives Telnyx call lifecycle and transcription events. The app starts the IVR assistant on `call.answered`, enters hold monitoring on hold signals, and starts the representative assistant when pickup is detected.

Handled events:

- `call.answered`
- `call.hold`
- `call.unhold`
- `call.transcription`
- `call.hangup`

## `POST /tools/send-dtmf`

Assistant tool endpoint for backend-owned IVR menu input.

```json
{
  "call_control_id": "v3:...",
  "digits": "1",
  "reason": "reservations menu option"
}
```

If `call_control_id` is omitted, the example uses the most recent active call.

## `POST /tools/hold-detected`

Assistant tool endpoint for explicit hold detection.

```json
{
  "call_control_id": "v3:...",
  "reason": "please hold for the next available representative",
  "confidence": 0.92
}
```

## `POST /tools/end-call`

Assistant tool endpoint for ending the call after the task is complete.

```json
{
  "call_control_id": "v3:...",
  "reason": "reservation completed"
}
```

## `GET /fake-company/texml`

Returns a deterministic TeXML fake company menu for local and real-call testing.

## `GET/POST /fake-company/menu`

Receives the fake company menu DTMF selection and returns hold plus representative pickup TeXML.

## `GET /media/dtmf/{digit}.wav`

Serves generated DTMF feedback audio for demo playback.

## `GET /sessions`

Lists in-memory call sessions with state, transcript snippets, and orchestration events.

## `GET /sessions/{session_id}`

Returns one in-memory call session.
