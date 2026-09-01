# API Reference

Complete endpoint and protocol reference for the collaborative document editor with AI copilot (Telnyx Edge Compute + Agent SDK).

## Base URL

```
https://<your-function>.telnyxcompute.com
```

Locally: `http://localhost:8787`

## HTTP Endpoints

### `GET /`

Serves the collaborative editor page.

**Response:** `200 OK` — HTML

Query parameters:

| Param | Default | Description |
|-------|---------|-------------|
| `doc` | `doc_demo` | Document id (becomes the actor id) |
| `name` | `user_<random>` | Your participant name (presence + edit attribution) |

---

### `POST /api/documents`

Idempotent create — materializes the document actor.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `doc_id` | `string` | No | Custom document id (sanitized to `[a-zA-Z0-9_-]`, max 64 chars) |

**Example request:**

```bash
curl -X POST http://localhost:8787/api/documents \
  -H "Content-Type: application/json" \
  -d '{"doc_id": "doc_team_1"}'
```

**Response:** `201 Created`

```json
{
  "doc_id": "doc_team_1",
  "state": {
    "text": "",
    "cursors": {},
    "suggestions": [],
    "lastSuggestionAt": 0
  }
}
```

---

### `GET /api/documents/<doc_id>`

Fetch the current document state.

**Example request:**

```bash
curl http://localhost:8787/api/documents/doc_team_1
```

**Response:** `200 OK`

```json
{
  "text": "Current document content...",
  "cursors": {
    "alice": {"line": 2, "col": 14}
  },
  "suggestions": [
    {
      "id": "3f9a2b7c-...",
      "originalText": "current text",
      "suggestedText": "improved text",
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "createdAt": 1756000000000
    }
  ],
  "lastSuggestionAt": 1756000000000
}
```

---

### `POST /api/documents/<doc_id>/suggest`

Manually trigger the copilot. Rate-limited per document.

**Example request:**

```bash
curl -X POST http://localhost:8787/api/documents/doc_team_1/suggest
```

**Response:** `200 OK`

```json
{
  "status": "ok"
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| `429 Too Many Requests` | `{"status": "rate_limited"}` | Called within `SUGGESTION_COOLDOWN_SECONDS` of the last suggestion |
| `200` | `{"status": "empty"}` | Document is empty, or the model returned no content |

## WebSocket Endpoint

### `GET /websocket?doc=<doc_id>&name=<name>` (upgrade)

Real-time collaboration channel. The worker routes the upgrade to the document's
`DocActor`; the `AgentSocketServer` speaks the agent-client protocol:

- **On connect:** the actor's current state snapshot, then `hello`
- **On every `setState`:** the new state is pushed to all watchers
- **Client → server:** typed RPC `call` frames and heartbeats

Clients use `AgentClient` from `@telnyx/edge-runtime/client` (browser import:
`https://esm.sh/@telnyx/edge-runtime@0.9.2/client`):

```js
import { AgentClient } from "@telnyx/edge-runtime/client";

const client = new AgentClient(
  `wss://host/websocket?doc=doc_team_1&name=alice`
);
```

The client auto-reconnects (exponential backoff) and sends heartbeats — no
reconnection logic is needed in application code.

### Actor RPC surface

All methods below are invoked as `client.stub.<method>(...args)` — a typed RPC
proxy over the socket. Calls resolve with the actor method's return value
(the current `DocState`).

#### `stub.edit(user, text)`

Replace the full document text. Broadcasts the new state to every participant
and triggers the AI copilot.

```js
await client.stub.edit("alice", "New document text");
```

#### `stub.setCursor(user, position)`

Update a participant's cursor (also their presence marker). Position is
`{ line, col }`, 0-indexed.

```js
await client.stub.setCursor("alice", { line: 0, col: 12 });
```

#### `stub.respondSuggestion(suggestionId, accepted)`

Accept or reject a copilot suggestion. On accept, the document text is replaced
by `suggestedText`; the suggestion is removed either way. Both outcomes
broadcast the new state.

```js
await client.stub.respondSuggestion("3f9a2b7c-...", true);
```

#### `stub.requestSuggestion()`

Manually trigger the copilot. Returns `{ status: "ok" | "rate_limited" | "empty" }`.

#### `stub.snapshot()` / `stub.touch()`

Fetch the full state / idempotent create. Used by the REST wrappers.

### State shape (delivered to `client.onState`)

```json
{
  "text": "Document content...",
  "cursors": {
    "alice": {"line": 0, "col": 12},
    "bob": {"line": 2, "col": 4}
  },
  "suggestions": [
    {
      "id": "3f9a2b7c-...",
      "originalText": "current text",
      "suggestedText": "improved text",
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "createdAt": 1756000000000
    }
  ],
  "lastSuggestionAt": 1756000000000
}
```

`cursors` keys are the live participants; a participant's entry is removed when
their socket closes.

## Environment Variables

Set via `[env_vars]` in `telnyx.toml` (deployed) or `.env` (local dev):

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_MODEL` | No | Inference model name (default: `meta-llama/Llama-3.3-70B-Instruct`) |
| `SUGGESTION_COOLDOWN_SECONDS` | No | Per-document copilot cooldown (default: `5`) |
| `TELNYX_API_KEY` | Local dev only | Telnyx API v2 key for `scripts/local-dev.ts`; deployed functions authenticate through the `TELNYX` binding instead |

See [README.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/collaborative-doc-ai-copilot/README.md) for setup and deployment instructions.
