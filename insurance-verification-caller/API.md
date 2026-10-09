# API Reference — Insurance Verification Caller

This document describes the HTTP endpoints exposed by the Insurance Verification Caller Edge Function (`src/index.ts`). The application is a **Telnyx Edge** project using the `@telnyx/edge-runtime` Agent SDK. The primary entry point is an RPC surface (`openJob`) and a webhook handler for Call Control events.

---

## Table of Contents

- [POST /webhook/call](#post-webhookcall)
- [GET /health](#get-health)
- [RPC: openJob](#rpc-openjob)

---

## POST /webhook/call

Receives inbound Call Control webhook events (e.g., `call.hangup`, `transcription.start`) from Telnyx. In a full deployment, these events are routed to the correct `VerifyJob` actor instance via the `VERIFY_JOB` ActorNamespace.

### Request Body Schema

| Field             | Type   | Required | Description                                                                 |
|-------------------|--------|----------|-----------------------------------------------------------------------------|
| `data`            | object | Yes      | Telnyx event envelope.                                                      |
| `data.event`      | string | Yes      | Event type (e.g., `call.hangup`, `transcription.start`).                    |
| `data.payload`    | object | Yes      | Event-specific payload.                                                     |
| `data.payload.call_control_id` | string | Conditional | The call control ID associated with the event.                         |
| `data.payload.call_leg_id`     | string | Conditional | The call leg ID.                                                       |
| `data.payload.transcription`   | object | Conditional | Transcription object (present on `transcription.start` events).       |
| `data.payload.transcription.text` | string | Conditional | The transcribed text from the carrier's spoken response.             |

### Example Request (curl)

```bash
curl -X POST https://<edge-function-url>/webhook/call \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event": "transcription.start",
      "payload": {
        "call_control_id": "TGxxxxx",
        "transcription": {
          "text": "Member is eligible for coverage under plan. Benefits are active."
        }
      }
    }
  }'
```

### Response Schema

#### 200 OK

| Field     | Type    | Description                                      |
|-----------|---------|--------------------------------------------------|
| `received`| boolean | Always `true`. Acknowledges receipt of the event.|

```json
{
  "received": true
}
```

### Status Codes

| Status | Description                                      |
|--------|--------------------------------------------------|
| 200    | Event received and acknowledged.                 |
| 400    | Malformed JSON or missing required fields.       |
| 404    | Unknown webhook path.                            |
| 500    | Internal server error during event processing.   |

---

## GET /health

Returns the health status of the Edge Function.

### Request

No request body.

### Example Request (curl)

```bash
curl https://<edge-function-url>/health
```

### Response Schema

#### 200 OK

| Field    | Type   | Description                          |
|----------|--------|--------------------------------------|
| `status` | string | Always `"ok"`. Indicates liveness.   |

```json
{
  "status": "ok"
}
```

### Status Codes

| Status | Description                          |
|--------|--------------------------------------|
| 200    | Function is healthy and responsive.  |
| 404    | Unknown path.                        |
| 500    | Internal server error.               |

---

## RPC: openJob

Creates and starts a new `VerifyJob` actor instance to perform insurance eligibility verification. This is the primary entry point invoked by the front desk system.

### Method Signature

```typescript
openJob(memberId: string, plan: string, provider: string): Promise<{ jobId: string; status: string }>
```

### Parameters

| Parameter   | Type   | Required | Description                                                                 |
|-------------|--------|----------|-----------------------------------------------------------------------------|
| `memberId`  | string | Yes      | The member ID used to drive the carrier IVR menu via `send_dtmf`.           |
| `plan`      | string | Yes      | The insurance plan name (e.g., `"PPO Gold"`).                               |
| `provider`  | string | Yes      | The healthcare provider name.                                               |

### Example Request (curl — via RPC stub)

```bash
curl -X POST https://<edge-function-url>/rpc/openJob \
  -H "Content-Type: application/json" \
  -d '{
    "memberId": "M123456789",
    "plan": "PPO Gold",
    "provider": "City General Hospital"
  }'
```

> **Note:** The RPC surface is exposed through the `@telnyx/edge-runtime` Agent SDK. The `openJob` function is invoked on the `VerifyJob` actor stub, which is resolved via `env.VERIFY_JOB.idFromName(jobId)`.

### Response Schema

#### 200 OK

| Field    | Type   | Description                                                                 |
|----------|--------|-----------------------------------------------------------------------------|
| `jobId`  | string | Unique identifier for the verification job (format: `<memberId>-<timestamp>`). |
| `status` | string | Always `"started"`. Indicates the job actor has been born and the first verification attempt is scheduled. |

```json
{
  "jobId": "M123456789-1719500000000",
  "status": "started"
}
```

### Status Codes

| Status | Description                                      |
|--------|--------------------------------------------------|
| 200    | Job created successfully; actor born and scheduled. |
| 400    | Missing or invalid `memberId`, `plan`, or `provider`. |
| 500    | Internal error during actor creation or scheduling. |

---

## Internal API Calls (Not Directly Exposed)

The following Telnyx API endpoints are called internally by the `VerifyJob` actor during verification. These are not HTTP endpoints exposed by this Edge Function but are invoked via `fetch` or the `TELNYX` binding.

### Call Control — Dial

**Method:** `POST https://api.telnyx.com/v2/calls`

Used in live mode to initiate an outbound call to the carrier's phone number.

#### Request Body

| Field           | Type   | Required | Description                                                                 |
|-----------------|--------|----------|-----------------------------------------------------------------------------|
| `connection_id` | string | Yes      | The Telnyx number resource ID used as the outbound caller ID (`CARRIER_NUMBER_ID`). |
| `from`          | string | Yes      | The outbound caller ID phone number (`OUTBOUND_CALLER_ID`).                 |
| `to`            | string | Yes      | The carrier's E.164 phone number (`CARRIER_E164` or `MOCK_CARRIER_E164`).   |

#### Response

| Field             | Type   | Description                                      |
|-------------------|--------|--------------------------------------------------|
| `call_control_id` | string | Unique identifier for the call leg.              |

### Call Control — Send DTMF

**Method:** `POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/send_dtmf`

Sends DTMF digits to the carrier's IVR to drive the menu navigation.

#### Request Body

| Field            | Type   | Required | Description                                                                 |
|------------------|--------|----------|-----------------------------------------------------------------------------|
| `digits`         | string | Yes      | The DTMF digits to send (e.g., `"2"`, member ID digits, `"0"`).             |
| `duration_millis`| number | No       | Duration of each DTMF tone in milliseconds (default: `100`).                |

### Jev Decision Models — SystemOne

**Method:** `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone`

Scores the carrier's transcribed response using the Jev Decision Models API.

#### Request Body

| Field     | Type     | Required | Description                                                                 |
|-----------|----------|----------|-----------------------------------------------------------------------------|
| `model`   | string   | Yes      | The Jev model identifier (default: `"telnyx/decision-flash"`).              |
| `state`   | string   | Yes      | The carrier's transcribed spoken response.                                  |
| `questions`| array   | Yes      | Array of question objects. See below.                                       |

##### Question Object Schema

| Field      | Type   | Required | Description                                                                 |
|------------|--------|----------|-----------------------------------------------------------------------------|
| `id`       | string | Yes      | Unique identifier for the question (e.g., `"choice"`, `"score"`, `"noul"`). |
| `type`     | string | Yes      | Question type: `"choice"`, `"score"`, or `"noul"`.                          |
| `question` | string | Yes      | The natural language question to ask the model.                             |
| `options`  | array  | Conditional | Required for `choice` type. List of valid answer options.               |
| `min`      | number | Conditional | Required for `score` and `noul` types. Minimum value.                   |
| `max`      | number | Conditional | Required for `score` and `noul` types. Maximum value.                   |

#### Response

| Field     | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| `answers` | object | Map of question IDs to answer objects.           |
| `answers.choice.value` | string | One of `"covered"`, `"not_covered"`, `"needs_verification"`. |
| `answers.score.value`  | number | Confidence score (0–100).                       |
| `answers.noul.value`   | number | Hard no-coverage confidence (0–1).              |

### Messaging — Send SMS

**Method:** `this.env.TELNYX.messages.send({ to, from?, text })`

Sends the verification result as a one-line SMS to the front desk.

#### Parameters

| Field | Type   | Required | Description                                                                 |
|-------|--------|----------|-----------------------------------------------------------------------------|
| `to`  | string | Yes      | The front desk phone number (`FRONTDESK_E164`).                             |
| `from`| string | No       | The sender phone number (defaults to the Telnyx number bound to `TELNYX`).  |
| `text`| string | Yes      | The SMS message body (the verification verdict).                            |

---

## Environment Variables

All configuration is read from environment variables. No phone numbers or credentials are hardcoded.

| Variable             | Required | Description                                                                 |
|----------------------|----------|-----------------------------------------------------------------------------|
| `TELNYX_API_KEY`     | Yes      | Telnyx API key (loaded from secrets, never committed).                      |
| `CARRIER_E164`       | Yes      | The carrier's phone number to dial (E.164 format).                          |
| `MOCK_CARRIER_E164`  | No       | Mock carrier number for demo mode.                                          |
| `CARRIER_NUMBER_ID`  | Yes      | Telnyx connection ID for outbound dial.                                     |
| `OUTBOUND_CALLER_ID` | Yes      | Telnyx number ID used as outbound caller ID.                                |
| `FRONTDESK_E164`     | Yes      | Front desk phone number to receive result SMS (E.164 format).               |
| `HOLD_MAX_MS`        | No       | Maximum hold time before retry (default: `180000`).                         |
| `ANSWER_SILENCE_MS`  | No       | Silence threshold after answer to detect completion (default: `4000`).      |
| `VM_KEYWORDS`        | No       | Comma-separated keywords to detect voicemail (default: `"voicemail,leave a message,after the tone"`). |
| `MENU_LOOP_MAX`      | No       | Max repeated-menu matches before retry (default: `3`).                      |
| `MAX_ATTEMPTS`       | No       | Maximum retry attempts (default: `3`).                                      |
| `JEV_MODEL`          | No       | Jev model identifier (default: `"telnyx/decision-flash"`).                  |
| `JEV_ENDPOINT`       | No       | Jev API endpoint (default: `"https://api.telnyx.com/v2/ai/typesafe/v1/systemone"`). |
| `DEMO_MODE`          | No       | Set to `"false"` to use live Call Control (default: `"true"`).              |
</arg_value>
