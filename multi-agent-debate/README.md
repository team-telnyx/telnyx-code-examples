---
name: multi-agent-debate
title: Multi-Agent Debate with Live WebSocket Streaming
description: Two AI agents debate a topic with turn-based arguments, live WebSocket broadcasting, and audience voting tallied in SQL.
language: typescript
framework: edge
telnyx_products: [Telnyx AI, Edge Compute, Telnyx WebSockets]
---

# Multi-Agent Debate with Live WebSocket Streaming

Two AI agents with opposing stances debate a topic in real time. Arguments and vote tallies stream live over WebSocket, the audience votes via WebSocket call frames or HTTP, and votes are persisted to a per-actor SQL ledger.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a unified platform for building AI agents that communicate over voice, SMS, and real-time WebSockets. The Telnyx Agent SDK (`@telnyx/edge-runtime`) gives agents a durable runtime with merge-patch state, an embedded SQL store, durable timers, a built-in WebSocket connection surface, and zero-credential AI inference through the `[telnyx]` binding, so you can focus on the debate logic instead of infrastructure plumbing.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `this.env.TELNYX.ai.openai.chat.createCompletion()` | Telnyx AI | Zero-credential OpenAI chat completion for agent argument generation |
| `Agent` connection surface (`webSocket()` via the `/agents` mount) | Edge Compute (`@telnyx/edge-runtime`) | Streams the state snapshot, incremental merge-patches, and progress events live to connected audience clients |
| `getState()` / `setState()` | Edge Compute (`@telnyx/edge-runtime`) | Merge-patch durable debate state (phase, current turn, arguments, live tally) |
| `this.ctx.storage.sql.exec()` | Edge Compute (`@telnyx/edge-runtime`) | Per-actor embedded SQL vote ledger (one row per audience member, upsert on re-vote) |
| `@rpc()` + `authorize()` | Edge Compute (`@telnyx/edge-runtime`) | Lets WebSocket clients cast votes over a `call` frame while staying read-only otherwise |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Telnyx Edge                          │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │  Agent A     │     │  Agent B     │                      │
│  │  (Pro)       │     │  (Con)       │                      │
│  │              │     │              │                      │
│  │ DebateAgent  │     │ DebateAgent  │                      │
│  │ extends      │     │ extends      │                      │
│  │ Agent        │     │ Agent        │                      │
│  └──────┬───────┘     └──────┬───────┘                      │
│         │                    │                              │
│         │ createCompletion() │                              │
│         ▼                    ▼                              │
│  ┌──────────────────────────────────────┐                   │
│  │     this.env.TELNYX.ai.openai        │                   │
│  │     .chat.createCompletion()         │                   │
│  └──────────────────────────────────────┘                   │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │   DebateRoom agent state             │                   │
│  │  - phase / currentTurn               │                   │
│  │  - arguments[]                       │                   │
│  │  - live vote tally                   │                   │
│  └──────────┬───────────────────────────┘                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────────────────────┐                   │
│  │  Agent connection surface            │                   │
│  │  (/agents/room/{id} WebSocket)       │                   │
│  │  - Streams state patches + events    │                   │
│  │  - Receives @rpc() vote calls        │                   │
│  └──────────┬───────────────────────────┘                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────────────────────┐                   │
│  │     Embedded SQL (ctx.storage.sql)   │                   │
│  │  - Vote ledger (one row per voter)   │                   │
│  └──────────────────────────────────────┘                   │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │     Audience (WebSocket Client)      │                   │
│  │  - Watches live debate               │                   │
│  │  - Votes via call frame or HTTP      │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. `POST /debate` — creates a `DebateRoom` actor for a new debate id and runs both debaters
2. The room composes the pro argument through its `DebateAgent` actor via `env.TELNYX.ai.openai.chat.createCompletion()`, then the con rebuttal the same way
3. Every `setState()` patch streams live to WebSocket clients on `/agents/room/{id}` — arguments, phase, and tally
4. Audience members vote via a WebSocket `call` frame to the `@rpc()` vote method, or via `POST /debate/{id}/vote`
5. Votes are upserted into the room's embedded SQL ledger; the tally is read back into agent state and streams live
6. `POST /debate/{id}/end` finalizes the winner from the SQL tally and broadcasts it in state

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key — used by the `telnyx-edge` CLI to authenticate; the `[telnyx]` binding provides zero-credential inference to the actors | [Telnyx Dashboard → API Keys](https://portal.telnyx.com/#/app/api-keys) |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Inference model used by the debaters in live mode | Telnyx AI Inference model catalog |
| `DEMO_MODE` | `string` | `true` | no | `false` switches the debaters to live inference; any other value keeps canned demo arguments | Set in `telnyx.toml` `[env_vars]` or `telnyx-edge secrets add DEMO_MODE false` |
| `DEMO_BASE_URL` | `string` | `http://localhost:8787` | no | Base URL of a live edge stack for manual testing (`npm start`) | Local edge stack or your deployed function URL |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-agent-debate

# Install dependencies
npm install

# Build (typecheck + tsc -b)
npm run build

# Run the edge app locally (boots the local actor stack via telnyx-edge dev;
# requires Docker and the Edge Compute CLI)
npm start

# Run the smoke test (self-contained — in-process actor host, no edge runtime needed)
npm run smoke

# Optionally, run the live edge stack (boots the local actor stack via telnyx-edge
# dev; requires Docker and the Edge Compute CLI) and exercise the debate via the
# dashboard and API:
npm start
```

The app starts on `http://localhost:8787` by default.

## API Reference

See [`API.md`](./API.md) for the full typed endpoint reference.

### Quick Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/debate` | Start a new debate with a given topic |
| `GET` | `/debate/{id}` | Get current debate state |
| `POST` | `/debate/{id}/vote` | Cast or change an audience vote |
| `POST` | `/debate/{id}/end` | End the debate and declare the winner from the SQL tally |
| `WS` | `/agents/room/{id}` | Live WebSocket stream of debate state + events (also supports SSE and RPC POST) |

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `argument generation failed` | Inference binding unavailable | Ensure the `[telnyx]` binding is declared in `telnyx.toml` and the Edge CLI is authenticated |
| WebSocket connection refused | Local stack not running | Run `npm start` (needs Docker + `telnyx-edge`) and check port 8787 |
| Vote not persisted | SQL ledger not initialized | Check edge runtime logs for SQL errors; the ledger is created on debate start |
| Agent returns empty argument | Model returned no content | Increase `max_tokens` in `createCompletion()` or try a different `AI_MODEL` |
| `TELNYX_API_KEY` not found | CLI not authenticated | Run `telnyx-edge auth` (or `telnyx-edge secrets add TELNYX_API_KEY …`) before deploying |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent for production use
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Official agent SDK and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for LLM agents

## Related Examples

- [conference-agent-mediator](../conference-agent-mediator/) — multi-participant turn-taking with the same agent socket streaming surface.
- [ai-powered-call-router](../ai-powered-call-router/) — actor stub RPC and zero-credential inference from a voice webhook.
- [network-incident-agent](../network-incident-agent/) — agent state, embedded SQL, durable timers, and a live demo dashboard.

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx AI Product Page](https://telnyx.com/ai-assistants)
- [Telnyx Pricing](https://telnyx.com/pricing)
