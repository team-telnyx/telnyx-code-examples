# API Reference — Voice-Clone Gate

## Overview

The Voice-Clone Gate sample exposes two entry points: an RPC endpoint for staff to request a gated callback action, and a webhook endpoint that receives Telnyx Deepfake Detection verdicts and call lifecycle events. The `VoiceGate` actor is self-provisioned per patient phone number via `env.GATES.idFromName(...)`.

---

## POST /rpc/requestAction

Request that the `VoiceGate` actor for a given patient phone number queue and schedule a fraud-gated callback.

### Request Body

| Field    | Type   | Required | Description                                                                 |
|----------|--------|----------|-----------------------------------------------------------------------------|
| `patient`| string | yes      | Patient phone number (E.164 or digits). Used to derive the actor ID.        |
| `kind`   | string | yes      | Action kind — e.g. `"refill_approval"`, `"card_update"`, `"appointment"`.   |
| `payload`| object | yes      | Arbitrary JSON payload describing the action to execute on a human verdict. |

### Example Request

```bash
curl -X POST https://<worker-url>/rpc/requestAction \
  -H "Content-Type: application/json" \
  -d '{
    "patient": "+15551234567",
    "kind": "refill_approval",
    "payload": { "prescription_id": "rx-98765", "dosage": "10mg" }
  }'
```

### Response

**Status 200 OK**

| Field      | Type    | Description                                                                 |
|------------|---------|-----------------------------------------------------------------------------|
| `actionId` | string  | Unique identifier for the queued action.                                    |
| `status`   | string  | `"scheduled"` — action queued and dial scheduled within business hours.     |

```json
{
  "actionId": "act_1719500000_a1b2c3",
  "status": "scheduled"
}
```

**Status 200 OK (manual-confirm policy)**

If the recipient has already accumulated `STRIKE_LIMIT` synthetic verdicts, the action is parked for staff review instead of being scheduled.

| Field      | Type    | Description                                                                 |
|------------|---------|-----------------------------------------------------------------------------|
| `actionId` | string  | Unique identifier for the parked action.                                    |
| `status`   | string  | `"parked"` — action held for manual staff confirmation.                     |

```json
{
  "actionId": "act_1719500000_d4e5f6",
  "status": "parked"
}
```

### Status Codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 200  | Action queued or parked successfully.        |
| 400  | Invalid patient phone number (too short).    |
| 500  | Internal server error.                       |

---

## POST /webhook

Receives Telnyx Call Control and Deepfake Detection webhook events. The worker routes each event to the appropriate `VoiceGate` actor based on the `call_control_id` or `call_id` in the payload.

### Request Body

The body is a Telnyx webhook envelope. The `event_type` field determines routing.

| Field         | Type   | Required | Description                                                                 |
|---------------|--------|----------|-----------------------------------------------------------------------------|
| `event_type`  | string | yes      | Telnyx event type — see supported types below.                              |
| `payload`     | object | yes      | Event-specific payload.                                                     |
| `timestamp`   | string | no       | ISO 8601 timestamp from Telnyx.                                             |

### Supported Event Types

#### `call.deepfake_detection.result`

Delivered when Telnyx completes deepfake analysis on a call leg.

**Payload fields:**

| Field             | Type    | Required | Description                                                                 |
|-------------------|---------|----------|-----------------------------------------------------------------------------|
| `call_control_id` | string  | yes      | Identifier used to route to the correct `VoiceGate` actor.                  |
| `verdict`         | string  | yes      | `"human"` or `"synthetic"`.                                                 |
| `confidence`      | number  | yes      | Confidence score (0.0–1.0).                                                 |
| `call_id`         | string  | no       | Alternate call identifier.                                                  |

**Example Request**

```bash
curl -X POST https://<worker-url>/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "call.deepfake_detection.result",
    "payload": {
      "call_control_id": "act_1719500000_a1b2c3",
      "verdict": "synthetic",
      "confidence": 0.97
    }
  }'
```

**Response — Status 200 OK**

```json
{ "received": true }
```

#### `call.deepfake_detection.error`

Delivered when deepfake detection cannot produce a verdict (timeout, RTP timeout, or internal error).

**Payload fields:**

| Field             | Type   | Required | Description                                                                 |
|-------------------|--------|----------|-----------------------------------------------------------------------------|
| `call_control_id` | string | yes      | Identifier used to route to the correct `VoiceGate` actor.                  |
| `error`           | string | no       | Error description from Telnyx.                                              |
| `call_id`         | string | no       | Alternate call identifier.                                                  |

**Example Request**

```bash
curl -X POST https://<worker-url>/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "call.deepfake_detection.error",
    "payload": {
      "call_control_id": "act_1719500000_a1b2c3",
      "error": "rtp_timeout"
    }
  }'
```

**Response — Status 200 OK**

```json
{ "received": true }
```

#### `call-hangup`

Delivered when the call leg ends.

**Payload fields:**

| Field             | Type   | Required | Description                                                                 |
|-------------------|--------|----------|-----------------------------------------------------------------------------|
| `call_control_id` | string | yes      | Identifier used to route to the correct `VoiceGate` actor.                  |
| `call_id`         | string | no       | Alternate call identifier.                                                  |

**Example Request**

```bash
curl -X POST https://<worker-url>/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "call-hangup",
    "payload": {
      "call_control_id": "act_1719500000_a1b2c3"
    }
  }'
```

**Response — Status 200 OK**

```json
{ "received": true }
```

### Status Codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 200  | Webhook received and processed.              |
| 404  | Unknown path (non-webhook routes).           |
| 500  | Internal server error during processing.     |

---

## Internal Actor Task Handlers

These are not directly HTTP-accessible but are invoked by the Agent SDK scheduler or by webhook routing. They are documented here for completeness of the API contract.

### `dial` (scheduled task)

Triggered by `this.schedule()` after the business-hours delay. Dials the patient with `deepfake_detection: {enabled: true}`. In demo mode, schedules a simulated verdict instead of placing a real call.

**Payload:**

| Field      | Type   | Required | Description                                                                 |
|------------|--------|----------|-----------------------------------------------------------------------------|
| `actionId` | string | yes      | The pending action to dial for.                                             |

### `simulateVerdict` (scheduled task, demo mode only)

Simulates a deepfake detection result for demo/testing purposes.

**Payload:**

| Field        | Type    | Required | Description                                                                 |
|--------------|---------|----------|-----------------------------------------------------------------------------|
| `actionId`   | string  | yes      | The pending action to apply the verdict to.                                 |
| `verdict`    | string  | yes      | `"human"` or `"synthetic"`.                                                 |
| `confidence` | number  | yes      | Confidence score (0.0–1.0).                                                 |

### `processVerdict` (internal method)

Processes a verdict (from webhook or simulation): writes an incident to SQL, updates the action status, records strikes, and either proceeds with the action (human) or voids it and notifies the clinic (synthetic).

### `handleDeepfakeResult` (webhook dispatch)

Dispatches `call.deepfake_detection.result` events to `processVerdict`.

### `handleDeepfakeError` (webhook dispatch)

Dispatches `call.deepfake_detection.error` events. Implements fail-closed retry logic: retries the dial once (up to `INCONCLUSIVE_RETRY_MAX`), then parks the action for staff review.

### `handleHangup` (webhook dispatch)

Dispatches `call-hangup` events. Marks the action as completed if the verdict was human and the call ended cleanly.

---

## SQL Storage Schema

The `VoiceGate` actor persists state in two SQL tables via the `GATE_DB` binding.

### `pending_actions`

| Column       | Type    | Description                                                                 |
|--------------|---------|-----------------------------------------------------------------------------|
| `actionId`   | string  | Primary key — unique action identifier.                                     |
| `patient`    | string  | Patient phone number.                                                       |
| `kind`       | string  | Action kind.                                                                |
| `payload`    | string  | JSON-serialized action payload.                                             |
| `status`     | string  | `pending`, `dialing`, `human`, `synthetic`, `error`, `parked`, `completed`, `voided`. |
| `recipient`  | string  | Digits-only recipient phone number.                                         |
| `createdAt`  | number  | Unix timestamp (ms) of creation.                                            |
| `retryCount` | number  | Number of inconclusive retries attempted.                                   |

### `incidents`

| Column       | Type    | Description                                                                 |
|--------------|---------|-----------------------------------------------------------------------------|
| `id`         | string  | Primary key — unique incident identifier.                                   |
| `recipient`  | string  | Digits-only recipient phone number.                                         |
| `verdict`    | string  | `human` or `synthetic`.                                                     |
| `confidence` | number  | Confidence score (0.0–1.0).                                                 |
| `actionId`   | string  | Foreign key to `pending_actions.actionId`.                                  |
| `ts`         | number  | Unix timestamp (ms) of the incident.                                        |

---

## Environment Variables

| Variable                 | Required | Default | Description                                                                 |
|--------------------------|----------|---------|-----------------------------------------------------------------------------|
| `TELNYX_API_KEY`         | yes      | —       | Telnyx API key (from secrets binding).                                      |
| `OUTBOUND_CONNECTION_ID` | yes      | —       | Telnyx Call Control connection ID for outbound calls.                       |
| `OUTBOUND_CALLER_ID`     | yes      | —       | Caller ID to use for outbound calls and SMS.                                |
| `DF_TIMEOUT_S`           | no       | `15`    | Deepfake detection timeout in seconds (range 5–60).                         |
| `DF_RTP_TIMEOUT_S`       | no       | `30`    | Deepfake detection RTP timeout in seconds (range 5–120).                    |
| `STRIKE_LIMIT`           | no       | `2`     | Number of synthetic verdicts before manual-confirm policy is enforced.      |
| `INCIDENT_SMS_E164`      | no       | —       | Clinic phone number (E.164) to receive incident SMS notifications.          |
| `DIAL_WINDOW_START`      | no       | `09:00` | Business hours start (HH:MM).                                               |
| `DIAL_WINDOW_END`        | no       | `17:00` | Business hours end (HH:MM).                                                 |
| `INCONCLUSIVE_RETRY_MAX` | no       | `1`     | Maximum number of retries on inconclusive (error) verdicts.                 |
| `MAX_CALL_MINUTES`       | no       | `600`   | Maximum call duration in minutes.                                           |
| `DEMO_MODE`              | no       | `true`  | When `true`, no real calls or SMS are placed; simulated verdicts are used.  |
