```markdown
# API Reference — Dial-in Interview Scorer

This document describes the HTTP endpoints exposed by the `dial-in-interview-scorer` sample. The application is a **Telnyx Edge** project (`@telnyx/edge-runtime`) that uses a durable `Agent` (`InterviewCall`) to orchestrate a rubric-driven intake call, score answers mid-call via the Telnyx Decision Models API, and stream a live scorecard to a hiring-manager dashboard over Agent SDK WebSockets.

---

## Base URL

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:4000` |
| Deployed    | `https://<app-name>.telnyx.dev` |

---

## Routes

### 1. `POST /open`

Bootstraps a new `InterviewCall` actor for a candidate phone line. The actor is addressed durably by the candidate's phone digits (`env.INTERVIEWS.idFromName(phoneDigits)`), so repeated calls to the same number resume the same actor instance.

#### Request Body

| Field        | Type                   | Required | Description |
|--------------|------------------------|----------|-------------|
| `candidate`  | `string`               | Yes      | Candidate display name. |
| `phone`      | `string`               | Yes      | E.164 candidate phone number (e.g. `+15551234567`). |
| `questions`  | `InterviewQuestion[]`  | Yes      | Array of interview questions with rubric text. Must contain at least one entry. |

##### `InterviewQuestion`

| Field    | Type     | Required | Description |
|----------|----------|----------|-------------|
| `qIdx`   | `number` | No*      | Zero-based question index. If omitted, the server assigns it from array position. |
| `text`   | `string` | Yes      | The question to ask the candidate. |
| `rubric` | `string` | Yes      | Scoring rubric (0–3 scale) used by the Decision Model. |

#### Example Request

```bash
curl -X POST http://localhost:4000/open \
  -H "Content-Type: application/json" \
  -d '{
    "candidate": "Jane Doe",
    "phone": "+15551234567",
    "questions": [
      { "text": "Tell me about a time you led a team through a difficult project.", "rubric": "0=No leadership, 1=Basic, 2=Strong, 3=Exceptional" },
      { "text": "How do you handle conflicting priorities?", "rubric": "0=No strategy, 1=Basic, 2=Strong, 3=Exceptional" }
    ]
  }'
```

#### Response

**Status: `200 OK`**

| Field      | Type     | Description |
|------------|----------|-------------|
| `status`   | `string` | `"interview_started"` |
| `actorId`  | `string` | Durable actor ID (derived from phone digits). |

```json
{
  "status": "interview_started",
  "actorId": "15551234567"
}
```

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Interview actor created and dial initiated. |
| `400` | Bad Request | Missing `candidate`, `phone`, or `questions`; or invalid phone number. |
| `500` | Internal Server Error | Dial failure or actor creation error. |

---

### 2. `GET /status`

Returns the current in-memory state of the `InterviewCall` actor. Intended for debugging and dashboard polling.

#### Example Request

```bash
curl http://localhost:4000/status
```

#### Response

**Status: `200 OK`**

| Field           | Type                   | Description |
|-----------------|------------------------|-------------|
| `state`         | `InterviewState`       | Full actor state object. |

##### `InterviewState`

| Field          | Type                   | Description |
|----------------|------------------------|-------------|
| `candidate`    | `string`               | Candidate name. |
| `phone`        | `string`               | Candidate phone number. |
| `questions`    | `InterviewQuestion[]`  | Full question list. |
| `currentQIdx`  | `number`               | Index of the current/next question. |
| `callId`       | `string \| null`       | Active Telnyx Call Control ID. |
| `escalated`    | `boolean`              | Whether the interview was escalated to a human. |
| `completed`    | `boolean`              | Whether the interview has finished. |
| `summary`      | `string \| null`       | Final write-up text. |

```json
{
  "state": {
    "candidate": "Jane Doe",
    "phone": "+15551234567",
    "questions": [
      { "qIdx": 0, "text": "Tell me about a time you led a team...", "rubric": "0=No leadership..." }
    ],
    "currentQIdx": 1,
    "callId": "CA1234567890",
    "escalated": false,
    "completed": false,
    "summary": null
  }
}
```

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Actor state returned. |
| `404` | Not Found | Actor not found or not yet initialized. |

---

### 3. `GET /ws` (WebSocket)

WebSocket endpoint for the hiring-manager dashboard. The actor broadcasts live scorecard updates to all connected clients.

#### Connection

```bash
# Browser JS example
const ws = new WebSocket("http://<host>/ws");
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Scorecard update:", data);
};
```

#### Origin Check

The server validates the `Origin` header against `DASHBOARD_ORIGIN`. Mismatched origins receive `403 Forbidden`.

#### Broadcast Payload

Each message pushed to connected dashboards has the following shape:

| Field     | Type     | Description |
|-----------|----------|-------------|
| `qIdx`    | `number` | Question index just scored. |
| `answer`  | `string` | Candidate's transcribed answer. |
| `score`   | `number` | Rubric score (0–3). |
| `choice`  | `string` | `"continue"` \| `"ask-clarify"` \| `"skip"` |
| `noul`    | `number` | Escalation confidence (0–1). |
| `running` | `number` | Running total score across all answered questions. |
| `total`   | `number` | Total number of questions. |

```json
{
  "qIdx": 0,
  "answer": "I led a team of 5 engineers through a migration...",
  "score": 2,
  "choice": "continue",
  "noul": 0.1,
  "running": 2,
  "total": 2
}
```

When the interview completes, a final message is sent:

```json
{
  "completed": true,
  "summary": "Interview with Jane Doe completed. Total score: 4/6. 2 questions answered. Escalated: false."
}
```

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `101` | Switching Protocols | WebSocket connection established. |
| `400` | Bad Request | WebSocket upgrade failed. |
| `403` | Forbidden | Origin not allowed. |

---

## Internal / Callback Endpoints

These endpoints are invoked by Telnyx Call Control webhooks and are not intended for direct external use. They are handled within the `InterviewCall` actor's `fetch` method.

### 4. `POST /callbacks/call-ai-gather-ended`

Webhook callback fired by Telnyx when `gather-using-ai` completes. Contains the transcribed answer.

#### Request Body (Telnyx webhook payload)

| Field              | Type     | Description |
|--------------------|----------|-------------|
| `data.payload.call_control_id` | `string` | Call Control ID to match against actor state. |
| `data.payload.transcript`      | `string` | Transcribed candidate answer. |
| `data.payload.digits`          | `string` | DTMF digits captured (if any). |

#### Response

**Status: `200 OK`** — Acknowledges receipt. Triggers `scoreAnswer` → `doScoreAnswer` (queued).

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Callback processed. |
| `400` | Bad Request | Payload validation failed. |

---

### 5. `POST /callbacks/call-hangup`

Webhook callback fired by Telnyx when the candidate hangs up. Triggers recovery logic.

#### Request Body (Telnyx webhook payload)

| Field              | Type     | Description |
|--------------------|----------|-------------|
| `data.payload.call_control_id` | `string` | Call Control ID. |
| `data.payload.hangup`          | `object` | Hangup details (e.g. `reason`). |

#### Response

**Status: `200 OK`** — Acknowledges receipt. Triggers `handleHangup` → schedules `recoverInterview` with exponential backoff.

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Callback processed. |
| `400` | Bad Request | Payload validation failed. |

---

## Decision Models API (Outbound)

The actor calls the Telnyx Decision Models API directly via `fetch` (no SDK wrapper exists for typesafe evaluation). This is an internal outbound call, not an inbound route.

### `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone`

#### Request Body

| Field      | Type     | Description |
|------------|----------|-------------|
| `model`    | `string` | `"telnyx/decision-flash"` |
| `state`    | `object` | `{ question: string, answer: string, rubric: string }` |
| `questions`| `object` | `{ scoreQ: {type:"number",min:0,max:3}, verdict: {type:"choice",options:[...]}, escalate: {type:"noul",min:0,max:1} }` |

#### Response

| Field      | Type     | Description |
|------------|----------|-------------|
| `scoreQ`   | `number` | Rubric score (0–3). |
| `verdict`  | `string` | `"continue"` \| `"ask-clarify"` \| `"skip"` |
| `escalate` | `number` | Escalation confidence (0–1). |

#### Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Decision model evaluated. |
| `429` | Too Many Requests | Rate limited; retry with `Retry-After`. |
| `529` | Service Unavailable | Overloaded; retry with `Retry-After`. |
| `502` / `503` | Bad Gateway / Service Unavailable | Transient; retry with backoff. |

---

## Call Control API (Outbound)

The actor places calls and issues Call Control commands via direct `fetch` to the Telnyx API.

### `POST https://api.telnyx.com/v2/calls`

Dials the candidate.

#### Request Body

| Field                       | Type     | Description |
|-----------------------------|----------|-------------|
| `connection_id`             | `string` | Outbound Call Control App ID. |
| `from`                      | `string` | Caller ID phone number. |
| `to`                        | `string` | Candidate phone number. |
| `timeout`                   | `number` | Ring timeout in seconds. |
| `record`                    | `boolean`| Whether to record the call. |
| `call_control_instruction`  | `object` | `{ instruction: "Answer", clients: [] }` |

#### Response

| Field                    | Type     | Description |
|--------------------------|----------|-------------|
| `data.call_control_id`   | `string` | Call Control ID for subsequent commands. |

### `POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak`

Plays TTS audio to the candidate.

#### Request Body

| Field    | Type     | Description |
|----------|----------|-------------|
| `text`   | `string` | Text to synthesize and play. |
| `voice`  | `string` | Voice name (e.g. `"male"`). |
| `language`| `string`| Language code (e.g. `"en-US"`). |

### `POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/gather_using_ai`

Starts an AI-powered speech capture session.

#### Request Body

| Field              | Type     | Description |
|--------------------|----------|-------------|
| `speech_request`   | `object` | `{ prompt: string, model: string, language: string }` |
| `max_wait_time`    | `number` | Silence timeout in ms. |
| `max_terminators`  | `number` | Max DTMF terminators. |
| `terminator`       | `string` | DTMF terminator character. |

### `POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup`

Ends the call.

#### Request Body

| Field     | Type     | Description |
|-----------|----------|-------------|
| `hangup`  | `object` | `{ strict: boolean }` |

---

## SQL Storage Schema

The actor uses a SQL database (`SCORECARD_DB` binding) to persist the scorecard and resume pointer.

### Table: `interviews`

| Column     | Type    | Description |
|------------|---------|-------------|
| `phone`    | `TEXT`  | Candidate phone (partition key). |
| `qIdx`     | `INTEGER`| Question index (UNIQUE per phone). |
| `answer`   | `TEXT`  | Transcribed answer. |
| `score`    | `REAL`  | Rubric score (0–3). |
| `choice`   | `TEXT`  | `"continue"` \| `"ask-clarify"` \| `"skip"` |
| `noul`     | `REAL`  | Escalation confidence (0–1). |
| `notes`    | `TEXT`  | Raw Decision Model JSON response. |
| `answered` | `INTEGER`| `1` if answered, `0` otherwise. |

**Primary Key:** `(phone, qIdx)` — ensures no duplicate answers and enables resume-on-reconnect.
```
