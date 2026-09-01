---
name: agent-message-replay
title: "Agent Message Replay — WebSocket Live Streaming Replays on Telnyx Edge"
description: "Replay recorded agent conversations with WebSocket live streaming: messages stream through the durable MessageLog, original state changes re-enact as live state patches, and an optional LLM annotates each step."
language: nodejs
---

# Agent Message Replay on Telnyx Edge

Replay recorded agent conversations as live streams — scrub through message history, watch agent state changes re-enact in real time, and let an LLM annotate the conversation as it plays.

## Why Telnyx

A conversation transcript is not a replay. To "replay" an agent conversation usefully you need the durable message log, the agent's state at every step, and a live transport that pushes both the moment they happen. Telnyx's **AI Communications Infrastructure** gives you all three on Edge Compute: the Agent SDK's `MessageLog` keeps conversation history durable and queryable (`toOpenAI()` / `toLangChain()`), stateful actors persist per-conversation state across restarts, and `AgentSocketServer` streams state patches, message appends, and events to every connected client over one WebSocket. Inference rides the same pre-authenticated Edge binding — commentary on the replay needs zero API keys in your code.

## Telnyx API Endpoints Used

| API | Purpose | Where |
|-----|---------|-------|
| Agent SDK (`@telnyx/edge-runtime`) | `Agent` base class, durable `MessageLog`, `EventLog`, `@rpc()` remote methods | `src/replay-agent.ts` |
| `AgentSocketServer` | WebSocket protocol: state patches, message appends, event stream, RPC claims | `src/replay-agent.ts` |
| Telnyx Inference (`POST /v2/ai/openai/chat/completions` via the `TELNYX` binding) | Optional per-step LLM commentary | `src/replay-agent.ts` |
| Telnyx Edge Compute Stateful Actors | One durable actor per conversation (`env.REPLAY.idFromName`) | `src/index.ts` |

No REST calls are made at runtime: the `TELNYX` Edge binding is pre-authenticated, so the sample ships with zero-credential inference. `TELNYX_API_KEY` is only used by the `telnyx-edge` CLI to deploy.

## Architecture

```
                       ┌────────────────────────────────────────────────┐
                       │            ReplayAgent (durable actor)         │
   POST /ingest        │                                                │
  ┌──────────────────► │  recordings (actor SQLite)  ◄── seed()/ingest  │
  │   store recording  │        │                                       │
  │                    │        ▼ tick() — durable schedule() chain    │
  │                    │  ┌─────────────────────────────────────────┐  │
WebSocket             │  │ 1. messages.add(role, content)          │  │
 /ws?conv=id          │  │    → live append push to all watchers   │  │
  ┌─────────────────► │  │ 2. setState({agentStage})               │  │
  │   upgrade →       │  │    → state patch broadcast (re-enact)   │  │
  │   stub.fetch()    │  │ 3. optional commentary                  │  │
  │                   │  │    → env.TELNYX.ai…createCompletion()   │  │
  │                   │  │    → events.emit("commentary")          │  │
  │                   │  │ 4. schedule(next tick, delay/speed)     │  │
  │                   │  └─────────────────────────────────────────┘  │
  │                   └────────────────────────────────────────────────┘
  │                            │  AgentSocketServer ("desk")
  ▼                            ▼
┌─────────────────────────────────────────────┐
│ Browser demo UI (served at /)               │
│ • attach(token) → claims: read | read+rpc   │
│ • state patches → status/playhead/stage     │
│ • messages appends → chat timeline          │
│ • events → state-change trail + commentary  │
│ • scrubber → walk the streamed history      │
└─────────────────────────────────────────────┘
```

**One conversation = one actor.** `env.REPLAY.idFromName(conversationId)` addresses a durable `ReplayAgent`; its `MessageLog`, state, and recording storage live and restart with it. Playback is a durable `schedule()` chain: pausing is durable by construction (the next tick wakes, sees `paused`, exits), and a tick that half-ran re-runs safely because appends and state patches are idempotent in order.

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `TELNYX_API_KEY` | Used by the `telnyx-edge` CLI to deploy. NOT used by the running sample — inference is via the pre-authenticated binding. | Yes (deploy only) |
| `MODEL` | Inference model ID served by the TELNYX binding (must be a model it serves). | No (defaults to `zai-org/GLM-5.2`) |
| `DEMO_MODE` | `"true"` serves the demo UI at `/`; `"false"` disables it. | No (defaults to `true`) |
| `REPLAY_TOKEN` | Socket credential: WebSocket clients attaching with this token get the `"rpc"` claim (seed/play/pause); everyone else is a read-only watcher. | No (defaults to `replay-demo`) |
| `INGEST_TOKEN` | If set, `POST /ingest` requires `Authorization: Bearer <INGEST_TOKEN>`. | No (unset = open demo endpoint) |

> **Agent / CLI access:** provision and ship the Edge function with the Telnyx CLI:
>
> ```bash
> npm install -g @telnyx/edge-cli
> telnyx-edge login
> telnyx-edge new-func --actor --name=agent-message-replay
> # copy the bindings from telnyx.toml into the generated file, then:
> telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
> telnyx-edge types && npm run ship
> ```
>
> The sample needs no phone numbers or messaging profiles — it is a pure Edge Compute + Agent SDK example. Set `REPLAY_TOKEN` via `telnyx-edge secrets add REPLAY_TOKEN <token>` (or keep the `[env_vars]` default) before exposing the demo publicly.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-message-replay
npm install
```

### 2. Run the local harness (optional)

```bash
npm run local:dev
```

This smoke-tests the recording store round-trip (10-step demo script, stages preserved) without deploying. Playback itself needs the actor runtime — deploy for the full flow.

### 3. Deploy to Telnyx Edge Compute

<details>
<summary>Programmatic / CLI setup</summary>

```bash
npm install -g @telnyx/edge-cli
telnyx-edge login

# Scaffold the function, then copy the [[actors]] / [telnyx] / [env_vars]
# bindings from this sample's telnyx.toml into the generated file.
telnyx-edge new-func --actor --name=agent-message-replay

# Store your API key as an Edge secret (used by the CLI, not the runtime)
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"

# Regenerate Env typings from your real function, then ship
npm run types
npm run ship
```

After shipping, note the printed function URL — the demo UI lives at `/` and the WebSocket at `/ws`.
</details>

### 4. Try it

1. Open `https://<your-function>.telnyxcompute.com/` in a browser.
2. Press **Connect** (auto-connects), then **Load demo**, then **Play**.
3. Watch messages stream in from the `MessageLog`, the stage badge advance through `intake → verifying → investigating → resolving → resolved`, and — with **LLM commentary** checked — annotations appear per agent message.
4. Scrub the timeline to walk back through streamed history; press **LIVE** to return.

## API Reference

See [API.md](API.md) for the typed reference of every route, the WebSocket frame vocabulary, and the `@rpc()` method surface.

## Troubleshooting

**The demo UI says "read-only (bad token?)".** Your socket attached without the `"rpc"` claim. The token field must match `REPLAY_TOKEN` (default `replay-demo`). Check the `[env_vars]` block in `telnyx.toml` and re-ship if you changed it.

**Play returns an error mentioning `seed()`.** The actor has no recording loaded. Press **Load demo** (calls `seed()`), or `POST /ingest` your own recording first.

**Commentary events show `commentary_error`.** The commentary model call failed at runtime — commonly the model in `MODEL` is not served by your binding, or the TELNYX binding is missing from `telnyx.toml`. The replay continues without commentary; fix the model ID and re-ship.

**Messages never stream.** Verify the client attached within the 300 ms grace window (the demo UI sends `attach` immediately on open) and that it subscribes to the `messages` stream. Slow links: raise `attachGraceMs` in `AgentSocketServerOptions`.

**`tsc` errors about the `Env` interface.** `telnyx-env.d.ts` is checked in with placeholder bindings. Run `npm run types` after `telnyx-edge new-func` so the generated file matches your real function.

**I restarted the function mid-replay.** The tick chain is durable: reopen the WebSocket and press **Play** — playback resumes from the persisted `playhead`.

## Related Examples

- [Persistent State Agent on Edge](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — the customer is the durable actor; LangGraph orchestration across SMS, voice, and Salesforce.
- [Multi-turn SMS Quiz Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-turn-sms-quiz-agent/README.md) — `MessageLog.toOpenAI()` + `createCompletion()` in a quiz loop.
- [LangGraph Agent on Edge](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/langgraph-agent-on-edge/README.md) — `MessageLog.toLangChain()` feeding a LangGraph `StateGraph`.

## Resources

- [Telnyx Edge Compute docs](https://developers.telnyx.com/docs/edge-compute/overview) — functions, stateful actors, and the Agent SDK.
- [Telnyx Inference API reference](https://developers.telnyx.com/api-reference/ai- inference/playground/create-chat-completion) — the OpenAI-compatible chat completions endpoint the `TELNYX` binding calls.
- [TypeScript SDK](https://developers.telnyx.com/development/sdk/typescript) — install and auth for the `telnyx` npm package.
- [AI Communications Infrastructure](https://telnyx.com/products/voice-ai-agents) — Telnyx Voice AI product page.
- [Pricing](https://telnyx.com/pricing) — Telnyx pricing.

## Agent Discovery

This example is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: WebSocket live-streaming replay of recorded agent conversations with state-change visualization and optional LLM commentary, on Telnyx Edge Compute.
- **Runtime**: Node.js/TypeScript on Telnyx Edge Compute Stateful Actors (Agent SDK `@telnyx/edge-runtime`).
- **Primary APIs**: Agent SDK (`Agent`, `MessageLog.toOpenAI()/toLangChain()`, `EventLog`, `@rpc()`), `AgentSocketServer` (WebSocket protocol), Telnyx Inference via the pre-authenticated `TELNYX` binding (`ai.openai.chat.createCompletion`).
- **Entry point**: `src/index.ts` — fetch handler serving the demo UI at `/`, `POST /ingest` (store a recording), `GET /health`, and WebSocket upgrades at `/ws?conv=<id>` forwarded to the conversation's actor.
- **Replay actor**: `src/replay-agent.ts` — `ReplayAgent extends Agent<Env, ReplayState>`; durable `schedule()` tick chain streams recorded steps through `this.messages` (live appends), re-enacts recorded stage changes as state patches, and emits commentary/state events.
- **Recording store**: `src/script.ts` — per-actor SQLite (`recordings` table) + zod validation for `POST /ingest`.
- **Demo client**: `src/demo-html.ts` — single-file browser client speaking the agent socket protocol (attach → state/messages/events → call frames) with a history scrubber.
- **RPC surface**: `seed()`, `play()`, `pause()`, `seek(index)`, `setSpeed(n)`, `setCommentary(bool)` — reachable over the socket with the `"rpc"` claim.
- **Socket protocol**: v1 frames (`call`/`ping` → `hello`/`state`/`messages`/`result`/`error`/`pong`) + v2 `attach` sessions (`attached`/`event`), SuperJSON-encoded (`{"json": …, "meta": …}`).
