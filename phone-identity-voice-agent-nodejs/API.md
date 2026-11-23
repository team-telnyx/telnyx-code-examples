# API Reference — Phone Identity Voice Agent

All endpoints accept and return JSON. Base URL in local development: `http://localhost:3000`.

---

## `POST /webhooks/call-events`

Receives Call Control webhook events from Telnyx. Verifies the Ed25519 signature (if `TELNYX_PUBLIC_KEY` is configured), then dispatches based on `event_type`.

### Handled events

| Event | Action |
|-------|--------|
| `call.initiated` (incoming) | Number Lookup + risk assessment + answer call |
| `call.answered` | Start AI Assistant with dynamic variables |
| `call.ai_assistant.started` | Update dashboard status |
| `call.hangup` | Mark call ended, compute duration |

### Request

```json
{
  "data": {
    "event_type": "call.initiated",
    "payload": {
      "call_control_id": "v3:xxx",
      "direction": "incoming",
      "from": "+15125551234",
      "to": "+18005551234"
    }
  }
}
```

### Response `200`

```json
{ "ok": true }
```

Always returns 200 immediately (webhook ACK). Processing happens asynchronously.

---

## `GET /stream`

Server-Sent Events (SSE) stream for the live dashboard. Sends events as `data: {json}\n\n` messages.

### SSE event types

| Event | Payload | Dashboard action |
|-------|---------|-----------------|
| `call.incoming` | `{ phone }` | Reset dashboard, show incoming animation |
| `lookup.started` | `{ phone }` | Skeleton loader in identity card |
| `lookup.complete` | `{ identity }` | Stagger-fill identity fields |
| `risk.assessed` | `{ score, level, factors }` | Animate trust bar, set glow color, show pills |
| `call.answered` | `{}` | Status badge → "ANSWERED" |
| `ai.starting` | `{ mode }` | Show AI launch status |
| `ai.started` | `{ mode, greeting }` | Status → "AI CONNECTED", show greeting mode |
| `ai.error` | `{ message }` | Show error in timeline |
| `call.ended` | `{ reason, duration }` | Status → "ENDED", stop timer |
| `state.reset` | `{}` | Reset to idle state |

### Response headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

### Try it

```bash
curl -N http://localhost:3000/stream
```

---

## `GET /api/state`

Returns the current call state snapshot. Used by the dashboard on initial page load to restore state if a call is in progress.

### Response `200`

```json
{
  "status": "ai_connected",
  "phone": "+15125551234",
  "callControlId": "v3:xxx",
  "callStartedAt": "2025-01-15T10:30:00.000Z",
  "identity": {
    "phone": "+15125551234",
    "name": "Sarah Johnson",
    "carrier": "T-Mobile",
    "lineType": "mobile",
    "confidence": 85,
    "location": "Austin, TX",
    "ported": "not_ported",
    "cnam": "Sarah Johnson",
    "trustScore": 85,
    "trustLevel": "trusted",
    "factors": [
      { "signal": "High identity confidence", "value": 85, "impact": "positive" },
      { "signal": "Caller name on file", "value": "Sarah Johnson", "impact": "positive" },
      { "signal": "Mobile line type", "value": "mobile", "impact": "positive" },
      { "signal": "Number not ported", "value": "original", "impact": "positive" },
      { "signal": "Address on file", "value": "Austin, TX", "impact": "positive" }
    ]
  },
  "dynamicVars": {
    "callerContext": "Verified customer: Sarah Johnson. mobile, T-Mobile. Confidence: 85. Austin, TX.",
    "behaviorInstructions": "Greet the caller by their first name (Sarah). They are a verified customer...",
    "greetingText": "Hello Sarah! Welcome back to Apex Bank. How can I help you today?"
  },
  "events": []
}
```

### Try it

```bash
curl http://localhost:3000/api/state | jq
```

---

## `POST /api/reset`

Clears the current call state and publishes a `state.reset` SSE event. Use this between demo recordings.

### Response `200`

```json
{ "ok": true }
```

### Try it

```bash
curl -X POST http://localhost:3000/api/reset
```

---

## `GET /lookup/:phone`

Manual Number Lookup for testing. Returns full lookup data, risk assessment, identity card structure, and dynamic variables — without making a phone call.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `:phone` | string | Phone number in E.164 format (e.g. `+15125551234`) |

### Response `200`

```json
{
  "identity": {
    "phone": "+15125551234",
    "name": "Sarah Johnson",
    "carrier": "T-Mobile",
    "lineType": "mobile",
    "confidence": 85,
    "location": "Austin, TX",
    "ported": "not_ported",
    "cnam": "Sarah Johnson",
    "trustScore": 85,
    "trustLevel": "trusted",
    "factors": []
  },
  "risk": {
    "score": 85,
    "level": "trusted",
    "factors": []
  },
  "dynamicVars": {
    "callerContext": "Verified customer: Sarah Johnson...",
    "behaviorInstructions": "Greet the caller by their first name...",
    "greetingText": "Hello Sarah! Welcome back to Apex Bank..."
  },
  "raw": {}
}
```

### Response `500`

```json
{ "error": "Lookup failed" }
```

### Try it

```bash
curl http://localhost:3000/lookup/+15125551234 | jq
```

---

## `GET /health`

Readiness probe. Returns whether the app is running and key services are configured.

### Response `200`

```json
{
  "status": "ok",
  "edge": false,
  "assistant": true
}
```

### Try it

```bash
curl http://localhost:3000/health
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `401` | Invalid webhook signature |
| `500` | Server error (lookup failure, internal error) |
