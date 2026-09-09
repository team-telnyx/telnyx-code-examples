# API Reference — AI-Powered Call Router

Edge function endpoints exposed by the deployed `ai-powered-call-router` function.

## Voice Webhook

### POST /webhook

Telnyx Call Control webhook handler. Receives call lifecycle events and drives the `RouterAgent` actor (one instance per `call_control_id`).

**Request body**: Telnyx Call Control event envelope (JSON). The handler reads `data.event_type` and `data.payload`.

**Handled events**:

| Event | Action |
|-------|--------|
| `call.initiated` (`direction: incoming`) | `actor.recordStart()` → `POST /calls/{id}/actions/answer` |
| `call.answered` | `actor.setGreeting()` → `POST /calls/{id}/actions/speak` (greeting, `client_state: {speak_stage: "greeting"}`) |
| `call.speak.ended` (`speak_stage: greeting`) | `actor.setGathering()` → `POST /calls/{id}/actions/gather_using_ai` |
| `call.speak.ended` (`speak_stage: announcement`) | `actor.setTransferring()` → `POST /calls/{id}/actions/transfer` to `actor.destination` |
| `call.ai_gather.ended` | `actor.classifyAndRoute(speech)` → `actor.setAnnouncing()` → `POST /calls/{id}/actions/speak` (announcement) |
| `call.ai_gather.failed` | `actor.setAnnouncing("support", DEFAULT)` → `POST /calls/{id}/actions/speak` (fallback announcement) |
| `call.hangup` | `actor.onHangup()` |
| `call.initiated` (`direction: outgoing`) | Ignored (transfer legs are not routed) |

**Responses**:

| Status | Body | When |
|--------|------|------|
| 200 | `{"action": "answering" | "greeting" | "gathering" | "announcing" | "transferring" | "done" | "noop", ...}` | Event processed |
| 400 | `{"error": "no event_type in payload" | "no call_control_id in payload" | "invalid json body"}` | Malformed webhook |
| 500 | `{"error": "TELNYX_API_KEY not configured"}` | Missing secret |
| 502 | `{"action": "error", "step": "answer" | "greeting_speak" | "gather_using_ai" | "transfer", "status": <int>, "err": <string>}` | Call Control REST call failed |

**Speech extraction** (`call.ai_gather.ended`):
1. `payload.result.utterance` (string) — preferred
2. Last `payload.message_history[]` entry with `role: "user"` — fallback

---

## Admin: Routes (KV)

### GET /routes

List all route entries in the KV namespace (keys with prefix `route/`).

**Response 200**:
```json
{
  "routes": {
    "route/billing": "+17177247292",
    "route/sales": "+18005556789",
    "route/support": "+18005550000"
  },
  "count": 3
}
```

**Response 500**: `{"error": "<message>"}` — KV binding error.

### POST /routes

Set a route destination for an intent in KV.

**Request body**:
```json
{
  "intent": "billing",
  "destination": "+17177247292"
}
```

**Validation**:
- `intent` must be one of: `billing`, `sales`, `support`
- `destination` must be a valid E.164 phone number (string)

**Response 200**:
```json
{
  "ok": true,
  "key": "route/billing",
  "destination": "+17177247292"
}
```

**Response 400**: `{"error": "intent and destination are required"}` or `{"error": "intent must be one of: billing, sales, support"}`

---

## Debug

### GET /debug/state?call_control_id=...

Inspect the current state of a `RouterAgent` actor instance.

**Query params**:
- `call_control_id` (required) — the call control ID of the call to inspect

**Response 200**:
```json
{
  "callControlId": "v3:...",
  "from": "+17177247292",
  "to": "+16282564655",
  "phase": "transferring",
  "speech": "I need to pay my bill",
  "intent": "billing",
  "destination": "+17177247292",
  "startedAt": 1788204010000,
  "endedAt": 0,
  "error": ""
}
```

**Response 400**: `{"error": "call_control_id query param is required"}`

---

## Health

### GET /health/liveness
### GET /health/readiness

**Response 200**: `ok` (text/plain)

---

## Call Control REST (invoked internally, not exposed)

The function calls these Telnyx endpoints with the injected `TELNYX_API_KEY`:

| Endpoint | When |
|----------|------|
| `POST /v2/calls/{id}/actions/answer` | `call.initiated` (incoming) |
| `POST /v2/calls/{id}/actions/speak` | `call.answered` (greeting), `call.ai_gather.ended` (announcement) |
| `POST /v2/calls/{id}/actions/gather_using_ai` | `call.speak.ended` (greeting) |
| `POST /v2/calls/{id}/actions/transfer` | `call.speak.ended` (announcement) |

## AI Inference (invoked via binding, not exposed)

`this.env.TELNYX.ai.openai.chat.createCompletion()` — called inside `RouterAgent.classifyAndRoute()` to classify the caller's speech into one of `billing`/`sales`/`support`. Zero-credential (the `[telnyx]` binding is pre-authenticated by the runtime).

## KV (invoked via binding, not exposed)

`this.env.ROUTES.get('route/<intent>')` — called inside `RouterAgent.classifyAndRoute()` to look up the transfer destination for the classified intent. Zero-credential (the `[storage.kv.ROUTES]` binding is pre-authenticated by the runtime).
