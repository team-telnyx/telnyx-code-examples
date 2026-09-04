---
name: langchain-streaming-agent
title: "LangChain Streaming Agent"
description: "A LangChain tool-calling agent on Telnyx Edge Compute that streams every token, tool call, and result over WebSocket — powered by the zero-credential Telnyx Inference binding."
language: nodejs
framework: edge
telnyx_products: [Edge Compute, AI Inference, LangChain, WebSocket]
---

# LangChain Streaming Agent

A LangChain tool-calling agent on Telnyx Edge Compute that streams every token, tool call, and tool result to the browser in real time — with zero-credential inference through the Telnyx API binding and a durable, crash-safe agent loop.

## Why Telnyx

This sample demonstrates Telnyx's **AI Communications Infrastructure** — the same platform edge that keeps your communications stateful also runs your agent backend and your AI. One `StreamingAgent extends Agent` per conversation holds the durable message history and a cursor-replayable event log, the built-in agent socket layer pushes every committed change to connected clients, and the LangChain agent calls Telnyx Inference through a pre-authenticated binding (`this.env.TELNYX`) — no API keys stored, rotated, or leaked anywhere in the deployed function. It is the stateful-isolation model of Cloudflare Durable Objects, composed with LangChain and zero-credential AI inference.

## Telnyx API Endpoints Used

- **AI Inference (binding)**: `this.env.TELNYX.ai.openai.chat.createCompletion({ model, messages, stream: true, tools })` — OpenAI-compatible chat completions with streaming and tool calling through the pre-authenticated `TELNYX` binding; [API reference](https://developers.telnyx.com/api/inference/chat-completions)

The WebSocket layer (`/websocket`) and the demo UI are served by this sample's worker; the agent's inference calls run inside the actor through the binding, so no credential ever crosses the network boundary you control.

## Architecture

```
┌──────────────┐
│ Browser      │  AgentClient (attach mode: state + messages + events)
│ chat UI      │  stub.send(text) → RPC
└──────┬───────┘
       │  WebSocket /websocket?session=<id>
       ▼
┌────────────────────────────────────────────┐
│ Edge worker (src/index.ts)                 │
│ routes upgrades + REST to the AGENTS       │
│ actor namespace                            │
└───────────────────┬────────────────────────┘
                    │  env.AGENTS.idFromName(sessionId)
                    ▼
┌────────────────────────────────────────────┐
│ StreamingAgent extends Agent               │
│ - messages (durable history)               │
│ - events (durable, cursor-replayable log)  │
│ - setState (merge-patch, broadcast)        │
│ - queue("run") → crash-safe agent task     │
└───────────────────┬────────────────────────┘
                    │  run(): this.messages.toLangChain()
                    ▼
┌────────────────────────────────────────────┐
│ LangChain agent (AgentExecutor)            │
│ createToolCallingAgent + 2 tools           │
│ LLM = TelnyxStreamingChatModel             │
│   → env.TELNYX.ai.openai.chat.             │
│      createCompletion({ stream: true })    │
│   → SSE deltas → AIMessageChunks           │
└───────────────────┬────────────────────────┘
                    │  onToken(delta) → events.emit("token")
                    ▼
┌────────────────────────────────────────────┐
│ Durable event log                          │
│ token / tool_start / tool_result events    │
│ pushed live to watchers; replayed from     │
│ cursor on reconnect                        │
└────────────────────────────────────────────┘
```

**Flow:**
1. A browser `AgentClient` attaches to `/websocket?session=<id>` with a token; the worker routes the upgrade to the session's `StreamingAgent`, whose `authorize()` grants the `rpc` claim.
2. Sending a message calls `client.stub.send(text)` — a typed RPC over the socket. The actor appends the user turn to the durable message log, flips state to `thinking`, and queues the agent loop as a task.
3. `run()` loads history via `this.messages.toLangChain()`, builds a LangChain `createToolCallingAgent` over `TelnyxStreamingChatModel`, and executes it with `AgentExecutor.streamEvents`.
4. The model calls Telnyx Inference with `stream: true`; every answer-text SSE delta fires the model's `onToken` hook, which commits a `token` event to the durable event log — pushed live to the browser and replayable after a reconnect.
5. When the model requests a tool, the executor runs it (`lookup_order`, `get_return_policy`) and the loop continues; `tool_start` / `tool_result` events keep the UI informed.
6. The final round's text is committed as the assistant turn in the message log; state returns to `idle`. If the isolate dies mid-turn, the queued task re-dispatches and the turn is reprocessed.

## Environment Variables

Set via `[env_vars]` in `telnyx.toml` (deployed) or `.env` (local dev):

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AI_MODEL` | `string` | `zai-org/GLM-5.2` | no | Telnyx Inference model name — must support tool calling | [Model catalog](https://developers.telnyx.com/docs/inference/models) |
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | local dev only | Telnyx API v2 key — **not needed deployed** (the `TELNYX` binding is pre-authenticated); only `scripts/local-dev.ts` uses it | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx-edge new-func --actor --name=langchain-streaming-agent
> telnyx-edge types
> telnyx-edge ship
> ```

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/langchain-streaming-agent
   ```

   <details><summary>Programmatic / CLI setup</summary>

   ```bash
   # Authenticate the Telnyx Edge CLI (stores your API key)
   telnyx-edge auth

   # Scaffold a new actor-backed edge function, then copy this folder's
   # telnyx.toml bindings into the generated config to assign func_id
   telnyx-edge new-func --actor --name=langchain-streaming-agent

   # Regenerate typed bindings after changing telnyx.toml
   telnyx-edge types
   ```

   </details>

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment (local dev only)**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your Telnyx API key (used by the local harness for real streaming inference; deployed functions use the zero-credential `TELNYX` binding instead):

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   AI_MODEL=zai-org/GLM-5.2
   PORT=8787
   ```

4. **Run locally**

   ```bash
   npm run local:dev
   ```

   Open `http://localhost:8787/?session=demo` and ask about order `ORD-1042` (or click a suggested prompt). Tokens stream into the live pane, the `lookup_order` tool call shows as a chip, and the committed conversation renders above.

5. **Deploy to Telnyx Edge**

   ```bash
   npm run types   # regenerate typed bindings (telnyx-edge types)
   npm run ship    # deploy (telnyx-edge ship)
   ```

   Then open `https://<your-function>.telnyxcompute.com/?session=demo`. Deployed functions need **no API key** — inference runs through the pre-authenticated `TELNYX` binding.

## API Reference

### WebSocket Endpoint

**`GET /websocket?session=<session_id>`** (WebSocket upgrade)

The worker routes the upgrade to the session's `StreamingAgent`; the agent's built-in connection surface speaks the agent-client protocol: state / messages / events streams with cursor-based resume, and `call` frames dispatching to `@rpc()` methods.

The browser uses `AgentClient` from `@telnyx/edge-runtime/client`:

```js
import { AgentClient } from "@telnyx/edge-runtime/client";

const client = new AgentClient(`wss://host/websocket?session=demo`, {
  token: "demo",
  subscribe: ["state", "messages", "events"],
  resume: true,
});
client.onState((state) => render(state));
client.onEvents((event) => stream(event));       // token / tool_start / tool_result
await client.stub.send("Where is my order ORD-1042?");  // typed RPC
```

**Actor RPC surface (via `client.stub.*`):**

| Method | Signature | Description |
|--------|-----------|-------------|
| `send` | `(text)` | Append a user message and run the streaming agent loop |
| `transcript` | `()` | Full message history as `{ role, content }` turns |
| `currentState` | `()` | Durable agent state (`status`, `turn`, `toolsUsed`) |

**Client listeners:**

- `client.onState((state) => ...)` — `{ status: "idle" \| "thinking", turn, answeredThrough, toolsUsed }` on every durable change.
- `client.onMessages(({ snapshot, appended }) => ...)` — the committed conversation; `appended` delivers new turns live.
- `client.onEvents((event) => ...)` — the streaming layer. Event types:

| Event type | Payload | Meaning |
|------------|---------|---------|
| `token` | `{ turn, text }` | One streamed answer delta from Telnyx Inference |
| `tool_start` | `{ turn, tool, input }` | The model requested a tool; it is executing |
| `tool_result` | `{ turn, tool, output }` | Tool output (fed back to the model) |

Events are durable: on reconnect with `resume: true`, the server replays exactly what was missed from the client's cursor — no duplicates, no gaps.

### REST Endpoints

#### POST `/api/agents`

Create-or-get a session.

**Request body:** `{ "session": "demo" }`
**Response:** `201 Created` → `{ "session": "...", "state": {...} }`

### Tools

| Tool | Arguments | Description |
|------|-----------|-------------|
| `lookup_order` | `{ order_id }` | Shipping status, ETA, carrier, and items for `ORD-1042` / `ORD-1043` / `ORD-1051` |
| `get_return_policy` | `{ topic }` | Policy text for `returns`, `warranty`, `shipping`, or `damaged` |

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No tokens stream locally | `TELNYX_API_KEY` missing from `.env` | Set the key for local dev; deployed functions do not need it |
| `model does not support tools` / malformed tool calls | Model lacks function calling | Set `AI_MODEL` to a tool-calling model (e.g. `zai-org/GLM-5.2`) |
| Agent reply missing from history | The final round returned no text | Check the event log for `tool_start` without a later answer; retry the turn |
| `local:dev` fails on decorator syntax | Runner cannot lower the SDK's standard `@rpc()` decorator | This sample bundles with esbuild (`--target=es2022`); do not switch to `vite-node` |
| WebSocket connects but no updates | Stale SDK client | Keep `@telnyx/edge-runtime` and the `esm.sh` client import on matching versions |
| State resets on restart (local) | In-memory storage in the local harness | Expected — durable storage is on the platform |

## Agent Discovery

This sample is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: A LangChain tool-calling agent whose every token, tool call, and tool result streams to clients over WebSocket, with durable history and crash-safe runs.
- **Runtime**: TypeScript on Telnyx Edge Compute. One `StreamingAgent extends Agent<Env, AgentState>` per session id — durable messages, a cursor-replayable event log, and task-based agent loops (the Durable Objects isolation model).
- **Primary APIs**: Telnyx Inference via the pre-authenticated `TELNYX` binding (`ai.openai.chat.createCompletion` with `stream: true` and `tools`), the Agent SDK connection surface (built-in WebSocket protocol + browser `AgentClient`), LangChain (`createToolCallingAgent`, `AgentExecutor`, custom `BaseChatModel`).
- **Entry point**: `src/index.ts` — worker fetch handler routing `GET /`, `/api/agents`, and WebSocket upgrades to the `AGENTS` actor namespace.
- **Agent**: `src/streaming-agent.ts` — `send` RPC, `run` task that drains every pending user turn in order (LangChain agent streaming, token/tool event emission), crash-recovery via the `answeredThrough` high-water mark.
- **Model**: `src/telnyx-chat-model.ts` — `TelnyxStreamingChatModel extends BaseChatModel` with `_streamResponseChunks`, streamed `tool_call_chunks`, `bindTools`, and wire mapping that round-trips `tool_call_id` / `tool_calls`.
- **Zero-credential**: deployed functions hold no API key — inference is authenticated by the platform binding; only `scripts/local-dev.ts` reads `TELNYX_API_KEY`.

## Related Examples

- [LangGraph Agent on Edge](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/langgraph-agent-on-edge/README.md) — LangGraph StateGraph inside the same Agent SDK with zero-credential inference
- [Collaborative Document with AI Copilot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/collaborative-doc-ai-copilot/README.md) — Agent SDK WebSocket multiplayer with a state-triggered copilot
- [Agent with Tool Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-with-tool-calling/README.md) — Tool-calling conversations against Telnyx Inference
- [Run LLM Inference (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-nodejs/README.md) — Minimal Telnyx Inference chat completions walkthrough

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) — functions, actors, and bindings
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api) — the pre-authenticated `TELNYX` client in your functions
- [Inference API reference](https://developers.telnyx.com/api/inference/chat-completions) — chat completions request/response schema, `stream`, and `tools`
- [Inference model catalog](https://developers.telnyx.com/docs/inference/models) — available `AI_MODEL` values
- [Telnyx pricing](https://telnyx.com/pricing) — inference and product pricing
