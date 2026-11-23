# API Reference — concierge-diary

Typed endpoint contract for the `concierge-diary` edge service. Every route is served by the default export in `src/index.ts`, which resolves a durable `DiaryActor` via `env.DIARY.idFromName(conversationId)` and forwards the request to it. One actor instance == one conversation == one diary entry.

- **Base URL:** `$BASE_URL` (your `telnyx-edge ship` deployment host, e.g. `https://concierge-diary.example.telnyxedge.dev`)
- **Content-Type:** `application/json` on every request with a body
- **Auth:** shared secret. If `DIARY_WEBHOOK_SECRET` is set (secret store or env), every mutating `POST` must present it as `Authorization: Bearer <secret>` or `X-Diary-Token: <secret>`; requests without it get `401`. In live mode (`DEMO_MODE=false`) the secret is mandatory — the AI Assistant's diary webhook tool is the only intended caller, and unauthenticated bookings could place real outbound calls. `GET /diary` (read-only diary view) stays unauthenticated.
- **Actor routing:** `conversationId` is the actor key. It is read from the JSON body for `POST` routes and from the `conversationId` query parameter for `GET /diary`.

---

## Route index

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/diary` | Read the diary state + persisted row for one conversation |
| `POST` | `/diary/entries` | Post-conversation webhook tool target — book the follow-up call |
| `POST` | `/diary/reschedule` | Move a pending follow-up to a new timestamp |
| `POST` | `/diary/event-status` | Scheduled-event status callback (`completed` / `failed` / `no_answer`) |
| `POST` | `/diary/sweep` | Re-run the exactly-once create guard after a crash |
| `POST` | `/diary/cancel` | Patient opts out — delete the pending event, close the row |

---

## `GET /diary`

Returns the actor's durable state plus the persisted `diary` row for a single conversation.

### Query parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Actor key. Must be non-empty after trimming. |

### Example request

```bash
curl -s "$BASE_URL/diary?conversationId=conv_01J9ZK8Q2R" | jq
```

### Response — `200 OK`

```json
{
  "state": {
    "conversationId": "conv_01J9ZK8Q2R",
    "patientName": "Maya",
    "topic": "MRI results call",
    "opener": "Maya, Dr. Chen's office — your MRI results are in.",
    "callbackAt": "2026-11-12T10:00:00-08:00",
    "endUserTarget": "+15105550142",
    "agentTarget": "+15105550100",
    "eventId": "evt_01J9ZK9A7M",
    "status": "booked",
    "createPending": false,
    "pendingBody": null
  },
  "rows": [
    {
      "conversation_id": "conv_01J9ZK8Q2R",
      "patient": "Maya",
      "callback_at": "2026-11-12T10:00:00-08:00",
      "status": "booked",
      "event_id": "evt_01J9ZK9A7M",
      "topic": "MRI results call",
      "updated_at": "2026-11-10T22:04:11.882Z"
    }
  ]
}
```

`rows` is `[]` when no diary row has been written yet (fresh actor, `status: "new"`).

### Status codes

| Code | Meaning |
|---|---|
| `200` | State and rows returned |
| `400` | `conversationId` query parameter missing or empty |
| `404` | Path is not `/diary` |
| `500` | Actor threw an unexpected error (generic body, details logged server-side) |

---

## `POST /diary/entries`

The AI Assistant's **post-conversation webhook tool** target. Called once at the end of the conversation with the wrap-up turn's decision: whether a follow-up is needed, when, and what the opener should say.

Behaviour:

1. Validates the intent (see field rules below).
2. Writes `status: "booked"` to the `diary` table and sets `createPending: true` in durable state.
3. Schedules a durable sweep timer (`this.schedule(DIARY_SWEEP_SECONDS, "onSweep")`).
4. Creates the Telnyx scheduled event and stores `eventId`, clearing `createPending`.
5. Sends the confirmation SMS (skipped in demo mode).

Idempotent: if the actor already holds a `booked` event for the same `callbackAt`, the call returns the existing state without creating a second event.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Telnyx conversation id. Actor key. Max 128 chars. |
| `patientName` | string | yes | Name used in the personalized opener. Max 120 chars. |
| `reason` | string | yes | Topic of the follow-up (e.g. `"MRI results call"`). Max 200 chars. Mapped to `dynamic_variables.topic`. |
| `callbackAt` | string | yes | ISO-8601 timestamp, must parse and be strictly in the future. Max 40 chars. Sent as `scheduled_at_fixed_datetime`. |
| `opener` | string | yes | First line the assistant speaks on the callback. Max 400 chars. |
| `endUserTarget` | string | yes | Patient's number in E.164 (`/^\+[1-9]\d{6,14}$/`). Max 20 chars. Sent as `telnyx_end_user_target`. |
| `agentTarget` | string | yes | Clinic/assistant number in E.164. Max 20 chars. Sent as `telnyx_agent_target`. |

All string fields are trimmed. Unknown fields are ignored.

### Example request

```bash
curl -s -X POST "$BASE_URL/diary/entries" \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv_01J9ZK8Q2R",
    "patientName": "Maya",
    "reason": "MRI results call",
    "callbackAt": "2026-11-12T10:00:00-08:00",
    "opener": "Maya, Dr. Chen'\''s office — your MRI results are in.",
    "endUserTarget": "+15105550142",
    "agentTarget": "+15105550100"
  }' | jq
```

### Response — `201 Created`

Returns the actor state after the create attempt:

```json
{
  "conversationId": "conv_01J9ZK8Q2R",
  "patientName": "Maya",
  "topic": "MRI results call",
  "opener": "Maya, Dr. Chen's office — your MRI results are in.",
  "callbackAt": "2026-11-12T10:00:00-08:00",
  "endUserTarget": "+15105550142",
  "agentTarget": "+15105550100",
  "eventId": "evt_01J9ZK9A7M",
  "status": "booked",
  "createPending": false,
  "pendingBody": null
}
```

In demo mode (`DEMO_MODE=true`, the default) `eventId` is a synthetic `demo_evt_<conversationId>_<epochMs>` and no Telnyx call is placed.

### Status codes

| Code | Meaning |
|---|---|
| `201` | Diary row written and scheduled event created (or demo-mode stub returned) |
| `400` | Body missing / not JSON / not an object; a required field missing or blank; a field over its max length; `callbackAt` not a future ISO-8601 timestamp; `endUserTarget` or `agentTarget` not E.164 |
| `404` | Path is not a known `/diary/*` route |
| `500` | Scheduled-event create failed, secret missing, or unexpected actor error |

---

## `POST /diary/reschedule`

Reschedule path. Deletes the currently pending scheduled event, then books a replacement at the new timestamp with the same patient/topic and (optionally) a new opener.

Behaviour: `DELETE /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` → state `status: "rescheduled"`, `createPending: true` → sweep timer armed → new event created → row updated.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Actor key. Must already have a diary entry, otherwise `404`. |
| `callbackAt` | string | yes | New ISO-8601 timestamp, strictly in the future. Max 40 chars. |
| `opener` | string | no | Replacement opener, max 400 chars. Defaults to the stored opener when omitted or blank. |

`patientName`, `reason`, `endUserTarget`, and `agentTarget` are carried over from the existing diary state — do not resend them.

### Example request

```bash
curl -s -X POST "$BASE_URL/diary/reschedule" \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv_01J9ZK8Q2R",
    "callbackAt": "2026-11-13T10:00:00-08:00",
    "opener": "Maya, Dr. Chen'\''s office — calling about your MRI results, as rescheduled."
  }' | jq
```

### Response — `200 OK`

Same `DiaryState` shape as `/diary/entries`, with `status: "rescheduled"` and the new `eventId`:

```json
{
  "conversationId": "conv_01J9ZK8Q2R",
  "patientName": "Maya",
  "topic": "MRI results call",
  "opener": "Maya, Dr. Chen's office — calling about your MRI results, as rescheduled.",
  "callbackAt": "2026-11-13T10:00:00-08:00",
  "endUserTarget": "+15105550142",
  "agentTarget": "+15105550100",
  "eventId": "evt_01J9ZKBM31",
  "status": "rescheduled",
  "createPending": false,
  "pendingBody": null
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Old event deleted (or absent) and replacement booked |
| `400` | Body invalid; `callbackAt` missing or not a future ISO-8601 timestamp |
| `404` | No diary entry exists for this `conversationId` |
| `500` | Delete or create call to the Telnyx API failed |

---

## `POST /diary/event-status`

Status callback for the scheduled event. Maps the follow-up call outcome onto the diary row.

| `callStatus` | Effect |
|---|---|
| `completed` | `status: "delivered"`, row updated with `event_id` |
| `failed` / `no_answer` | `status: "failed"`, row updated, error logged (no PII) |
| anything else | Ignored — state returned unchanged |

Events whose `eventId` does not match the actor's current `eventId` are ignored (stale callbacks from a deleted/rescheduled event).

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Actor key. |
| `eventId` | string | yes | Scheduled event id to match against the actor's current `eventId`. |
| `callStatus` | string | yes | `completed`, `failed`, or `no_answer`. |

### Example request

```bash
curl -s -X POST "$BASE_URL/diary/event-status" \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv_01J9ZK8Q2R",
    "eventId": "evt_01J9ZK9A7M",
    "callStatus": "completed"
  }' | jq
```

### Response — `200 OK`

`DiaryState` with the updated `status`:

```json
{
  "conversationId": "conv_01J9ZK8Q2R",
  "patientName": "Maya",
  "topic": "MRI results call",
  "opener": "Maya, Dr. Chen's office — your MRI results are in.",
  "callbackAt": "2026-11-12T10:00:00-08:00",
  "endUserTarget": "+15105550142",
  "agentTarget": "+15105550100",
  "eventId": "evt_01J9ZK9A7M",
  "status": "delivered",
  "createPending": false,
  "pendingBody": null
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Status applied, or callback ignored as stale/unknown |
| `400` | Body missing or not a JSON object |
| `404` | Path is not a known `/diary/*` route |
| `500` | Unexpected actor error |

---

## `POST /diary/sweep`

Resume proof. Re-runs the exactly-once create guard after a pod was killed between the diary write and the scheduled-event create. Normally invoked by the actor's own durable timer (`this.schedule(DIARY_SWEEP_SECONDS, "onSweep")`); exposed as an HTTP route so the recovery path can be exercised manually.

If `createPending` is `false`, the call is a no-op — this is what prevents duplicate events.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Actor key. |

### Example request

```bash
curl -s -X POST "$BASE_URL/diary/sweep" \
  -H 'Content-Type: application/json' \
  -d '{ "conversationId": "conv_01J9ZK8Q2R" }' | jq
```

### Response — `200 OK`

```json
{ "recreated": true, "eventId": "evt_01J9ZK9A7M" }
```

| Field | Type | Description |
|---|---|---|
| `recreated` | boolean | `true` if a pending create was replayed, `false` if nothing was pending |
| `eventId` | string \| null | Current scheduled event id after the sweep |

### Status codes

| Code | Meaning |
|---|---|
| `200` | Sweep executed (recreated or no-op) |
| `400` | Body missing or not a JSON object |
| `404` | Path is not a known `/diary/*` route |
| `500` | Scheduled-event create failed during replay |

---

## `POST /diary/cancel`

Patient opts out. Deletes the pending scheduled event (if any) and closes the diary row as `canceled`. `createPending` is cleared so a later sweep cannot resurrect the booking.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversationId` | string | yes | Actor key. Must already have a diary entry, otherwise `404`. |

### Example request

```bash
curl -s -X POST "$BASE_URL/diary/cancel" \
  -H 'Content-Type: application/json' \
  -d '{ "conversationId": "conv_01J9ZK8Q2R" }' | jq
```

### Response — `200 OK`

```json
{
  "conversationId": "conv_01J9ZK8Q2R",
  "patientName": "Maya",
  "topic": "MRI results call",
  "opener": "Maya, Dr. Chen's office — your MRI results are in.",
  "callbackAt": "2026-11-12T10:00:00-08:00",
  "endUserTarget": "+15105550142",
  "agentTarget": "+15105550100",
  "eventId": null,
  "status": "canceled",
  "createPending": false,
  "pendingBody": null
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Event deleted (or absent) and row closed |
| `400` | Body missing or not a JSON object |
| `404` | No diary entry exists for this `conversationId` |
| `500` | Delete call to the Telnyx API failed |

---

## Shared schemas

### `DiaryState`

| Field | Type | Description |
|---|---|---|
| `conversationId` | string | Actor key / Telnyx conversation id |
| `patientName` | string | Patient name from the intent |
| `topic` | string | Follow-up reason (`reason` from the intent) |
| `opener` | string | Personalized first line for the callback |
| `callbackAt` | string | ISO-8601 timestamp of the booked call |
| `endUserTarget` | string | E.164 number dialed |
| `agentTarget` | string | E.164 number the assistant dials from |
| `eventId` | string \| null | Telnyx scheduled event id (`null` before create / after cancel) |
| `status` | string | `new` \| `booked` \| `delivered` \| `rescheduled` \| `canceled` \| `failed` |
| `createPending` | boolean | Exactly-once guard — `true` between the diary write and the event create |
| `pendingBody` | object \| null | The intent awaiting creation; consumed and nulled by the sweep |

### `DiaryRow` (SQL)

Table `diary`, primary key `conversation_id`:

| Column | Type | Description |
|---|---|---|
| `conversation_id` | TEXT PK | Actor key |
| `patient` | TEXT | Patient name |
| `callback_at` | TEXT | ISO-8601 callback timestamp |
| `status` | TEXT | `booked` \| `delivered` \| `rescheduled` \| `canceled` \| `failed` |
| `event_id` | TEXT | Scheduled event id, `null` before create |
| `topic` | TEXT | Follow-up reason |
| `updated_at` | TEXT | ISO-8601 write timestamp |

### Error envelope

Every non-2xx response uses the same shape:

```json
{ "error": "callbackAt must be a future ISO-8601 timestamp" }
```

`500` responses always return the generic `{ "error": "internal error" }`; the underlying cause is logged server-side only.

---

## Outbound Telnyx API calls

The actor makes these calls on your behalf. They are part of the contract because their payloads are derived from the request bodies above.

### `POST /v2/ai/assistants/{assistant_id}/scheduled_events`

Sent by `/diary/entries`, `/diary/reschedule`, and `/diary/sweep`. Skipped in demo mode.

```json
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": "+15105550142",
  "telnyx_agent_target": "+15105550100",
  "scheduled_at_fixed_datetime": "2026-11-12T10:00:00-08:00",
  "dynamic_variables": {
    "patient_name": "Maya",
    "topic": "MRI results call",
    "clinic_name": "Northside Imaging",
    "opener": "Maya, Dr. Chen's office — your MRI results are in."
  },
  "max_retries_client_errors": 2,
  "retry_interval_secs": 300
}
```

`assistant_id` comes from `TELNYX_ASSISTANT_ID`; `clinic_name` from `CLINIC_NAME`. The response's `data.id` is stored as `eventId`. A non-2xx response or a missing `data.id` surfaces as `500`.

### `DELETE /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}`

Sent by `/diary/reschedule` and `/diary/cancel`. A `404` from Telnyx is treated as success (event already gone); any other non-2xx surfaces as `500`.

### `TELNYX.messages.send()`

Confirmation SMS after a successful create, via the zero-credential `TELNYX` binding:

```
Northside Imaging: your callback is booked for 2026-11-12T10:00:00-08:00. Reply RESCHEDULE to move it.
```

Failures here are logged and swallowed — they never fail the HTTP request. Skipped in demo mode, where only a masked phone (`+1510****42`) is logged.
