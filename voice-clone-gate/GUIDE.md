# Voice-Clone Gate on Clinic Callback Line — Developer Guide

This guide walks you through the `voice-clone-gate` sample: a Telnyx Edge actor that acts as a **fraud gate** on a clinic's outbound callback line. Every time clinic staff call a patient back (refill approvals, test results, appointment changes), the `VoiceGate` actor dials with **Telnyx Deepfake Detection** enabled, treats the detection webhook as a durable policy event, and enforces a fail-closed, per-recipient strike policy.

---

## Prerequisites

- A Telnyx account with a [Deepfake Detection](https://developers.telnyx.com/docs/voice/programmable-voice/deepfake-detection)-enabled connection
- Node.js 18+ and `npx`
- The Telnyx Edge CLI: `npm install -g @telnyx/edge-cli`
- An API key with permissions to place calls, send SMS, and receive webhooks

---

## Environment Setup

### 1. Clone and install

```bash
cd voice-clone-gate
npm install
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` declares the actor binding, secrets, and SQL storage:

```toml
name = "voice-clone-gate"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "GATES"
type    = "VoiceGate"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.GATE_DB]
id = "<sql-database-uuid>"
```

> Replace `<sql-database-uuid>` with your actual SQL database namespace UUID from the Telnyx UI.

### 3. Set environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `OUTBOUND_CONNECTION_ID` | Telnyx Call Control connection ID | — |
| `OUTBOUND_CALLER_ID` | E.164 caller ID for outbound calls | — |
| `DF_TIMEOUT_S` | Deepfake detection timeout (5–60s) | `15` |
| `DF_RTP_TIMEOUT_S` | RTP stream timeout (5–120s) | `30` |
| `STRIKE_LIMIT` | Synthetic verdicts before manual-confirm | `2` |
| `INCIDENT_SMS_E164` | Clinic phone number for incident SMS | — |
| `DIAL_WINDOW_START` | Business hours start (HH:MM) | `09:00` |
| `DIAL_WINDOW_END` | Business hours end (HH:MM) | `17:00` |
| `INCONCLUSIVE_RETRY_MAX` | Retries on error before parking | `1` |
| `MAX_CALL_MINUTES` | Max call duration | `600` |
| `DEMO_MODE` | `true` = no real calls/SMS | `true` |

### 4. Authenticate and deploy

```bash
telnyx-edge auth api-key set <your_api_key>
telnyx-edge types       # regenerate telnyx-env.d.ts
telnyx-edge ship        # deploy the actor
```

---

## How It Works — Step by Step

### 1. Staff requests an action → Actor is born

When clinic staff need to call a patient back, they invoke the RPC:

```
POST /rpc/requestAction
{ "patient": "+15551234567", "kind": "refill_approval", "payload": {...} }
```

The default fetch handler (at the bottom of `src/index.ts`) routes this to:

```typescript
const stub = env.GATES.idFromName(patientPhoneDigits);
const result = await stub.requestAction(body);
```

This **self-provisions** a `VoiceGate` actor — one durable actor per patient phone line. The actor's `requestAction` RPC method:

- Validates the phone number
- Checks the per-recipient **strike count** from SQL (`incidents` table)
- If strikes ≥ `STRIKE_LIMIT`, parks the action and sets `manualConfirm` policy
- Otherwise, inserts the action into `pending_actions` (SQL) and schedules a dial within business hours

### 2. Dial window scheduling

The actor calculates the delay until the next business-hours window using `msToBusinessWindow()`. If it's currently within business hours, the delay is 0. If after hours, it schedules for the next day's window start. The dial is scheduled via:

```typescript
this.schedule(delaySec, "dial", { actionId });
```

This uses the Agent SDK's `schedule()` primitive — the task is **durable across restarts**.

### 3. Dialing with Deepfake Detection

When the `dial` task fires, the actor calls `dialOut(recipient)`, which makes a `POST /v2/calls` request with:

```json
{
  "connection_id": "<OUTBOUND_CONNECTION_ID>",
  "to": "<recipient>",
  "from": "<OUTBOUND_CALLER_ID>",
  "deepfake_detection": {
    "enabled": true,
    "timeout": 15,
    "rtp_timeout": 30
  }
}
```

Telnyx streams the audio from the call and analyzes it for synthetic voice patterns.

### 4. Receiving the verdict webhook

Telnyx sends webhooks to `/webhook`. The default fetch handler routes them to the correct actor instance using `call_control_id` or `call_id` as the actor name key:

```typescript
const callId = body.payload?.call_control_id || body.payload?.call_id;
const stub = env.GATES.idFromName(callId);
const result = await stub.fetch(req);
```

Inside the actor's `fetch()` method, three event types are handled:

| Event | Handler | Behavior |
|---|---|---|
| `call.deepfake_detection.result` | `handleDeepfakeResult` | Processes verdict (human/synthetic) |
| `call.deepfake_detection.error` | `handleDeepfakeError` | Fail-closed retry or park |
| `call-hangup` | `handleHangup` | Marks completed if human |

### 5. Human verdict → proceed with action

When `verdict === "human"`:

- An `Incident` record is inserted into SQL (append-only ledger)
- The action status is updated to `completed`
- `proceedAction()` is called — in a real clinic system, this would execute the prescription change, card update, etc. Here it logs the attestation
- The call is hung up

### 6. Synthetic verdict → void and notify

When `verdict === "synthetic"`:

- An `Incident` record is inserted with the synthetic verdict and confidence score
- The action is **voided** (status set to `voided` in SQL)
- A **strike** is recorded for the recipient
- If this is the second strike, the recipient is moved to `manualConfirm` policy
- The clinic is notified via SMS: `this.env.TELNYX.messages.send({ to, from, text })`

### 7. Error / inconclusive → fail-closed

When `call.deepfake_detection.error` fires (or the result webhook never arrives within the timeout):

- If `retryCount < INCONCLUSIVE_RETRY_MAX`, the actor reschedules the dial after 5 seconds
- If retries are exhausted, the action is **parked** for staff review — it never proceeds without a verdict

### 8. Two synthetic strikes → manual-confirm policy

The `getStrikeCount()` method queries the `incidents` table for synthetic verdicts per recipient. When the count reaches `STRIKE_LIMIT` (default 2):

- `setManualConfirm(recipient, true)` is called
- Future `requestAction` calls for that recipient are immediately parked
- The action stays parked — it is **not silently dropped**

### 9. Restart proof

All durable state lives in SQL (`pending_actions` and `incidents` tables) and the actor's merge-patched state. If the actor is killed between dial and verdict:

- The pending action survives in SQL
- On wake, the actor's `initialState()` restores in-memory state
- The late verdict webhook is still routed to the correct actor and enforced

---

## Demo Mode vs Live Mode

### Demo Mode (default)

`DEMO_MODE=true` is the default. In demo mode:

- `dialOut()` is **not called** — instead, `simulateVerdict()` is scheduled after 2 seconds
- The simulated verdict is `human` with 0.99 confidence
- `notifyClinicIncident()` logs to console instead of sending real SMS
- No real Telnyx API calls are made — no charges, no real calls

To test the synthetic path in demo mode, you can manually trigger a simulated synthetic verdict:

```bash
# After deploying, send a simulated synthetic verdict
curl -X POST "https://<your-worker-url>/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "call.deepfake_detection.result",
    "payload": {
      "call_control_id": "<action_recipient_digits>",
      "verdict": "synthetic",
      "confidence": 0.95
    }
  }'
```

### Live Mode

Set `DEMO_MODE=false` and ensure all environment variables are configured with real Telnyx credentials. In live mode:

- Real outbound calls are placed with Deepfake Detection enabled
- Real SMS notifications are sent to the clinic
- Real webhooks from Telnyx are processed

---

## Key Telnyx Primitives Used

### Agent SDK (`@telnyx/edge-runtime`)

- **`Agent<GateEnv, GateState>`** — base class providing durable state, scheduling, and RPC
- **`@rpc`** — decorator marking `requestAction` as an RPC-callable method
- **`this.schedule(delaySec, method, payload)`** — durable scheduled tasks for dial windows and retries
- **`this.setState(patch)`** — merge-patch state updates (in-memory + durable)
- **`this.env.GATE_DB`** — SQL database binding for `pending_actions` and `incidents` tables
- **`this.env.TELNYX.messages.send()`** — zero-credential SMS via the `[telnyx]` binding

### Call Control API

- **`POST /v2/calls`** — places outbound calls with `deepfake_detection: {enabled: true, timeout, rtp_timeout}`
- **`call.deepfake_detection.result`** webhook — delivers `verdict` and `confidence`
- **`call.deepfake_detection.error`** webhook — delivers inconclusive/error state
- **`call-hangup`** webhook — confirms call termination

### Deepfake Detection

- Per-call audio analysis streamed by Telnyx
- `timeout` (5–60s): max time to wait for a verdict
- `rtp_timeout` (5–120s): max time to wait for RTP stream
- Verdicts: `human`, `synthetic`, or error (inconclusive)

### Messaging

- `this.env.TELNYX.messages.send({ to, from, text })` — sends incident notifications to the clinic

### SQL Storage

Two tables form the durable fraud ledger:

```sql
CREATE TABLE pending_actions (
  actionId TEXT PRIMARY KEY,
  patient TEXT,
  kind TEXT,
  payload TEXT,
  status TEXT,
  recipient TEXT,
  createdAt INTEGER,
  retryCount INTEGER
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  recipient TEXT,
  verdict TEXT,
  confidence REAL,
  actionId TEXT,
  ts INTEGER
);
```

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `VoiceGate` class loads, the `requestAction` RPC method exists, and all required environment bindings are declared.

---

## Next Steps

- [Telnyx Deepfake Detection docs](https://developers.telnyx.com/docs/voice/programmable-voice/deepfake-detection)
- [Call Control API reference](https://developers.telnyx.com/api-reference/call-control)
- [Deepfake Detection result webhook](https://developers.telnyx.com/api-reference/callbacks/call-deepfake-detection-result)
- [Deepfake Detection error webhook](https://developers.telnyx.com/api-reference/callbacks/call-deepfake-detection-error)
- [Messaging API — send message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Agent SDK — scheduled tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Agent SDK — SQL storage](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Stateful Actors — lifecycle](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/lifecycle)
- [Telnyx Edge CLI reference](https://developers.telnyx.com/docs/edge-compute/telnyx-edge-cli)
