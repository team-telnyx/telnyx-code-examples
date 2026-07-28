## `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Events handled:** `call.answered`, `call.gather.ended`, `call.hangup`

**Example payload (`call.answered`):**

```json
{
  "data": {
    "event_type": "call.answered",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "from": "+17175551234",
      "to": "+18005551234"
    }
  }
}
```

**Example payload (`call.gather.ended`):**

```json
{
  "data": {
    "event_type": "call.gather.ended",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "from": "+17175551234",
      "speech": {
        "result": "Hi, this is John from the warranty department calling about your vehicle coverage",
        "confidence": 0.91
      }
    }
  }
}
```

**Response:**

```json
{
  "action": "blocked",
  "judgment": {
    "verdict": "robocall",
    "confidence": 0.95,
    "reason": "Generic sales pitch with no specific recipient named."
  }
}
```

---

## `GET /stats`

Returns cumulative stats for the screened number.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `number` | `string` | `TELNYX_PHONE_NUMBER` | Screened phone number (E.164) |

### Response `200`

```json
{
  "number": "+18005551234",
  "total_calls": 15,
  "blocked": 9,
  "forwarded": 6,
  "blocklist": ["+18005559999", "+12125550000"]
}
```

**Try it:**

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/stats
```

---

## `GET /calls`

Returns recent call records (most recent first).

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `number` | `string` | `TELNYX_PHONE_NUMBER` | Screened phone number |
| `limit` | `integer` | `20` | Max results (1-50) |

### Response `200`

```json
{
  "calls": [
    {
      "call_control_id": "v3:...",
      "from": "+17175551234",
      "to": "+18005551234",
      "answered_at": "2026-07-22T14:30:00Z",
      "status": "blocked",
      "transcript": "Hi, this is John from the warranty department...",
      "verdict": "robocall",
      "confidence": 0.95,
      "reason": "Generic sales pitch."
    }
  ]
}
```

**Try it:**

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/calls
```

---

## `POST /blocklist/clear`

Clears the blocklist for a number.

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `number` | `string` | `TELNYX_PHONE_NUMBER` | Screened phone number |

### Response `200`

```json
{
  "number": "+18005551234",
  "total_calls": 15,
  "blocked": 9,
  "forwarded": 6,
  "blocklist": []
}
```

**Try it:**

```bash
curl -X POST https://edge-robo-call-screener-<id>.telnyxcompute.com/blocklist/clear
```

---

## `GET /health/{liveness,readiness}`

Health check endpoints.

### Response `200`

```
ok
```

**Try it:**

```bash
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/health/liveness
curl https://edge-robo-call-screener-<id>.telnyxcompute.com/health/readiness
```

---

## Error Handling

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `404` | Unknown route |
| `500` | Server error (check Edge function logs) |
