# API Reference — Live Support Coach Room

This document describes the HTTP and WebSocket endpoints exposed by the `CoachRoom` agent (`src/index.ts`). The agent is a Telnyx Edge Actor that receives the AI Assistant conversation event stream over WebSocket, fans live transcript and policy flags out to supervisor dashboard tabs, injects coaching nudges, and escalates to a human via Call Control + `ai_assistant_join`.

---

## Table of Contents

1. [WebSocket — Assistant Event Stream](#websocket--assistant-event-stream)
2. [WebSocket — Supervisor Dashboard](#websocket--supervisor-dashboard)
3. [HTTP — Health Check](#http--health-check)
4. [RPC — joinCall (Escalation)](#rpc--joincall-escalation)
5. [Call Control — Dial Supervisor (Outbound)](#call-control--dial-supervisor-outbound)
6. [Call Control — Join Supervisor into AI Conversation](#call-control--join-supervisor-into-ai-conversation)
7. [SQL — coach_log Table](#sql--coach_log-table)
8. [Status Codes Summary](#status-codes-summary)

---

## WebSocket — Assistant Event Stream

The Telnyx AI Assistant opens a WebSocket connection to the `CoachRoom` actor per conversation, configured via `websocket_settings` on the assistant. The actor authenticates the connection using the `auth_ref` query parameter and processes conversation event frames.

### Endpoint

```
GET /?auth_ref=<COACH_AUTH>
```

### Query Parameters

| Parameter  | Type   | Required | Description |
|------------|--------|----------|-------------|
| `auth_ref` | string | Yes      | Integration secret that must match `env.COACH_AUTH`. |

### Request — WebSocket Message Frames

The assistant sends JSON frames. The actor handles the following event types:

| Field                     | Type     | Required | Description |
|---------------------------|----------|----------|-------------|
| `type`                    | string   | Yes      | Event type. One of: `session.created`, `conversation.item.created`, `response.text.delta`, `telnyx.call.hangup`, `session.ended`. |
| `conversation_id`         | string   | Conditional | Present on `session.created`. Unique conversation identifier. |
| `call_control_id`         | string   | Conditional | Present on `session.created`. Call Control ID of the AI call. |
| `item`                    | object   | Conditional | Present on `conversation.item.created`. Contains `role` and `content`. |
| `item.role`               | string   | Conditional | `"user"` or `"assistant"`. |
| `item.content`            | array    | Conditional | Array of content objects. `content[0].text` holds the message text. |
| `delta`                   | string   | Conditional | Present on `response.text.delta`. Incremental assistant text. |
| `duration_sec`            | number   | Conditional | Present on `session.ended`. Total call duration in seconds. |
| `reason`                  | string   | Conditional | Present on `session.ended`. Hangup reason. |

### Example — `session.created` Frame

```json
{
  "type": "session.created",
  "conversation_id": "conv_abc123",
  "call_control_id": "call_def456"
}
```

### Example — `conversation.item.created` Frame

```json
{
  "type": "conversation.item.created",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      { "type": "input_text", "text": "My account number is 1234" }
    ]
  }
}
```

### Example — `response.text.delta` Frame

```json
{
  "type": "response.text.delta",
  "delta": "Let me look that up for you."
}
```

### Example — `session.ended` Frame

```json
{
  "type": "session.ended",
  "duration_sec": 187,
  "reason": "caller_hung_up"
}
```

### Response — WebSocket Outbound (Nudge Injection)

The actor sends `conversation.item.create` frames back over the assistant WebSocket to inject coaching nudges:

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| `type` | string | Yes      | Must be `conversation.item.create`. |
| `item.type` | string | Yes | Must be `message`. |
| `item.role` | string | Yes | Must be `user` (triggers a reply) or `assistant` (records silently). |
| `item.content` | array | Yes | Array with one object: `{ type: "input_text", text: "<nudge text>" }`. |

### Example — Nudge Injection Frame

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      { "type": "input_text", "text": "Verify identity with date of birth next." }
    ]
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 101  | Switching Protocols — WebSocket connection established. |
| 1008 | Policy Violation — `auth_ref` does not match `env.COACH_AUTH`. |

---

## WebSocket — Supervisor Dashboard

Supervisor dashboard browser tabs connect to this WebSocket to receive live transcript, policy flags, nudge events, and escalation notifications. The `AgentSocketServer` fans out frames to all connected tabs.

### Endpoint

```
GET /ws
```

### Query Parameters

None.

### Request — WebSocket Messages (Supervisor → Actor)

Supervisors may send text messages (e.g., manual nudge commands). The actor logs these.

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| (raw) | string | Yes      | Arbitrary text message from the supervisor. |

### Response — WebSocket Outbound (Actor → Supervisor)

The actor broadcasts JSON frames to all connected supervisor tabs.

| Field   | Type    | Required | Description |
|---------|---------|----------|-------------|
| `type`  | string  | Yes      | One of: `transcript`, `flag`, `nudge`, `escalation`, `session_end`. |
| `payload` | object | Yes      | Event-specific data. See below. |

#### `transcript` Payload

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `role`      | string | Yes      | `"user"` or `"assistant"`. |
| `text`      | string | Yes      | Transcript text (or delta for streaming). |
| `timestamp` | number | Yes      | Unix epoch milliseconds. |

#### `flag` Payload

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `flag`      | string | Yes      | Flag name (e.g., `refund_promise`, `90s_silence`, `caller_hung_up`). |
| `timestamp` | number | Yes      | Unix epoch milliseconds. |

#### `nudge` Payload

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `text`      | string | Yes      | The injected nudge text. |
| `timestamp` | number | Yes      | Unix epoch milliseconds. |

#### `escalation` Payload

| Field             | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `supervisorCcId`  | string | Yes      | Call Control ID of the dialed supervisor leg. |
| `conversationId`  | string | Yes      | Conversation ID being escalated. |
| `timestamp`       | number | Yes      | Unix epoch milliseconds. |

#### `session_end` Payload

| Field       | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `durationSec` | number | Yes      | Total call duration in seconds. |
| `flags`     | array  | Yes      | Array of flag strings. |
| `nudges`    | number | Yes      | Total nudges injected. |
| `tookOver`  | boolean | Yes     | Whether a supervisor joined the call. |

### Example — Broadcast Frame

```json
{
  "type": "transcript",
  "payload": {
    "role": "user",
    "text": "My account number is 1234",
    "timestamp": 1722000000000
  }
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 101  | Switching Protocols — WebSocket connection established. |
| 400  | Bad Request — Upgrade failed. |

---

## HTTP — Health Check

Returns the actor's health status.

### Endpoint

```
GET /health
```

### Request Body

None.

### Response

**200 OK**

| Field    | Type   | Description |
|----------|--------|-------------|
| `status` | string | Always `"ok"`. |

### Example Request

```bash
curl https://<actor-url>/health
```

### Example Response

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200  | Actor is healthy. |
| 404  | Path not found. |

---

## RPC — joinCall (Escalation)

Invoked via the Agent SDK RPC surface (`@rpc joinCall`). Dials the supervisor's WebRTC device via Call Control and joins that leg into the live AI conversation using `ai_assistant_join`.

### Endpoint

```
POST /rpc/joinCall
```

> **Note:** This is an RPC method on the actor, not a standard HTTP route. It is invoked programmatically via the Agent SDK stub.

### Request Body

None.

### Response

**200 OK**

| Field    | Type    | Description |
|----------|---------|-------------|
| `success` | boolean | `true` if the supervisor was dialed and joined. |
| `message` | string  | Human-readable status message. |

### Example Response

```json
{
  "success": true,
  "message": "Supervisor joined the live call"
}
```

### Error Response

**400 Bad Request**

| Field    | Type    | Description |
|----------|---------|-------------|
| `success` | boolean | `false`. |
| `message` | string  | `"No active conversation"`. |

### Status Codes

| Code | Description |
|------|-------------|
| 200  | Supervisor dialed and joined successfully. |
| 400  | No active conversation in the room. |
| 500  | Internal error during Call Control dial or `ai_assistant_join`. |

---

## Call Control — Dial Supervisor (Outbound)

Called internally by the `joinCall` RPC method. Dials the supervisor's WebRTC device number via the Telnyx Call Control API.

### Endpoint

```
POST https://api.telnyx.com/v2/calls
```

### Request Body

| Field           | Type    | Required | Description |
|-----------------|---------|----------|-------------|
| `connection_id` | string  | Yes      | Call Control Connection ID from `env.CALL_CONTROL_CONNECTION_ID`. |
| `to`            | string  | Yes      | Supervisor device number from `env.SUPERVISOR_DEVICE`. |
| `from`          | string  | Yes      | Telnyx number from `env.TELNYX_NUMBER`. |
| `record`        | string  | No       | Recording setting. Set to `"record-from-answer"`. |

### Example Request

```bash
curl https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "CAxxxx",
    "to": "+1555XXXXXXXX",
    "from": "+1555XXXXXXXX",
    "record": "record-from-answer"
  }'
```

### Response

**200 OK**

| Field              | Type   | Description |
|--------------------|--------|-------------|
| `call_control_id`  | string | Call Control ID of the newly created outbound call. |
| `call_id`          | string | Telnyx call ID. |
| `status`           | string | Call status (e.g., `"ringing"`). |

### Status Codes

| Code | Description |
|------|-------------|
| 200  | Call created successfully. |
| 400  | Invalid request parameters. |
| 401  | Invalid API key. |

---

## Call Control — Join Supervisor into AI Conversation

Called internally by the `joinCall` RPC method. Joins the supervisor's Call Control leg into the running AI Assistant conversation.

### Endpoint

```
POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/ai_assistant_join
```

### Path Parameters

| Parameter         | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `call_control_id` | string | Yes      | Call Control ID of the AI assistant call (from `session.created`). |

### Request Body

| Field             | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `conversation_id` | string | Yes      | Conversation ID from `session.created`. |
| `participant.id`  | string | Yes      | Call Control ID of the supervisor's leg (from the outbound call response). |
| `participant.role`| string | Yes      | Must be `"user"`. |
| `participant.name`| string | Yes      | Display name for the supervisor (e.g., `"Supervisor"`). |

### Example Request

```bash
curl https://api.telnyx.com/v2/calls/{call_control_id}/actions/ai_assistant_join \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv_abc123",
    "participant": {
      "id": "call_sup_xyz",
      "role": "user",
      "name": "Supervisor"
    }
  }'
```

### Response

**200 OK**

| Field             | Type   | Description |
|-------------------|--------|-------------|
| `conversation_id` | string | The conversation ID the supervisor was joined into. |

### Example Response

```json
{
  "conversation_id": "conv_abc123"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200  | Supervisor joined the AI conversation successfully. |
| 400  | Invalid conversation ID or participant. |
| 401  | Invalid API key. |
| 404  | Call not found. |

---

## SQL — coach_log Table

The actor writes an audit trail row to the `coach_log` SQL table when a session ends (`session.ended` event).

### Table Schema

| Column             | Type     | Description |
|--------------------|----------|-------------|
| `conversation_id`  | TEXT     | Unique conversation identifier. |
| `flags`            | TEXT     | JSON-encoded array of policy flag strings. |
| `nudges`           | INTEGER  | Number of nudges injected during the call. |
| `took_over`        | INTEGER  | `1` if a supervisor joined, `0` otherwise. |
| `duration_sec`     | INTEGER  | Total call duration in seconds. |

### Insert Statement

```sql
INSERT INTO coach_log (conversation_id, flags, nudges, took_over, duration_sec)
VALUES (?, ?, ?, ?, ?)
```

### Example Row

| conversation_id | flags                              | nudges | took_over | duration_sec |
|-----------------|------------------------------------|--------|-----------|--------------|
| `conv_abc123`   | `["refund_promise","90s_silence"]` | 2      | 1         | 187          |

---

## Status Codes Summary

| Code | Applies To                          | Description |
|------|-------------------------------------|-------------|
| 101  | WebSocket (assistant, supervisor)   | Switching Protocols — connection established. |
| 1008 | WebSocket (assistant)               | Policy Violation — auth_ref mismatch. |
| 200  | HTTP `/health`, RPC `joinCall`, Call Control | Success. |
| 400  | HTTP `/health` (404 path), RPC `joinCall` (no active conversation), Call Control | Bad request or invalid parameters. |
| 401  | Call Control                          | Invalid API key. |
| 404  | HTTP (unknown path), Call Control     | Resource not found. |
| 500  | RPC `joinCall` (internal error)       | Internal server error. |

---

## Environment Variables

| Variable                    | Required | Description |
|-----------------------------|----------|-------------|
| `TELNYX_API_KEY`            | Yes      | Telnyx API key (from secrets). Used for Call Control API calls. |
| `CALL_CONTROL_CONNECTION_ID`| Yes      | Call Control Connection ID for outbound dialing. |
| `TELNYX_NUMBER`             | Yes      | Telnyx phone number used as the caller ID for outbound calls. |
| `SUPERVISOR_DEVICE`         | Yes      | Phone number of the supervisor's WebRTC softphone. |
| `DASHBOARD_ORIGIN`          | No       | Origin of the supervisor dashboard (for CORS). |
| `NUDGE_MAX_PER_CALL`        | No       | Maximum nudges per call (default: `3`). |
| `SILENCE_SECS`              | No       | Silence threshold in seconds (default: `90`). |
| `COACH_AUTH`                | Yes      | Integration secret for authenticating the assistant WebSocket stream. |
