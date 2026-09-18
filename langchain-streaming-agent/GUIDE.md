# Guide — LangChain Streaming Agent on Telnyx Edge

This guide walks through what the sample does, how the streaming pipeline is
wired, and how to run and extend it. For the typed surface, see
[API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/langchain-streaming-agent/API.md).

## What you get

A chat agent with real-time streaming over WebSocket:

- **Every token streams as it is generated** — the browser renders text deltas
  from Telnyx Inference the moment each SSE chunk arrives.
- **Tool calls are visible** — when the model calls `lookup_order` or
  `get_return_policy`, the UI shows a chip with the arguments and the result.
- **The conversation is durable** — history and the event log survive restarts;
  a reconnecting browser resumes from its cursor with no duplicates.
- **Runs are crash-safe** — the agent loop is a durable task; if the isolate
  dies mid-turn, the runtime re-dispatches it.

All inference runs through the zero-credential Telnyx binding: the deployed
function holds no API key.

## The pieces

| File | Role |
|------|------|
| `src/streaming-agent.ts` | `StreamingAgent extends Agent` — durable history, event log, crash-safe `run()` task, `send` RPC |
| `src/telnyx-chat-model.ts` | `TelnyxStreamingChatModel extends BaseChatModel` — LangChain model over the Telnyx binding with `stream: true` |
| `src/sse.ts` | Parses the raw data-only SSE body the binding returns |
| `src/tools.ts` | The two LangChain tools (`lookup_order`, `get_return_policy`) |
| `src/index.ts` | Edge worker: demo page, REST, WebSocket routing |
| `src/demo-html.ts` | Browser chat UI using `AgentClient` |
| `scripts/local-dev.ts` | Local harness: runs the real worker + actor in Node with your API key |

## How the streaming works

1. **A user message arrives** via `stub.send(text)` (RPC over WebSocket). The
   agent appends it to `this.messages`, sets `status: "thinking"`, and calls
   `this.queue("run")` — the loop runs as a durable task, not on the RPC stack.

2. **The loop loads history** with `this.messages.toLangChain()` and maps it to
   LangChain messages. The last user turn becomes the executor's `input`; the
   rest becomes `chat_history`.

3. **The LangChain agent runs** — `createToolCallingAgent` over
   `TelnyxStreamingChatModel`, executed with `AgentExecutor.streamEvents`.
   `streamEvents` supplies the round boundaries (`on_chat_model_start`) and the
   tool events (`on_tool_start` / `on_tool_end`).

4. **The model streams**. `TelnyxStreamingChatModel._streamResponseChunks`
   calls the binding with `stream: true`, parses the SSE body, yields
   `AIMessageChunk`s — and fires `onToken` for every text delta. The agent
   commits each delta to its event log: `this.events.emit("token", { turn,
   text })`. The Agent SDK pushes committed events to every attached client
   immediately.

5. **Tools execute between rounds**. When the model requests a tool, the
   executor runs it and appends the result to the scratchpad; `tool_start` /
   `tool_result` events keep the UI informed. The model's second round sees the
   tool result and streams the final answer.

6. **The answer commits**. The turn's text is appended to `this.messages` and
   `answeredThrough` advances to that turn. If the isolate died mid-turn, the
   task re-dispatches and reprocesses exactly the unanswered turns. Sending
   several messages quickly is safe: each queued run drains the backlog oldest
   first, so every question gets its own answer.

## Run it

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/langchain-streaming-agent
npm install
cp .env.example .env        # add TELNYX_API_KEY (local dev only)
npm run local:dev
```

Open `http://localhost:8787/?session=demo`, click **Where is my order
ORD-1042?**, and watch tokens stream. Open a second browser window on the same
URL to see a second client receive the same live stream.

## Deploy it

```bash
telnyx-edge new-func --actor --name=langchain-streaming-agent
# merge this folder's telnyx.toml bindings (AGENTS actor + TELNYX binding)
npm run types
npm run ship
```

No API key is needed on the platform — the `TELNYX` binding is pre-authenticated.

## Extend it

**Add a tool** — append one to `src/tools.ts` and to `supportTools`:

```ts
export const checkInventory = tool(
  ({ sku }: { sku: string }) => `${sku}: 42 in stock`,
  {
    name: "check_inventory",
    description: "Check warehouse stock for a SKU",
    schema: z.object({ sku: z.string().describe("SKU, e.g. HS-100") }),
  },
);
```

The agent picks it up automatically — it is in the `tools` array passed to
`createToolCallingAgent`, and its calls stream as `tool_start` / `tool_result`
events like any other.

**Change the model** — set `AI_MODEL` in `.env` (local) or `telnyx.toml`
(deployed) to any Telnyx Inference model that supports function calling.

**Change the tool-call round-trip behavior** — everything lives in
`TelnyxStreamingChatModel.toWireMessage`: assistant turns carry `tool_calls`,
tool turns carry `tool_call_id`. If you add providers or payload shapes, that
is the single place to touch.

## Tests

```bash
npm test        # hermetic suite: model SSE parsing, wire mapping, full agent loop
```

The suite scripts the inference binding (raw SSE bodies), so it runs without
credentials. `test/live-inference.test.ts` runs against the real API when
`TELNYX_API_KEY` and `RUN_LIVE_INFERENCE=1` are both set.
