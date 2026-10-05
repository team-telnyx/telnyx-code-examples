# API Reference — Recovery Caller Agent

This document describes the HTTP endpoints exposed by the `recovery-caller-agent` sample. The application is a Telnyx Edge Runtime actor (`RecoveryCall`) that orchestrates a 14-day post-discharge patient follow-up program. It exposes two RPC-style HTTP entry points for opening and closing follow-up episodes, plus internal webhook callback routes for Telnyx Call Control events.

---

## Table of Contents

- [POST /openFollowUp](#post-openfollowup)
- [POST /close](#post-close)
- [POST /webhook/gather-ended](#post-webhookgather-ended)
- [POST /webhook/hangup](#post-webhookhangup)
- [POST /webhook/answered](#post-webhookanswered)

---

## POST /openFollowUp

Creates or resumes a `RecoveryCall` actor for a given patient phone number and schedules the d1/d7/d14 follow-up call windows.

### Request

| Field           | Type   | Required | Description                                      |
|-----------------|--------|----------|--------------------------------------------------|
| `patientPhone`  | string | Yes      | E.164 phone number of the patient (e.g. `+15551234567`) |
| `patientName`   | string | Yes      | Full name of the patient                         |
| `procedure`     | string | Yes      | Discharge procedure name (e.g. `"knee_arthroscopy"`) |

### Example Request

```bash
curl -X POST https://<worker-url>/openFollowUp \
  -H "Content-Type: application/json" \
  -d '{
    "patientPhone": "+15551234567",
    "patientName": "Jane Doe",
    "procedure": "knee_arthroscopy"
  }'
```

### Response

**Status: 200 OK**

| Field     | Type    | Description                              |
|-----------|---------|------------------------------------------|
| `ok`      | boolean | Always `true` on success                 |
| `actorId` | string  | The deterministic actor ID for the patient |

```json
{
  "ok": true,
  "actorId": "patient-15551234567"
}
```

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Follow-up episode opened successfully            |
| 400  | Missing or invalid required fields               |
| 500  | Internal server error                            |

---

## POST /close

Closes an active follow-up episode for a patient, clears all scheduled timers, and marks the episode as complete in the SQL ledger.

### Request

| Field           | Type   | Required | Description                                      |
|-----------------|--------|----------|--------------------------------------------------|
| `patientPhone`  | string | Yes      | E.164 phone number of the patient                |

### Example Request

```bash
curl -X POST https://<worker-url>/close \
  -H "Content-Type: application/json" \
  -d '{
    "patientPhone": "+15551234567"
  }'
```

### Response

**Status: 200 OK**

| Field | Type    | Description                              |
|-------|---------|------------------------------------------|
| `ok`  | boolean | Always `true` on success                 |

```json
{
  "ok": true
}
```

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Episode closed successfully                      |
| 400  | Missing `patientPhone`                           |
| 404  | No active episode found for the given phone      |
| 500  | Internal server error                            |

---

## POST /webhook/gather-ended

Internal webhook endpoint invoked by Telnyx when the `gather-using-ai` action completes. Receives the captured symptom answers and transcript, then routes them to the Decision Model for grading.

### Request

The request body follows the Telnyx `call-ai-gather-ended` callback schema. The application extracts `data.payload.channel_data`.

| Field (path)                          | Type    | Required | Description                                      |
|---------------------------------------|---------|----------|--------------------------------------------------|
| `data.payload.call_id`                | string  | Yes      | Telnyx call ID                                   |
| `data.payload.channel_data.transcript`| string  | Yes      | Full transcript of the AI gather session         |
| `data.payload.channel_data.symptoms`  | object  | Yes      | Symptom answers object                           |
| `data.payload.channel_data.symptoms.pain`         | string | Yes | Pain rating (0–10)                               |
| `data.payload.channel_data.symptoms.fever`        | string | Yes | Fever/chills response                            |
| `data.payload.channel_data.symptoms.drainage`     | string | Yes | Surgical site drainage response                  |
| `data.payload.channel_data.symptoms.meds_taken`   | string | Yes | Medication adherence response                    |

### Example Request

```bash
curl -X POST https://<worker-url>/webhook/gather-ended \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call_id": "AG4b0a1b2c3d4e5f67890",
        "channel_data": {
          "transcript": "Patient reports pain level 3, no fever, no drainage, taking medications as prescribed.",
          "symptoms": {
            "pain": "3",
            "fever": "no",
            "drainage": "none",
            "meds_taken": "yes"
          }
        }
      }
    }
  }'
```

### Response

**Status: 200 OK**

```text
OK
```

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Webhook processed successfully                   |
| 400  | Malformed webhook payload                        |
| 404  | Unknown webhook path                             |
| 500  | Internal server error                            |

---

## POST /webhook/hangup

Internal webhook endpoint invoked by Telnyx when a call ends unexpectedly (mid-script drop). Triggers a same-day recovery redial that resumes at the last unanswered question.

### Request

The request body follows the Telnyx `call-hangup` callback schema.

| Field (path)              | Type   | Required | Description                                      |
|---------------------------|--------|----------|--------------------------------------------------|
| `data.payload.call_id`    | string | Yes      | Telnyx call ID                                   |
| `data.payload.hangup`     | object | No       | Hangup metadata (direction, reason, etc.)        |

### Example Request

```bash
curl -X POST https://<worker-url>/webhook/hangup \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call_id": "AG4b0a1b2c3d4e5f67890",
        "hangup": {
          "direction": "inbound",
          "reason": "hangup"
        }
      }
    }
  }'
```

### Response

**Status: 200 OK**

```text
OK
```

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Webhook processed successfully                   |
| 404  | Unknown webhook path                             |
| 500  | Internal server error                            |

---

## POST /webhook/answered

Internal webhook endpoint invoked by Telnyx when the patient answers the call. Acknowledges the event; the actor continues with the intro speech and symptom gathering.

### Request

The request body follows the Telnyx `call-answered` callback schema.

| Field (path)              | Type   | Required | Description                                      |
|---------------------------|--------|----------|--------------------------------------------------|
| `data.payload.call_id`    | string | Yes      | Telnyx call ID                                   |

### Example Request

```bash
curl -X POST https://<worker-url>/webhook/answered \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call_id": "AG4b0a1b2c3d4e5f67890"
      }
    }
  }'
```

### Response

**Status: 200 OK**

```text
OK
```

### Status Codes

| Code | Description                                      |
|------|--------------------------------------------------|
| 200  | Webhook processed successfully                   |
| 404  | Unknown webhook path                             |
| 500  | Internal server error                            |

---

## Environment Variables

| Variable                | Required | Description                                              |
|-------------------------|----------|----------------------------------------------------------|
| `TELNYX_API_KEY`        | Yes      | Telnyx API key (from secrets binding)                    |
| `OUTBOUND_CONNECTION_ID`| Yes      | Telnyx Voice connection ID for outbound calls              |
| `OUTBOUND_CALLER_ID`    | Yes      | Caller ID phone number resource (E.164)                  |
| `CLINIC_E164`           | Yes      | Clinic escalation phone number (E.164)                   |
| `FRONTDESK_E164`        | Yes      | Front desk SMS escalation number (E.164)                 |
| `D1_DELAY_H`            | No       | Hours until day-1 call (default: `24`)                   |
| `D7_DELAY_H`            | No       | Hours until day-7 call (default: `168`)                  |
| `D14_DELAY_H`           | No       | Hours until day-14 call (default: `336`)                 |
| `RESUME_RETRY_MAX`      | No       | Max in-day retry attempts for no-answer (default: `2`)   |
| `RED_FLAG_NOUL`         | No       | Noul threshold for escalation (default: `0.8`)           |
| `SEVERITY_ESCALATE`     | No       | Severity score threshold for escalation (default: `3`)   |
| `ANSWER_SILENCE_MS`     | No       | AI gather silence timeout in ms (default: `3000`)        |
| `DEMO_MODE`             | No       | Set to `true` to enable safe demo mode (default: `true`) |

---

## Telnyx API Endpoints Used

| API                     | Endpoint                                              | Purpose                                      |
|-------------------------|-------------------------------------------------------|----------------------------------------------|
| Call Control            | `POST /v2/calls`                                      | Dial patient or clinic                       |
| Call Control            | `POST /v2/calls/{call_id}/actions/speak-text`         | Play intro speech                            |
| Call Control            | `POST /v2/calls/{call_id}/actions/gather-using-ai`    | Capture symptom answers via AI               |
| Call Control            | `POST /v2/calls/{call_id}/actions/transfer`           | Warm handoff to clinic                       |
| Call Control            | `POST /v2/calls/{call_id}/actions/hangup`             | End call                                     |
| Decision Models         | `POST /v2/ai/typesafe/v1/systemone`                   | Grade symptoms (noul/score/choice)           |
| Messaging               | `this.env.TELNYX.messages.send()`                     | SMS front desk on escalation                 |
