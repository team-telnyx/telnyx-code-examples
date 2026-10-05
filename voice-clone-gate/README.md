---
name: voice-clone-gate
title: "Voice-Clone Gate on Clinic Callback Line"
description: "A stateful Telnyx Edge actor that gates outbound clinic callbacks with Deepfake Detection, enforcing fail-closed fraud policy across restarts."
language: typescript
framework: edge
telnyx_products: [Telnyx Voice, Telnyx Deepfake Detection, Telnyx Messaging, Telnyx Agent SDK, Telnyx Edge Compute]
---

# Voice-Clone Gate on Clinic Callback Line

A stateful Telnyx Edge actor that gates outbound clinic callbacks with Deepfake Detection, enforcing fail-closed fraud policy across restarts.

## The Story

A medical clinic's callback line is the last human touch before a patient receives a prescription refill approval, a lab result, or an appointment change. Staff dial patients back from the clinic's own number, and the patient — believing they're hearing their pharmacist or nurse — may confirm a dosage change, provide a card update, or consent to a procedure. If a fraudster uses a cloned voice to impersonate a patient, the clinic could dispense the wrong medication, update a payment method on file, or leak protected health information. The stakes are patient safety, regulatory compliance, and the trust that keeps a practice running.

The actor IS the clinic callback line's fraud gate. When a staff member requests a callback action, the VoiceGate actor is born for that patient's phone line. It queues the pending action durably in SQL, schedules the dial within business hours, and places the outbound call with Telnyx Deepfake Detection enabled on every leg. When Telnyx streams the audio and returns a verdict — `human` or `synthetic` — the actor enforces the policy: a human verdict proceeds and records an attestation; a synthetic verdict voids the action, logs an incident, and SMS-alerts the clinic. Between calls, the actor holds the pending-action queue and per-recipient flag history. A second synthetic hit for the same number moves that recipient to manual-confirmation policy, where future requests are parked for staff approval rather than silently dropped or auto-proceeded. If the actor is killed between dial and verdict — say, the platform reboots mid-batch — the pending action survives in SQL, and on wake the actor still enforces the late verdict. Nothing slips through the gap.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that makes this fraud gate possible: Voice for programmable outbound calls with per-call Deepfake Detection, Messaging for incident alerts, and the Agent SDK on Edge Compute for durable, stateful actors that survive restarts. Unlike stateless functions, the VoiceGate actor holds the pending-action queue, the per-recipient strike history, and the incident ledger — the durable policy state that a per-call webhook cannot carry. Telnyx's first-party Deepfake Detection streams audio during the call and returns a verdict with confidence, giving the actor a real-time signal to act on. The combination of stateful actors, real-time voice AI, and programmable messaging is what turns a detection signal into an enforceable fraud program.

## Telnyx API Endpoints Used

| API | Endpoint / Method | Purpose |
|-----|-------------------|---------|
| Call Control | `POST /v2/calls` | Places outbound call with `deepfake_detection: {enabled: true, timeout, rtp_timeout}` |
| Call Control | `POST /calls/{call_id}/actions/answer` | Answers inbound leg with deepfake detection (inbound path) |
| Call Control | `POST /calls/{call_id}/actions/speak-text` | Plays text-to-speech to the caller |
| Call Control | `POST /calls/{call_id}/actions/hangup` | Ends the call after verdict |
| Deepfake Detection | `call.deepfake_detection.result` webhook | Returns `{verdict, confidence}` — `human` or `synthetic` |
| Deepfake Detection | `call.deepfake_detection.error` webhook | Inconclusive path — triggers retry or park |
| Messaging | `TELNYX.messages.send()` | Sends incident SMS to clinic staff |
| Agent SDK | `this.schedule()` | Schedules dial windows and inconclusive retries |
| Agent SDK | `this.ctx.storage.sql` / `env.GATE_DB` | Durable SQL storage for `pending_actions` and `incidents` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Staff / Operator                             │
│                                                                     │
│  POST /rpc/requestAction({patient, kind, payload})                  │
│          │                                                          │
│          ▼                                                          │
│  ┌──────────────────────────────────────────┐                       │
│  │  VoiceGate Actor (one per patient line)  │                       │
│  │  env.GATES.idFromName(patientPhoneDigits)│                       │
│  │                                          │                       │
│  │  1. INSERT pending_actions (SQL)         │                       │
│  │  2. schedule(msToWindow, "dial")         │                       │
│  │  3. Holds: pending queue, strikes,       │                       │
│  │     manualConfirm, incidents             │                       │
│  └──────────────┬───────────────────────────┘                       │
│                 │                                                   │
│                 │ schedule("dial", {actionId})                      │
│                 ▼                                                   │
│  ┌──────────────────────────────────────────┐                       │
│  │  dial()                                  │                       │
│  │  POST /v2/calls {                        │                       │
│  │    deepfake_detection: {                 │                       │
│  │      enabled: true,                      │                       │
│  │      timeout: DF_TIMEOUT_S,              │                       │
│  │      rtp_timeout: DF_RTP_TIMEOUT_S       │                       │
│  │    }                                     │                       │
│  │  }                                       │                       │
│  └──────────────┬───────────────────────────┘                       │
│                 │                                                   │
│                 ▼                                                   │
│  ┌──────────────────────────────────────────┐                       │
│  │  Telnyx Voice + Deepfake Detection       │                       │
│  │  (audio streamed during call)            │                       │
│  └──────────────┬───────────────────────────┘                       │
│                 │                                                   │
│                 ▼                                                   │
│  ┌──────────────────────────────────────────┐                       │
│  │  Webhook: call.deepfake_detection.result │                       │
│  │  {verdict, confidence}                   │                       │
│  └──────────────┬───────────────────────────┘                       │
│                 │                                                   │
│    ┌────────────┴────────────┐                                      │
│    │                         │                                      │
│    ▼                         ▼                                      │
│  verdict=human          verdict=synthetic                           │
│    │                         │                                      │
│    ▼                         ▼                                      │
│  proceedAction()         void action                                │
│  INSERT attestation    INSERT incident (SQL)                        │
│  speak-text            recordStrike()                               │
│  hangup                notifyClinicIncident()                       │
│  mark completed        SMS to INCIDENT_SMS_E164                     │
│                        (if strikes >= STRIKE_LIMIT →              │
│                         manualConfirm = true)                       │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │  Webhook: call.deepfake_detection.error  │                       │
│  │  (inconclusive)                          │                       │
│  │  → retry once (schedule 5s "dial")       │                       │
│  │  → if retry exhausted: park for review   │                       │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │  SQL Storage (GATE_DB)                   │                       │
│  │  - pending_actions(actionId, patient,    │                       │
│  │    kind, payload, status, recipient,     │                       │
│  │    createdAt, retryCount)                │                       │
│  │  - incidents(id, recipient, verdict,     │                       │
│  │    confidence, actionId, ts)             │                       │
│  └──────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `OUTBOUND_CONNECTION_ID` | `string` | `12345678-90ab-cdef-1234-567890abcdef` | **yes** | Telnyx SIP connection ID for outbound calls | [Telnyx Portal](https://portal.telnyx.com/) |
| `OUTBOUND_CALLER_ID` | `string` | `+1555XXXXXXXX` | **yes** | Caller ID for outbound calls (E.164) | [Telnyx Portal](https://portal.telnyx.com/) |
| `DF_TIMEOUT_S` | `string` | `15` | no | Deepfake detection timeout in seconds (5–60) | — |
| `DF_RTP_TIMEOUT_S` | `string` | `30` | no | RTP stream timeout in seconds (5–120) | — |
| `STRIKE_LIMIT` | `string` | `2` | no | Synthetic verdicts before manual-confirm policy | — |
| `INCIDENT_SMS_E164` | `string` | `+1555XXXXXXXX` | **yes** | Clinic phone number to receive incident SMS | [Telnyx Portal](https://portal.telnyx.com/) |
| `DIAL_WINDOW_START` | `string` | `09:00` | no | Business hours start (HH:MM) | — |
| `DIAL_WINDOW_END` | `string` | `17:00` | no | Business hours end (HH:MM) | — |
| `INCONCLUSIVE_RETRY_MAX` | `string` | `1` | no | Max retries on inconclusive verdict | — |
| `MAX_CALL_MINUTES` | `string` | `600` | no | Maximum call duration in minutes | — |
| `DEMO_MODE` | `string` | `true` | no | When `true`, simulates verdicts instead of placing real calls | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-clone-gate

# 2. Install dependencies
npm install

# 3. Create .env from the example
cp .env.example .env
# Edit .env with your Telnyx credentials and configuration

# 4. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_api_key>

# 5. Set the TELNYX_API_KEY secret
telnyx-edge secrets add TELNYX_API_KEY "<your_telnyx_api_key_here>"

# 6. Generate TypeScript env types
telnyx-edge types

# 7. Run the smoke test
npx tsx smoke_test.ts

# 8. Deploy (when ready)
telnyx-edge ship
```

## API Reference

### `POST /rpc/requestAction`

Requests a callback action for a patient. The VoiceGate actor is born (or woken) for the patient's phone line.

**Request Body:**
```json
{
  "patient": "+15551234567",
  "kind": "refill_approval",
  "payload": { "prescription": "Lisinopril 10mg", "quantity": 30 }
}
```

**Response:**
```json
{
  "actionId": "act_1700000000000_abc123",
  "status": "scheduled"
}
```

| Status | Meaning |
|--------|---------|
| `scheduled` | Action queued and dial scheduled within business hours |
| `parked` | Action parked for manual confirmation (recipient on strike limit) |

### `POST /webhook`

Telnyx webhook endpoint. Receives Deepfake Detection results, errors, and hangup events.

**Event: `call.deepfake_detection.result`**
```json
{
  "event_type": "call.deepfake_detection.result",
  "payload": {
    "call_control_id": "act_1700000000000_abc123",
    "verdict": "human",
    "confidence": 0.99
  }
}
```

**Event: `call.deepfake_detection.error`**
```json
{
  "event_type": "call.deepfake_detection.error",
  "payload": {
    "call_control_id": "act_1700000000000_abc123",
    "error": "audio_stream_timeout"
  }
}
```

**Event: `call-hangup`**
```json
{
  "event_type": "call-hangup",
  "payload": {
    "call_control_id": "act_1700000000000_abc123"
  }
}
```

### Actor RPC Methods

| Method | Args | Returns | Description |
|--------|------|---------|-------------|
| `requestAction` | `{patient, kind, payload}` | `{actionId, status}` | Creates a new callback action |
| `dial` | `{actionId}` | `void` | Dials the patient with deepfake detection |
| `simulateVerdict` | `{actionId, verdict, confidence}` | `void` | Demo-mode verdict simulation |
| `processVerdict` | `{actionId, verdict, confidence}` | `void` | Enforces policy based on verdict |
| `handleDeepfakeResult` | `{actionId, verdict, confidence}` | `void` | Webhook handler for result |
| `handleDeepfakeError` | `{actionId, error?}` | `void` | Webhook handler for error (retry/park) |
| `handleHangup` | `{actionId}` | `void` | Webhook handler for hangup |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Actor not found on webhook | `call_control_id` doesn't match an action ID | Ensure the `call_control_id` from Telnyx matches the `actionId` stored in `pending_actions` |
| No verdict received | Call disconnected before detection completed | Check `DF_TIMEOUT_S` and `DF_RTP_TIMEOUT_S` — increase if calls are short |
| Action stuck in `dialing` | Actor killed between dial and verdict | Pending action survives in SQL; on restart, the actor re-processes the verdict when the webhook arrives |
| SMS not sent to clinic | `INCIDENT_SMS_E164` not set or invalid | Verify the phone number is in E.164 format and the Telnyx Messaging binding is configured |
| All actions parked | Recipient hit `STRIKE_LIMIT` synthetic verdicts | Check `incidents` table; reset by clearing strike history or increasing `STRIKE_LIMIT` |
| Demo mode still placing real calls | `DEMO_MODE` not set to `"true"` | Set `DEMO_MODE=true` in `.env` or environment |
| Business hours scheduling wrong | `DIAL_WINDOW_START`/`END` format incorrect | Use `HH:MM` format (e.g., `09:00`, `17:00`) |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [Telnyx LLM Instructions](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-1190** — Chargeback Fraud Gate (payment verification via voice)
- **DEV-1194** — SMS Smishing Detection (messaging fraud gate)
- **DEV-1225** — Voice-Clone Gate on Bank Callback Line (financial services variant)

## Resources

- [Telnyx Deepfake Detection Docs](https://developers.telnyx.com/docs/voice/programmable-voice/deepfake-detection)
- [call.deepfake_detection.result Callback Reference](https://developers.telnyx.com/api-reference/callbacks/call-deepfake-detection-result)
- [call.deepfake_detection.error Callback Reference](https://developers.telnyx.com/api-reference/callbacks/call-deepfake-detection-error)
- [Telnyx Messaging — Send Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Agent SDK — Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Agent SDK — SQL Storage](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Edge Compute — Stateful Actors Lifecycle](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/lifecycle)
- [Telnyx Voice API](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
