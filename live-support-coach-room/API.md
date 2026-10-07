# API Reference — Live Support Coach Room

All HTTP routes are served by the edge function. WebSocket routes are mounted under `/agents/`.

## HTTP routes

### `GET /health/liveness`

Returns `200` with body `ok`.

### `GET /health/readiness`

Returns `200` with the room knobs summary.

```json
{ "status": "ok", "nudge_max": 3 }
```

### `GET /rooms`

The shift's room list, split by state.

**Response:**

```json
{
  "active": [
    {
      "conversation_id": "conv-9c1f4a2b",
      "started_at": 1727654321000,
      "ended": false,
      "nudges": 1,
      "took_over": false,
      "flag_count": 2
    }
  ],
  "ended": []
}
```

### `POST /rooms/{conversation_id}/join`

Escalation. Dials `SUPERVISOR_DEVICE` via Call Control and joins that leg into the live AI conversation via `POST /v2/calls/{call_control_id}/actions/ai_assistant_join`.

**Request:** empty body.

**Response (200):**

```json
{ "success": true, "message": "Supervisor joined the live call", "conversation_id": "conv-9c1f4a2b" }
```

**Response (409)** — no active conversation, escalation already done, or a dial/join failure:

```json
{ "success": false, "message": "No active conversation in this room" }
```

### `GET /rooms/{conversation_id}/snapshot`

Current room snapshot (the same view the desk pushes to supervisor tabs).

```json
{
  "conversation_id": "conv-9c1f4a2b",
  "turns": 4,
  "flags": ["refund_promise"],
  "nudges": 1,
  "took_over": false,
  "stream_up": true,
  "started_at": 1727654321000
}
```

### `GET /rooms/{conversation_id}/log`

`coach_log` audit rows for this room's actor SQL.

```json
{
  "rows": [
    {
      "id": 1,
      "conversation_id": "conv-9c1f4a2b",
      "flags": "[\"refund_promise\"]",
      "nudges": 1,
      "took_over": 0,
      "duration_sec": 96,
      "end_reason": "normal",
      "created_at": "2026-09-29 21:30:00"
    }
  ]
}
```

### `POST /demo/start`

Start a simulated conversation — same room pipeline as a live call, without telephony.

**Request:**

```json
{ "conversation_id": "my-demo-id" }
```

`conversation_id` is optional; one is generated when omitted.

**Response (201):**

```json
{ "conversation_id": "my-demo-id" }
```

### `POST /demo/say`

Inject a caller turn. The body shape mirrors a live `conversation.item.created` frame, so the room cannot tell a simulated turn from a real one. Returns any inject frames the policy produced.

**Request:**

```json
{ "conversation_id": "my-demo-id", "text": "My account number is 5521890244" }
```

**Response (201):**

```json
{
  "inject": [
    {
      "type": "conversation.item.create",
      "item": {
        "type": "message",
        "role": "assistant",
        "content": [{ "type": "input_text", "text": "Verify identity with date of birth next." }]
      }
    }
  ],
  "summary": { "conversation_id": "my-demo-id", "turns": 1, "flags": [], "nudges": 1, "took_over": false, "stream_up": false, "started_at": 1727654321000 }
}
```

### `POST /demo/assistant-say`

Inject an assistant turn — same request/response shape as `POST /demo/say` with `role: "assistant"`.

### `POST /demo/end`

End the simulated call — files the `coach_log` row and resets the room.

**Request:**

```json
{ "conversation_id": "my-demo-id", "duration_sec": 96 }
```

`duration_sec` is optional; it falls back to the wall-clock session length.

**Response (200):**

```json
{ "ended": true, "conversation_id": "my-demo-id" }
```

### `GET /dashboard`, `GET /caller`

Browser surfaces — the supervisor dashboard and the caller simulator.

## WebSocket routes

### `wss://<fn-host>/agents/assist/livewire` — assistant event stream

The assistant's `websocket_settings.url`. The `livewire` id segment is required by the agent mount (one actor per path id); it is stable — Telnyx opens one socket per conversation to this URL. Telnyx authenticates with `Authorization: Bearer <auth_ref>`; the relay rejects upgrades whose bearer token is not the `COACH_AUTH` secret (`1008 Unauthorized`).

**Frames Telnyx sends** (bare JSON, discriminated by `type`; unknown types ignored):

| Frame | Key fields | Handling |
|---|---|---|
| `session.created` | `conversation_id`, `assistant_id`, call ids | Binds the socket; opens the per-conversation room |
| `conversation.item.created` | `item.role`, `item.content[0].text` | Transcript turn; trigger evaluation on caller turns |
| `response.created` / `response.text.delta` | `delta`, `item_id` | Activity markers for the silence watcher |
| `telnyx.call.answered` / `telnyx.call.hangup` | `cause` | Call lifecycle markers |
| `session.ended` | `reason`, `duration_sec`, `transfer_status` | Files the `coach_log` row; tears the room down |
| `error` | `code` | Frame refused — logged, never crashes the relay |

**Frames the relay sends** (only after `session.created`):

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "assistant",
    "content": [{ "type": "input_text", "text": "Verify identity with date of birth next." }]
  }
}
```

An `assistant` item is recorded silently (the model sees it but does not speak it); a `user` item triggers a reply. Platform limits: frames ≤ 1 MiB, ≤ 10 fps, no binary frames.

### `wss://<fn-host>/agents/coach-room/{conversation_id}?token=<COACH_AUTH>`

Supervisor room view. Pushes a full state snapshot on connect and a merge-patch on every state change. Unauthenticated or wrong-token connections are rejected.

**Snapshot payload keys:** `conversationId`, `assistantId`, `callLegId`, `streamUp`, `startedAt`, `lastActivity`, `turns` (`[{role, text, at}]`), `flags`, `nudges`, `tookOver`, `ended`, `accountMentions`, `silenceSecs`, `error`.

## Coach triggers

| Trigger | Condition | Effect |
|---|---|---|
| Identity loop | ≥ 2 caller turns matching `/(account\|member\|patient)\s+(number\|id)/` or `\b\d{4,}\b` | Injects "Verify identity with date of birth next." |
| Refund promise | caller turn contains "refund" | Flags `refund_promise` on the room |
| Silence | `SILENCE_SECS` (default 90) since the last stream frame | Injects a check-in nudge; flags `silence_flag` |

Nudges are capped at `NUDGE_MAX_PER_CALL` (default 3) per conversation and sized ≤ 1 MiB per frame.

## Side-channel guarantee

Dropping `/agents/assist` never reaches the call. The room marks `stream_up: false`, Telnyx reconnects with exponential backoff (1s → 30s, reset after 10s stable), and supervisor tabs resync from the room snapshot — no backlog replay, by design.
