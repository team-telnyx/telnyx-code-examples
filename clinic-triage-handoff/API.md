# API Reference — Clinic Triage & Handoff

This document describes the HTTP endpoints exposed by the `TriageRouter` actor and its sub-agents (`BillingAgent`, `ClinicalAgent`, `AfterHoursAgent`) in the `clinic-triage-handoff` sample.

All endpoints are served from the Telnyx Edge runtime. The actor is provisioned per clinic line via `env.TRIAGE_ROUTER.idFromName(lineE164)`.

---

## Endpoints

### 1. Webhook Receiver (TriageRouter)

Receives inbound Call Control events from Telnyx. The `event` query parameter determines which handler branch is executed.

| Method | Path |
|--------|------|
| `POST` | `/webhook?event=call-initiated` |
| `POST` | `/webhook?event=call-transfer-complete` |
| `POST` | `/webhook?event=call-hangup` |

#### Request — `call-initiated`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_control_id` | string | yes | Unique identifier for the call leg. |
| `call_id` | string | no | Alternate call identifier (fallback). |
| `from` | string | yes | Caller's E.164 phone number. |
| `caller_id` | string | no | Alternate caller identifier (fallback). |
| `to` | string | no | Destination number (defaults to `CLINIC_LINE_E164`). |
| `transcript` | string | no | Captured speech transcript (may be empty at initiation). |

**Example request (curl):**

```bash
curl -X POST "https://<edge-endpoint>/webhook?event=call-initiated" \
  -H "Content-Type: application/json" \
  -d '{
    "call_control_id": "CA1234567890abcdef",
    "from": "+15551234567",
    "to": "+15559999999",
    "transcript": "I need help with my bill from last month."
  }'
```

#### Request — `call-transfer-complete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_control_id` | string | yes | The call control ID of the transferred call. |
| `transfer_call_control_id` | string | no | The new call control ID after transfer. |
| `to` | string | no | Destination number of the transfer. |

**Example request (curl):**

```bash
curl -X POST "https://<edge-endpoint>/webhook?event=call-transfer-complete" \
  -H "Content-Type: application/json" \
  -d '{
    "call_control_id": "CA1234567890abcdef",
    "transfer_call_control_id": "CA0987654321fedcba",
    "to": "+15551000001"
  }'
```

#### Request — `call-hangup`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_control_id` | string | yes | The call control ID of the hung-up call. |
| `from` | string | no | Caller's number. |

**Example request (curl):**

```bash
curl -X POST "https://<edge-endpoint>/webhook?event=call-hangup" \
  -H "Content-Type: application/json" \
  -d '{
    "call_control_id": "CA1234567890abcdef",
    "from": "+15551234567"
  }'
```

#### Response — `call-initiated`

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "routing" }` | Call accepted; router is classifying intent and scheduling handoff. |
| `400` | `{ "error": "Unknown event" }` | Unrecognized `event` query parameter. |
| `500` | `{ "error": "Internal error" }` | Unexpected server error. |

#### Response — `call-transfer-complete`

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "transfer_complete" }` | Transfer acknowledged. |
| `500` | `{ "error": "Internal error" }` | Unexpected server error. |

#### Response — `call-hangup`

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "hangup" }` | Hangup acknowledged. |
| `500` | `{ "error": "Internal error" }` | Unexpected server error. |

---

### 2. Sub-Agent Handoff Receiver

Each sub-agent (`BillingAgent`, `ClinicalAgent`, `AfterHoursAgent`) exposes a `fetch` handler that receives the handoff payload from the router.

| Method | Path |
|--------|------|
| `POST` | `/handoff` |

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | yes | Must be `"handoff"`. |
| `payload.caller` | string | yes | Caller's E.164 phone number. |
| `payload.transcript` | string | yes | Full conversation transcript inherited from the router. |
| `payload.intent` | string | yes | Classified intent: `"billing"`, `"clinical"`, or `"afterhours"`. |
| `payload.summary` | string | yes | LLM-generated 1–2 sentence summary of the caller's issue. |

**Example request (curl):**

```bash
curl -X POST "https://<edge-endpoint>/handoff" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "handoff",
    "payload": {
      "caller": "+15551234567",
      "transcript": "Caller: I need help with my bill from last month. Router: Classifying intent as billing.",
      "intent": "billing",
      "summary": "Caller is concerned about a charge on last month's statement."
    }
  }'
```

#### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "ok" }` | Handoff received and processed. |
| `500` | `{ "error": "Internal error" }` | Unexpected server error. |

---

### 3. Health Check

| Method | Path |
|--------|------|
| `GET` | `/` |

#### Response

| Status Code | JSON Shape | Description |
|-------------|------------|-------------|
| `200` | `{ "status": "ok", "message": "TriageRouter is listening..." }` | Service is running. |
| `404` | `{ "error": "Not found" }` | Unknown path. |

**Example request (curl):**

```bash
curl -X GET "https://<edge-endpoint>/"
```

---

## Status Codes Summary

| Code | Meaning |
|------|---------|
| `200` | Success — request processed. |
| `400` | Bad request — unknown event type or malformed payload. |
| `404` | Not found — path does not match any route. |
| `500` | Internal server error — unexpected failure. |

---

## Idempotency & Exactly-Once Guarantees

- **`call-initiated` redelivery**: The router checks the `routing` table for an existing `done = 1` row for the `callId` before logging or scheduling. Redelivered webhooks do not produce duplicate routing rows.
- **Handoff scheduling**: The `handoff` task is scheduled with `taskId: route:<callId>`, ensuring re-activation resumes the same task rather than creating a duplicate.
- **Transfer completion**: The `done` flag in the `routing` table is set to `1` only after the Call Control transfer is executed, preventing double-transfers.
- **Mid-handoff restart**: If the worker is killed between classification and transfer, the next webhook re-activates the actor and the `route:<callId>` task resumes, completing the transfer exactly once.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | yes | Telnyx API key (injected via secrets binding). |
| `CLINIC_LINE_E164` | yes | The clinic's inbound phone number in E.164 format. |
| `AI_MODEL` | yes | OpenAI model name for intent classification and summarization (e.g., `gpt-4o-mini`). |
| `DEMO_MODE` | no | Set to `"true"` to enable demo mode (no real calls/transfers executed). |
