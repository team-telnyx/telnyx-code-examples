# API Reference — langchain-streaming-agent

Typed reference for every surface this sample exposes: the WebSocket agent
protocol, its RPC methods and event streams, the REST helper, and the LangChain
tool set.

## WebSocket Endpoint

**`GET /websocket?session=<session_id>`** (WebSocket upgrade)

The worker routes the upgrade to the session's `StreamingAgent`
(`env.AGENTS.idFromName(sessionId)`). The agent's built-in connection surface
speaks the agent-client protocol:

- **attach** — the client presents a token; `StreamingAgent.authorize()` grants
  the `rpc` claim (any token is accepted in this demo — verify tokens in
  production).
- **state stream** — merge-patch updates on every durable state change
  (`status`, `turn`, `answeredThrough`, `toolsUsed`).
- **messages stream** — snapshot on connect, live appends for committed turns.
- **events stream** — the durable streaming log (tokens + tool activity), with
  cursor-based replay on reconnect (`resume: true`).

Client: `AgentClient` from `@telnyx/edge-runtime/client`.

```js
const client = new AgentClient(`wss://host/websocket?session=demo`, {
  token: "demo",
  subscribe: ["state", "messages", "events"],
  resume: true,
});
```

## RPC Surface

Callable via `client.stub.<method>(...)` over `call` frames. Requires the
`rpc` claim.

### `send(text: string): Promise<{ turn: number }>`

Appends a user turn to the durable message log, sets `status: "thinking"`, and
queues the agent loop as a durable task. Returns the turn number immediately —
results arrive via the streams, not the RPC response.

### `transcript(): Promise<{ messages: Array<{ role: string; content: string }> }>`

Full conversation history from the agent's message log
(`this.messages.toLangChain()`).

### `currentState(): Promise<AgentState>`

The durable state:

```ts
interface AgentState {
  status: "idle" | "thinking";
  turn: number;            // increments on every user message
  answeredThrough: number; // message seq of the last answered user turn
  toolsUsed: number;       // lifetime tool invocations
}
```

## Event Stream

Each `onEvents` callback receives `{ seq, type, payload, at }`. Events are
committed to the agent's durable event log **before** being pushed, so a
reconnecting client replays exactly what it missed from its cursor.

| Event type | Payload | Emitted when |
|------------|---------|--------------|
| `token` | `{ turn: number, text: string }` | One answer-text SSE delta from Telnyx Inference (`stream: true`) |
| `tool_start` | `{ turn: number, tool: string, input: unknown }` | The model requested a tool; the executor is running it |
| `tool_result` | `{ turn: number, tool: string, output: string }` | Tool output, about to be fed back to the model |

## REST Endpoints

### POST `/api/agents`

Create-or-get a session actor.

**Request body:**

```json
{ "session": "demo" }
```

**Response:** `201 Created`

```json
{ "session": "demo", "state": { "status": "idle", "turn": 0, "answeredThrough": 0, "toolsUsed": 0 } }
```

### GET `/`

Serves the demo chat UI.

### Fallback

Any other path/method returns `404` with `{ "error": "Not found" }`.

## Tools

LangChain tools (zod schemas, executed by the agent loop):

### `lookup_order`

- **Args**: `{ order_id: string }` — e.g. `"ORD-1042"`
- **Returns**: shipping status, ETA, carrier, and items for the seeded orders
  (`ORD-1042`, `ORD-1043`, `ORD-1051`), or a not-found hint.

### `get_return_policy`

- **Args**: `{ topic: "returns" | "warranty" | "shipping" | "damaged" }`
- **Returns**: the policy text for the requested section.

## Inference

`TelnyxStreamingChatModel` (a LangChain `BaseChatModel`) calls the zero-credential
binding:

```ts
env.TELNYX.ai.openai.chat.createCompletion({
  model,           // AI_MODEL env var (default zai-org/GLM-5.2)
  messages,        // wire messages incl. tool_calls / tool_call_id
  stream: true,    // raw data-only SSE, parsed in src/sse.ts
  tools,           // OpenAI function schema (set via bindTools)
  tool_choice: "auto",
});
```

Reasoning-model deltas (`delta.reasoning_content`) are ignored; only committed
answer tokens stream.
