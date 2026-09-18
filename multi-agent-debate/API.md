# API Reference — Multi-Agent Debate

All endpoints are served from a single Telnyx Edge Function entry point (`src/index.ts`). The function exports a default `fetch` handler that routes incoming HTTP requests to the appropriate internal handler.

---

## 1. Start Debate

Creates a new debate session with two opposing agents and begins the turn-based argument flow. In demo mode (`DEMO_MODE` != `false`) the debaters produce canned arguments; otherwise both run live inference through the `[telnyx]` binding.

### `POST /debate`

#### Request Body

| Field       | Type     | Required | Description                                      |
|-------------|----------|----------|--------------------------------------------------|
| `topic`     | `string` | No       | The debate topic. Defaults to `"Resolved: AI will benefit humanity"`. |
| `debateId`  | `string` | No       | Client-supplied debate id (1-64 letters, numbers, `_`, `.`, `-`). Supply one to attach a WebSocket audience to `/agents/room/{debateId}` *before* the argument turns are composed, so every turn streams in real time. Defaults to a server-generated id. |

#### Example Request

```bash
curl -X POST https://<edge-function-url>/debate \
  -H "Content-Type: application/json" \
  -d '{"topic": "AI should be regulated"}'
```

#### Response Schema

**Status Code: `201`**

```json
{
  "debateId": "debate_m9x2k1-4f8a",
  "topic": "AI should be regulated",
  "status": "voting",
  "currentTurn": "con",
  "createdAt": 1705312800000
}
```

| Field          | Type     | Description                                         |
|----------------|----------|-----------------------------------------------------|
| `debateId`     | `string` | Unique identifier for the debate session.           |
| `topic`        | `string` | The debate topic.                                   |
| `status`       | `string` | Current phase (`"debating"`, `"voting"`, `"ended"`, `"error"`). |
| `currentTurn`  | `string` | Which side speaks next (`"pro"` or `"con"`).        |
| `createdAt`    | `number` | Epoch milliseconds timestamp of session creation.   |

#### Status Codes

| Code | Meaning                             |
|------|-------------------------------------|
| 201  | Debate session created successfully.|
| 400  | Invalid request body.              |
| 500  | Internal server error.              |

---

## 2. Get Debate State

Retrieves the current state of a debate session, including all arguments generated so far and current vote counts.

### `GET /debate/{debateId}`

#### Path Parameters

| Field      | Type     | Required | Description                          |
|------------|----------|----------|--------------------------------------|
| `debateId` | `string` | Yes      | Unique identifier of the debate.     |

#### Example Request

```bash
curl https://<edge-function-url>/debate/debate_1234567890
```

#### Response Schema

**Status Code: `200`**

```json
{
  "debateId": "debate_m9x2k1-4f8a",
  "topic": "AI should be regulated",
  "demo": true,
  "model": "meta-llama/Llama-3.3-70B-Instruct",
  "phase": "voting",
  "currentTurn": "con",
  "args": [
    {
      "stance": "pro",
      "text": "Regulation ensures responsible AI development...",
      "turn": 1,
      "at": 1705312805000
    },
    {
      "stance": "con",
      "text": "Over-regulation stifles innovation...",
      "turn": 2,
      "at": 1705312812000
    }
  ],
  "tally": { "pro": 42, "con": 38, "total": 80 },
  "winner": "",
  "startedAt": 1705312800000,
  "endedAt": 0,
  "error": ""
}
```

| Field          | Type       | Description                                         |
|----------------|------------|-----------------------------------------------------|
| `debateId`     | `string`   | Unique identifier for the debate session.           |
| `topic`        | `string`   | The debate topic.                                   |
| `demo`         | `boolean`  | `true` when the debaters run on canned arguments.   |
| `model`        | `string`   | Inference model used in live mode.                  |
| `phase`        | `string`   | Current phase (`"debating"`, `"voting"`, `"ended"`, `"error"`). |
| `currentTurn`  | `string`   | Which side speaks next (`"pro"` or `"con"`).        |
| `args`         | `array`    | List of all arguments delivered in the debate.      |
| `args[].stance`| `string`   | Side that delivered the argument (`"pro"` / `"con"`). |
| `args[].text`  | `string`   | The argument text.                                  |
| `args[].turn`  | `number`   | Turn number (1-indexed).                            |
| `args[].at`    | `number`   | Epoch milliseconds timestamp of the argument.       |
| `tally`        | `object`   | Live vote tally read back from the SQL ledger.      |
| `tally.pro`    | `number`   | Number of votes for the pro side.                   |
| `tally.con`    | `number`   | Number of votes for the con side.                   |
| `tally.total`  | `number`   | Total votes recorded.                               |
| `winner`       | `string`   | `"pro"`, `"con"`, or `"tie"` once finalized; `""` before. |
| `startedAt`    | `number`   | Epoch milliseconds timestamp of session creation.   |
| `endedAt`      | `number`   | Epoch milliseconds of debate end; `0` before.       |

#### Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 200  | Debate state retrieved successfully. |
| 404  | Debate session not found.            |
| 500  | Internal server error.               |

---

## 3. End Debate

Ends an active debate session and computes the winner based on accumulated audience votes.

### `POST /debate/{debateId}/end`

#### Path Parameters

| Field      | Type     | Required | Description                          |
|------------|----------|----------|--------------------------------------|
| `debateId` | `string` | Yes      | Unique identifier of the debate.     |

#### Example Request

```bash
curl -X POST https://<edge-function-url>/debate/debate_1234567890/end
```

#### Response Schema

**Status Code: `200`**

```json
{
  "debateId": "debate_m9x2k1-4f8a",
  "topic": "AI should be regulated",
  "status": "ended",
  "winner": "con",
  "finalVotes": {
    "pro": 42,
    "con": 38
  },
  "totalArguments": 10,
  "endedAt": 1705313100000
}
```

| Field            | Type     | Description                                         |
|------------------|----------|-----------------------------------------------------|
| `debateId`       | `string` | Unique identifier for the debate session.           |
| `topic`          | `string` | The debate topic.                                   |
| `status`         | `string` | Always `"ended"` for this response.                 |
| `winner`         | `string` | `"pro"` or `"con"` by majority; `"tie"` when equal. |
| `finalVotes`     | `object` | Final vote tally from the SQL ledger.               |
| `finalVotes.pro` | `number` | Final votes for the pro side.                       |
| `finalVotes.con` | `number` | Final votes for the con side.                       |
| `totalArguments` | `number` | Total number of arguments delivered during the debate. |
| `endedAt`        | `number` | Epoch milliseconds timestamp of debate end.         |

#### Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 200  | Debate ended successfully.           |
| 400  | Debate already ended, or not accepting votes yet. |
| 404  | Debate session not found.            |
| 500  | Internal server error.               |

---

## 4. Cast or Change a Vote

Records one audience vote per `voterId` in the debate room's embedded SQL ledger. A repeat call from the same `voterId` replaces the earlier vote.

### `POST /debate/{debateId}/vote`

#### Path Parameters

| Field      | Type     | Required | Description                          |
|------------|----------|----------|--------------------------------------|
| `debateId` | `string` | Yes      | Unique identifier of the debate.     |

#### Request Body

| Field      | Type     | Required | Description                                      |
|------------|----------|----------|--------------------------------------------------|
| `voterId`  | `string` | No       | Audience member identifier. Defaults to a generated `audience-*` id. |
| `choice`   | `string` | Yes      | Which side to vote for (`"pro"` or `"con"`).     |

#### Example Request

```bash
curl -X POST https://<edge-function-url>/debate/debate_m9x2k1-4f8a/vote \
  -H "Content-Type: application/json" \
  -d '{"voterId": "audience-1", "choice": "pro"}'
```

#### Response Schema

**Status Code: `200`**

Returns the full debate state (same shape as `GET /debate/{debateId}`) with the refreshed tally.

#### Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 200  | Vote recorded successfully.          |
| 400  | Voting not open, invalid choice, or debate already ended. |
| 404  | Debate session not found.            |
| 500  | Internal server error.               |

---

## WebSocket Endpoint

### `GET /agents/room/{debateId}`

The built-in agent socket connection surface, mounted at `/agents/room/{debateId}`. Anonymous connections are read-only watchers: the debate room sends a state snapshot on connect and an incremental state patch on every `setState`, so arguments, the live tally, and the phase stream to every connected client in real time.

#### Connection URL

```
wss://<edge-function-url>/agents/room/{debateId}
```

The same address also serves Server-Sent Events (`GET` with `?subscribe=state`) and one-shot RPC (`POST` to `…/rpc/<method>`).

#### WebSocket Messages (Server → Client)

**State snapshot (on connect)**

```json
{
  "json": { "kind": "state", "snapshot": { "debateId": "debate_m9x2k1-4f8a", "phase": "voting", "args": [], "tally": { "pro": 0, "con": 0, "total": 0 } } }
}
```

**State patch (on every `setState`)**

```json
{
  "json": { "kind": "state", "patch": { "args": [{ "stance": "pro", "text": "Regulation ensures responsible AI development...", "turn": 1, "at": 1705312805000 }] } }
}
```

Patches are RFC 7396 merge-patches; the client merges them onto the latest snapshot (the bundled dashboard shows the exact merge logic).

**Progress events** (`debate.started`, `argument.delivered`, `voting.opened`, `vote.recorded`, `debate.ended`) are also pushed to attached clients subscribed to the `events` stream.

#### WebSocket Messages (Client → Server)

Anonymous connections are read-only (`read` claim). To cast votes over the socket, connect with a token (any non-empty token in the demo — it grants the `rpc` claim) via `?token=…` or an `attach` frame, then send a `call` frame to the `@rpc()`-decorated `vote` method:

```json
{
  "kind": "call",
  "id": "vote-1",
  "method": "vote",
  "args": [{ "voterId": "audience-1", "choice": "pro" }]
}
```

The room answers with a `result` frame containing the updated state. `POST /debate/{debateId}/vote` is the token-free alternative and is what the bundled dashboard uses.

#### WebSocket Status Codes

| Code | Meaning                              |
|------|--------------------------------------|
| 1000 | Normal closure.                      |
| 4004 | Debate session not found.            |
| 4009 | Invalid call payload.                |
| 4401 | Unauthorized (rpc claim required).   |

---

## Error Response Schema

All HTTP error responses follow a consistent JSON shape:

```json
{
  "error": {
    "code": "string",
    "message": "A generic error message."
  }
}
```

| Field           | Type     | Description                                      |
|-----------------|----------|--------------------------------------------------|
| `error.code`    | `string` | Machine-readable error code.                     |
| `error.message` | `string` | Human-readable error message (no sensitive data).|

### Common Error Codes

| Code               | HTTP Status | Description                                      |
|--------------------|-------------|--------------------------------------------------|
| `invalid_request`  | 400         | Request body or parameters are invalid.          |
| `not_found`        | 404         | Requested resource (debate session) not found.   |
| `conflict`         | 409         | Operation conflicts with current state.          |
| `internal_error`   | 500         | Unexpected server-side error.                    |
