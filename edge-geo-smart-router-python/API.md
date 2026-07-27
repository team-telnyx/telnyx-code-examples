# API Reference -- Edge Geo Smart Router

Base URL: `http://localhost:5000`

## All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Voice |
| `GET` | `/regions` | Regions |
| `GET` | `/health` | Health |

---

## `POST /webhooks/voice`

Telnyx webhook handler.

### Events Handled

| Event | Description |
|-------|-------------|
| `call.initiated` | New inbound or outbound call detected |
| `call.answered` | Call connected, app begins interaction with greeting |
| `call.gather.ended` | Caller input received (speech or DTMF), app processes response |
| `call.recording.saved` | Recording available for download |
| `call.hangup` | Call ended, cleans up session state and logs outcome |

### Response `200`

```json
{"status": "ok"}
```

---

## `GET /regions`

Returns the per-region routing config (language, voice, recording, consent). `greeting` is omitted.

### Response `200`

```json
{
  "regions": {
    "US":     {"language": "en-US", "voice": "AWS.Polly.Joanna-Neural", "record": true,  "requires_consent": false},
    "LATAM":  {"language": "es-MX", "voice": "AWS.Polly.Lupe-Neural",   "record": true,  "requires_consent": false},
    "EU":     {"language": "en-GB", "voice": "AWS.Polly.Amy-Neural",     "record": false, "requires_consent": true},
    "DEFAULT":{"language": "en-US", "voice": "AWS.Polly.Joanna-Neural", "record": true,  "requires_consent": false}
  }
}
```

### Try it

```bash
curl http://localhost:5000/regions
```

---

## `GET /health`

Health check with active call count.

### Response `200`

```json
{"status": "ok", "service": "edge-geo-smart-router", "active_calls": 0}
```

### Try it

```bash
curl http://localhost:5000/health
```

---

## Error Handling

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|--------|
| `200` | Success |
| `400` | Bad request (missing payload, missing `call_control_id`) |
| `401` | Webhook signature verification failed (`telnyx-signature-ed25519` / `telnyx-timestamp` missing, stale, or invalid) |
| `500` | Server error |
