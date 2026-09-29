# API Reference — spam-smishing-filter

Typed endpoint reference for the Telnyx Edge Function that hosts the `SpamFilter` durable actor. All routes are HTTP POST unless otherwise noted.

---

## Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/watch` | Register a 10DLC business number for spam/smishing monitoring. Spawns one durable `SpamFilter` actor per number via `idFromName(number)`. |
| POST | `/inbound-message` | Telnyx inbound-SMS webhook. Routes the message to the `SpamFilter` actor for the destination number and returns `200 OK` immediately. |

---

## POST /watch

Register a phone number for spam/smishing filtering.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | string | Yes | E.164-formatted phone number to monitor (e.g. `+15551234567`). Must match `/^\+?[1-9]\d{1,14}$/`. |

### Example Request

```bash
curl -X POST https://<edge-function-url>/watch \
  -H "Content-Type: application/json" \
  -d '{"number": "+15551234567"}'
```

### Response Schema

**Status 200**

```json
{
  "status": "watching",
  "number": "+15551234567"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"watching"`. |
| `number` | string | The phone number now under monitoring. |

### Status Codes

| Code | Meaning | Response Body |
|------|---------|---------------|
| 200 | Number registered successfully | `{ "status": "watching", "number": "<number>" }` |
| 400 | Invalid phone number format | `{ "error": "Invalid phone number format" }` |
| 500 | Internal server error | `{ "error": "Internal server error" }` |

---

## POST /inbound-message

Telnyx inbound-SMS webhook handler. Receives the webhook payload, extracts the sender (`from`), recipient (`to`), message text, and message ID, then dispatches the message to the `SpamFilter` actor for the recipient number.

### Request Body

Telnyx webhook signature. The top-level structure is:

```json
{
  "data": {
    "payload": {
      "id": "msg_abc123",
      "from": "+15551112222",
      "to": "+15551234567",
      "text": "You've won a prize! Click http://bit.ly/scam to claim."
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.payload.id` | string | Yes | Telnyx message ID. Used as the stable task ID (`act:<messageId>`) for idempotency. |
| `data.payload.from` | string | Yes | Sender phone number (E.164). This is the sender whose reputation is being evaluated. |
| `data.payload.to` | string | Yes | Recipient phone number (E.164). This is the monitored 10DLC business number. |
| `data.payload.text` | string | Yes | Body of the inbound SMS message. Passed to the Jev Decision Models API for classification. |

### Example Request

```bash
curl -X POST https://<edge-function-url>/inbound-message \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "id": "msg_abc123",
        "from": "+15551112222",
        "to": "+15551234567",
        "text": "You've won a prize! Click http://bit.ly/scam to claim."
      }
    }
  }'
```

### Response Schema

**Status 200**

```json
"OK"
```

Plain-text response body `"OK"`. The HTTP response is returned immediately after dispatching the message to the actor; all spam filtering logic (Jev classification, blocklist checks, audit logging, re-evaluation) happens asynchronously inside the durable actor.

### Status Codes

| Code | Meaning | Response Body |
|------|---------|---------------|
| 200 | Webhook received and dispatched to the SpamFilter actor | `"OK"` |
| 404 | Unknown route | `"Not Found"` |
| 500 | Internal server error (e.g. actor dispatch failure) | `"Internal Server Error"` |

---

## Internal Actor RPC Methods

These methods are invoked internally by the Edge Function via the `ActorStub` and are not directly exposed as HTTP routes. They are documented here for completeness of the API contract.

### `watch(number: string): Promise<void>`

Initializes the actor's state with the monitored phone number and creates the SQL tables (`senderMsgs`, `blocklist`, `audit`) if they do not already exist.

### `onMessage(msg: { id: string; from: string; text: string }): Promise<void>`

Entry point for inbound messages. Schedules an idempotent task under the stable ID `act:<messageId>` to ensure each message is judged and acted upon exactly once, even under re-delivery.

### `act(msg: { id: string; from: string; text: string }): Promise<void>`

The idempotent task handler. Executes the full spam-filtering pipeline:

1. Checks the `acted:<messageId>` guard — returns immediately if already processed.
2. Checks the blocklist for the sender.
3. If blocked: checks cooldown elapsed → re-evaluates or discards silently.
4. If not blocked: calls the Jev Decision Models API with the message text and sender history.
5. Applies the decision policy (phishing/noul → immediate block; spam+score≥4 → block; spam+score<4 → escalate count; ok → deliver).
6. Records the `acted:<messageId>` guard.

---

## Jev Decision Models API (Internal)

The `SpamFilter` actor calls the Telnyx Decision Models (Beta) API internally. This is not an Edge Function route but is part of the API contract.

### Endpoint

```
POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Model identifier: `"telnyx/decision-flash"`. |
| `state.text` | string | Yes | The inbound SMS message text to classify. |
| `state.history` | array | Yes | Array of prior verdicts for this sender (up to 20 most recent), each containing `text`, `verdict`, and `ts`. |
| `questions` | array | Yes | Three question definitions: `choice` (ok/spam/phishing), `noul` (hard-stop flag), `score` (0–5 confidence). |

### Response Schema

| Field | Type | Description |
|-------|------|-------------|
| `choice` | string | One of `"ok"`, `"spam"`, `"phishing"`. |
| `noul` | number | 1 if hard stop (phishing/credential theft), 0 otherwise. |
| `score` | number | Spam confidence score from 0 (legit) to 5 (obviously malicious). |

### Retry Behavior

- **429 (rate limited)** or **502 (bad gateway)**: Retries up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 10s max) plus random jitter (0–500ms). Honors the `Retry-After` header if present.
- **Other 4xx/5xx**: Throws an error after exhausting retries.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELNYX_API_KEY` | Yes | — | Telnyx API key used to authenticate the Jev Decision Models API call. Loaded from Edge secrets. |
| `SPAM_PERMANENT_BLOCK_N` | No | `5` | Cumulative number of spam verdicts from a sender required to trigger a permanent `spam_reputation` block. |
| `SPAM_BLOCK_SCORE` | No | `4` | Minimum Jev `score` (0–5) at which a `spam` verdict triggers an immediate block. |
| `COOLDOWN_MS` | No | `3600000` | Cooldown period in milliseconds (default 1 hour) before a blocked sender can be re-evaluated. |
| `DEMO_MODE` | No | `true` | When `true` (default), no real SMS alerts are sent — actions are logged to console. Set to `false` for live mode. |
