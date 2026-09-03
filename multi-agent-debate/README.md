---
name: multi-agent-debate
title: Multi-Agent Debate with Live WebSocket Streaming
description: Two AI agents debate a topic with turn-based arguments, live WebSocket broadcasting, and audience voting tallied in SQL.
language: typescript
framework: edge
telnyx_products: [Telnyx AI, Telnyx Edge SDK, Telnyx WebSockets]
---

# Multi-Agent Debate with Live WebSocket Streaming

Two AI agents with opposing stances debate a topic in real time. Arguments stream live over WebSocket, and the audience votes on the winner via WebSocket, with vote tallies persisted to SQL.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a unified platform for building AI agents that communicate over voice, SMS, and real-time WebSockets. The Telnyx Edge SDK gives agents a runtime environment with built-in state management, WebSocket streaming, and zero-credential AI inference binding, so you can focus on the debate logic instead of infrastructure plumbing.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `this.env.TELNYX.ai.openai.chat.createCompletion()` | Telnyx AI | Zero-credential OpenAI chat completion for agent argument generation |
| `AgentSocketServer` | Telnyx Edge SDK | Live WebSocket broadcasting of debate turns and audience votes |
| `StateStore` | Telnyx Edge SDK | Turn-based debate state (current turn, arguments, vote counts) |
| `SQL DB` | Telnyx Edge SDK | Persistent vote tally storage |

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
│  │         StateStore                   │                   │
│  │  - currentTurn                       │                   │
│  │  - arguments[]                       │                   │
│  │  - votes                             │                   │
│  └──────────┬───────────────────────────┘                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────────────────────┐                   │
│  │     AgentSocketServer                │                   │
│  │  - Broadcasts debate turns           │                   │
│  │  - Receives audience votes           │                   │
│  └──────────┬───────────────────────────┘                   │
│             │                                               │
│             ▼                                               │
│  ┌──────────────────────────────────────┐                   │
│  │     SQL DB                           │                   │
│  │  - Vote tally                        │                   │
│  └──────────────────────────────────────┘                   │
│                                                             │
│  ┌──────────────────────────────────────┐                   │
│  │     Audience (WebSocket Client)      │                   │
│  │  - Watches live debate               │                   │
│  │  - Votes via WebSocket               │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. `POST /debate/start` — initializes debate state and launches Agent A
2. Agent A generates a pro argument via `createCompletion()`, broadcasts over WebSocket
3. StateStore advances turn → Agent B generates a con argument, broadcasts
4. Audience members vote via WebSocket (`vote` event)
5. Votes are tallied in SQL DB
6. After N rounds, winner is determined and broadcast

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-agent-debate

# Create .env file
cp .env.example .env
# Edit .env and add your Telnyx API key
echo "TELNYX_API_KEY=your_telnyx_api_key_here" > .env

# Install dependencies
npm install

# Run the edge app locally
npm run dev

# Run smoke test
npm run smoke-test
```

The app starts on `http://localhost:8787` by default.

## API Reference

See [`API.md`](./API.md) for the full typed endpoint reference.

### Quick Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/debate/start` | Start a new debate with a given topic |
| `GET` | `/debate/:id` | Get current debate state |
| `GET` | `/debate/:id/winner` | Get the winning agent |
| `WS` | `/debate/:id/stream` | Live WebSocket stream of debate + voting |

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `createCompletion is not a function` | Wrong binding path | Ensure you're using `this.env.TELNYX.ai.openai.chat.createCompletion()` |
| WebSocket connection refused | Server not running | Run `npm run dev` and check port 8787 |
| Vote not persisted | SQL DB not initialized | Check edge runtime logs for SQL errors |
| Agent returns empty argument | Prompt too short | Increase `max_tokens` in the completion request |
| `TELNYX_API_KEY` not found | `.env` missing | Copy `.env.example` to `.env` and set your key |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your agent for production use
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Official agent SDK and examples
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for LLM agents

## Related Examples

- [voice-agent](./voice-agent) — Voice-based AI agent using Telnyx Call Control
- [sms-agent](./sms-agent) — SMS-based AI agent with conversation state
- [websocket-chat](./websocket-chat) — Multi-user WebSocket chat with Telnyx Edge

## Resources

- [Telnyx Developer Docs](https://docs.telnyx.com) — Official documentation
- [Telnyx API Reference](https://developers.telnyx.com) — API endpoint reference
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk) — TypeScript SDK for edge agents
- [Telnyx AI Product Page](https://telnyx.com/ai) — AI agent platform overview
- [Telnyx Pricing](https://telnyx.com/pricing) — Pricing details for all Telnyx products
