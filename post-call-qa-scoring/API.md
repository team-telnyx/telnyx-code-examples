# API Reference — Post-Call QA Scoring

This document describes the HTTP endpoints exposed by the `post-call-qa-scoring` Edge Function. All routes are POST unless otherwise noted.

---

## Table of Contents

1. [POST /webhook/call-conversation-ended](#post-webhookcall-conversation-ended)
2. [POST /webhook/transcription-saved](#post-webhooktranscription-saved)
3. [POST /demo/trigger](#post-demotrigger)
4. [GET /health/liveness and /health/readiness](#get-healthliveness-and-healthreadiness)

---

## POST /webhook/call-conversation-ended

Handles the Telnyx `call-conversation-ended` webhook. Extracts the agent ID from call metadata, retrieves the embedded transcript, and dispatches scoring to the per-agent `QAAgent` actor.

### Request Body Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | Yes | Top-level wrapper containing the event payload. |
| `data.payload` | object | Yes | The actual call event data. |
| `data.payload.call_control.id` | string | Yes | Unique identifier for the call. |
| `data.payload.metadata` | object | No | Custom metadata set at call start. |
| `data.payload.metadata.<CALL_METADATA_AGENT_KEY>` | string | No | Agent ID (key configurable via `CALL_METADATA_AGENT_KEY` secret, default `"agentId"`). |
| `data.payload.called_number` | string | No | The E.164 number the caller dialed. |
| `data.payload.call_control.from.phone_number` | string | No | Caller's phone number (E.164). |
| `data.payload.transcript` | string | No | Embedded transcript of the call. If absent, the actor logs `no_transcript` and does not score. |

### Example Request

```bash
curl -X POST https://<edge-function-url>/webhook/call-conversation-ended \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call_control": {
          "id": "call_abc123",
          "from": {
            "phone_number": "+15551234567"
          }
        },
        "called_number": "+15559998888",
        "metadata": {
          "agentId": "agent-001"
        },
        "transcript": "Agent: Thank you for calling Telnyx Support. How can I help you today? Customer: I am having trouble with my messaging deliverability."
      }
    }
  }'
```

### Response Schema

#### 200 OK (grading scheduled)

```json
{
  "status": "grade_scheduled",
  "agentId": "agent-001",
  "callId": "call_abc123",
  "digestEnabled": true
}
```

The grading runs on the actor's stable scheduled task `grade:<callId>`. Re-delivered webhooks are no-ops:

```json
{
  "status": "already_recorded",
  "agentId": "agent-001",
  "callId": "call_abc123",
  "digestEnabled": true
}
```

#### 200 OK (no transcript)

The payload carried no transcript. The call is NOT scored (no false zero); the `transcription-saved` fallback delivers the finalized transcript later.

```json
{
  "status": "no_transcript"
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Webhook processed successfully. |
| 400 | Malformed request body. |
| 404 | Route not found. |
| 500 | Internal server error. |

---

## POST /webhook/transcription-saved

Handles the Telnyx `transcription-saved` webhook as a fallback when the transcript was not embedded in the `call-conversation-ended` payload. Delivers the finalized transcript to the same per-agent `QAAgent` actor; the call's dedup marker makes whichever delivery arrives first the one that schedules grading.

### Request Body Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | Yes | Top-level wrapper containing the event payload. |
| `data.payload` | object | Yes | The actual transcription event data. |
| `data.payload.call_control.id` | string | Yes | Unique identifier for the call. |
| `data.payload.metadata` | object | No | Custom metadata set at call start. |
| `data.payload.metadata.<CALL_METADATA_AGENT_KEY>` | string | No | Agent ID (key configurable via `CALL_METADATA_AGENT_KEY` secret, default `"agentId"`). |
| `data.payload.called_number` | string | No | The E.164 number the caller dialed. |
| `data.payload.transcript` | string | Yes | Finalized transcript text. |

### Example Request

```bash
curl -X POST https://<edge-function-url>/webhook/transcription-saved \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call_control": {
          "id": "call_xyz789"
        },
        "called_number": "+15559998888",
        "metadata": {
          "agentId": "agent-002"
        },
        "transcript": "Agent: Thank you for calling Telnyx Support. How can I help you today? Customer: I need help resetting my password."
      }
    }
  }'
```

### Response Schema

#### 200 OK (grading scheduled)

```json
{
  "status": "grade_scheduled",
  "agentId": "agent-002",
  "callId": "call_xyz789",
  "digestEnabled": true
}
```

#### 200 OK (no transcript)

```json
{
  "status": "no_transcript"
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Webhook processed successfully. |
| 400 | Malformed request body. |
| 404 | Route not found. |
| 500 | Internal server error. |

---

## POST /demo/trigger

Triggers the QA scoring pipeline with a synthetic call payload. No real Telnyx calls are placed. This endpoint is intended for demonstration and testing purposes only.

### Request Body Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | No | Agent ID to attribute the synthetic call to. Defaults to `"demo-agent"`. |
| `callId` | string | No | Unique identifier for the synthetic call. Defaults to `"demo_<timestamp>"`. |
| `transcript` | string | No | Synthetic transcript text. If omitted, a canned support conversation is used. |

### Example Request

```bash
curl -X POST https://<edge-function-url>/demo/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "demo-agent",
    "callId": "demo_1719000000000",
    "transcript": "Agent: Thank you for calling Telnyx Support. How can I help you today? Customer: I am having trouble with my messaging deliverability."
  }'
```

### Response Schema

#### 200 OK (grading scheduled)

```json
{
  "status": "grade_scheduled",
  "agentId": "demo-agent",
  "callId": "demo_1719000000000",
  "digestEnabled": true,
  "demo": true
}
```

### Status Codes

| Code | Description |
|---|---|
| 200 | Demo trigger processed successfully. |
| 400 | Malformed JSON body (handled gracefully; defaults are used). |
| 404 | Route not found. |
| 500 | Internal server error. |

---

## GET /health/liveness and /health/readiness

Platform health probes. Both return `200 ok` with a plain-text body.

---

## Notes

- **Agent Resolution**: The agent ID is resolved from `data.payload.metadata.<CALL_METADATA_AGENT_KEY>` (default key: `"agentId"`). If not found, the system falls back to `AGENT_NUMBER_MAP` (a JSON mapping of phone numbers to agent IDs). If neither is available, the actor is keyed by `called_number` and digest notifications are suppressed (log-only mode).
- **Exactly-Once Guarantee**: Each call is recorded with a `pending` row whose `call_id` is the `PRIMARY KEY` (UNIQUE) before a stable scheduled task `grade:<callId>` is queued — a re-delivered webhook re-schedules the same task id (the SDK replaces the pending task) and the UNIQUE row makes the repeat a no-op. Either mechanism alone prevents double-grading; together they are the durable backstop.
- **Decision Models Failure Handling**: If the Telnyx Decision Models API fails after 3 retry attempts (with 10s/30s/60s backoff, honoring `Retry-After`), the call is recorded with `status="ungraded"` and the last error, surfaced in the daily digest. There is no infinite retry.
- **Daily Digest**: Each `QAAgent` actor sends a one-liner digest to `TEAM_LEAD_E164` at 17:00 UTC (configurable via `DIGEST_HOUR_UTC`). N agents ⇒ N texts; actors keyed only by a fallback identity are suppressed (log-only).
