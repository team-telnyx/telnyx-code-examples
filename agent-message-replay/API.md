# API Reference — agent-message-replay

Typed reference for the Edge function's HTTP routes, the WebSocket protocol, and the agent's remote-callable methods.

Base URL after deploy: `https://<your-function>.telnyxcompute.com`

## HTTP Routes

### `GET /`

Serves the demo UI (single-file browser client) when `DEMO_MODE` is `"true"`; `404` otherwise.

**Response**: `200` — `text/html; charset=utf-8`.

### `GET /health`

Liveness probe.

**Response**: `200`

```json
{
  "ok": true,
  "demo": true,
  "model": "zai-org/GLM-5.2",
  "brand": "agent-message-replay v0.1.0"
}
```

### `POST /ingest`

Store (or replace) the conversation recording for the actor named by `conversation_id`. Zod-validated at the trust boundary. Requires `Authorization: Bearer <INGEST_TOKEN>` only when `INGEST_TOKEN` is set.

**Request**

```json
{
  "conversation_id": "support-48211",
  "replace": true,
  "steps": [
    { "role": "user", "content": "I was charged twice.", "delayMs": 600 },
    { "role": "assistant", "content": "I can help with that.", "delayMs": 1400, "stage": "intake" }
  ]
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `conversation_id` | string | 1–64 chars of `[a-zA-Z0-9_-]`; names the durable actor |
| `replace` | boolean | default `true` — re-ingesting the same id replaces the recording |
| `steps` | array | 1–200 steps |
| `steps[].role` | enum | `"user" \| "assistant" \| "system"` |
| `steps[].content` | string | 1–4000 chars |
| `steps[].delayMs` | int | 0–60000; gap after the previous step |
| `steps[].stage` | string? | optional original-agent stage (≤64 chars) re-enacted during replay |

**Response**: `200`

```json
{ "ok": true, "conversation_id": "support-48211", "total": 2, "ws_url": "/ws?conv=support-48211" }
```

**Errors**: `400` (invalid JSON or schema violation — `issues[]` carries zod details), `401` (bad bearer token), `502` (storage failure — generic message).

### `GET /ws?conv=<conversation_id>` (WebSocket upgrade)

Live replay stream. The upgrade request is forwarded to the durable actor named by `conv` (default `billing-support-demo`); the actor's `AgentSocketServer` speaks the agent socket protocol on the accepted socket.

## WebSocket Protocol

Frames are SuperJSON-encoded text: `{"json": <frame>, "meta": <optional transforms>}`.

### Client → server

| Frame | Shape | Purpose |
|-------|-------|---------|
| `attach` (v2) | `{v:2, kind:"attach", token?, subscribe?, cursors?}` | First frame (within the 300 ms grace window). `token` selects claims; `subscribe` picks streams from `"state"`, `"messages"`, `"events"`; `cursors.events` resumes the event backlog after a seq. |
| `call` (v1) | `{v:1, kind:"call", id, method, args}` | Invoke an `@rpc()` method. Requires the `"rpc"` claim. |
| `ping` (v1) | `{v:1, kind:"ping"}` | Heartbeat. |

### Server → client

| Frame | Shape | When |
|-------|-------|------|
| `hello` (v1) | `{v:1, kind:"hello"}` | Bootstrap complete (after snapshots). |
| `attached` (v2) | `{v:2, kind:"attached", grants, accepted}` | Attach negotiated; `grants` e.g. `["read","rpc"]`. |
| `state` | `{v:1, kind:"state", snapshot?}` on connect, `{kind:"state", patch?}` on change | Full state on connect; RFC 7396 merge-patch per `setState`. |
| `messages` | `{v:1, kind:"messages", snapshot?}` on connect, `{kind:"messages", appended?}` per append | MessageLog snapshot, then each replayed message. |
| `event` (v2) | `{v:2, kind:"event", seq, type, payload, at}` | Live events: `recording_loaded`, `playback_started`, `playback_paused`, `playback_seeked`, `state_change`, `commentary`, `commentary_skipped`, `commentary_error`, `commentary_toggled`, `replay_finished`. |
| `result` | `{v:1, kind:"result", id, value}` | Successful `call`. |
| `error` | `{v:1, kind:"error", id?, code, message}` | Failed `call` (with `id`) or connection-level fault (without). |

### State shape (`ReplayState`)

| Field | Type | Meaning |
|-------|------|---------|
| `status` | `"empty" \| "ready" \| "playing" \| "paused" \| "finished"` | Replay lifecycle |
| `playhead` | number | Index of the next step to play (0-based) |
| `total` | number | Steps in the loaded recording |
| `speed` | number | Playback multiplier (`0.5 \| 1 \| 2 \| 4`) |
| `commentary` | boolean | LLM commentary enabled |
| `commentaryBusy` | boolean | Commentary completion in flight |
| `agentStage` | string | Re-enacted original-agent stage |
| `conversationId` | string | Loaded recording's id |

## RPC Methods

All are `@rpc()`-decorated on `ReplayAgent` and dispatch over the socket for connections holding the `"rpc"` claim (attach with `REPLAY_TOKEN`).

| Method | Args | Returns | Notes |
|--------|------|---------|-------|
| `seed` | — | `{total}` | Loads the built-in 10-step demo recording; resets the playhead. |
| `play` | — | `{status}` | Starts/resumes; errors when no recording is loaded (`"empty"`). |
| `pause` | — | `{status}` | Durable pause — the next scheduled tick exits. |
| `seek` | `[index]` | `{playhead}` | Clamps to `0..total`; emits `playback_seeked`. |
| `setSpeed` | `[speed]` | `{speed}` | One of `0.5, 1, 2, 4`; takes effect on the next tick. |
| `setCommentary` | `[enabled]` | `{commentary}` | Boolean; takes effect on the next assistant step. |

### Example session (raw frames)

```text
→ {"json":{"v":2,"kind":"attach","token":"replay-demo","subscribe":["state","messages","events"]}}
← {"json":{"v":2,"kind":"attached","grants":["read","rpc"],"accepted":["state","messages","events"]}}
← {"json":{"v":1,"kind":"state","snapshot":{"status":"empty","playhead":0,"total":0,"speed":1,"commentary":false,"commentaryBusy":false,"agentStage":"","conversationId":""}}}
← {"json":{"v":1,"kind":"hello"}}
→ {"json":{"v":1,"kind":"call","id":"c1","method":"seed","args":[]}}
← {"json":{"v":1,"kind":"result","id":"c1","value":{"total":10}}}
← {"json":{"v":1,"kind":"state","patch":{"status":"ready","total":10,"conversationId":"billing-support-demo"}}}
→ {"json":{"v":1,"kind":"call","id":"c2","method":"play","args":[]}}
← {"json":{"v":2,"kind":"event","seq":3,"type":"playback_started","payload":{"playhead":0,"speed":1},"at":"2026-09-01T21:00:00.000Z"}}
← {"json":{"v":1,"kind":"messages","appended":[{"seq":1,"role":"user","content":"Hi — I think I was charged twice on my March invoice.","at":"2026-09-01T21:00:01.000Z"}]}}
← {"json":{"v":1,"kind":"state","patch":{"playhead":1,"agentStage":"intake"}}}
```
