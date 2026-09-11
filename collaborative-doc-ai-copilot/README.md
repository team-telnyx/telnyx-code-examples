---
name: collaborative-doc-ai-copilot
title: "Collaborative Document with AI Copilot"
description: "Real-time multiplayer document editing on Telnyx Edge Compute with an AI copilot that suggests improvements via the zero-credential Telnyx Inference binding."
language: nodejs
framework: edge
telnyx_products: [Edge Compute, AI Inference, WebSocket]
---

# Collaborative Document with AI Copilot

Liveblocks-style multiplayer document editing on Telnyx Edge Compute, with an AI copilot that watches every state change and proposes edits — zero-credential, via the Telnyx Inference binding.

## Why Telnyx

This sample demonstrates Telnyx's **AI Communications Infrastructure** — the same platform edge that keeps your communications stateful also runs your collaboration backend and your AI. One `DocActor` StatefulActor per document holds the durable state, the built-in agent socket layer fans every change out to all participants, and the copilot calls Telnyx Inference through a pre-authenticated binding (`this.env.TELNYX`) — no API keys stored, rotated, or leaked anywhere in the deployed function. It is the stateful-isolation model of Cloudflare Durable Objects, composed with zero-credential AI inference.

## Telnyx API Endpoints Used

- **AI Inference (binding)**: `this.env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` — OpenAI-compatible chat completions through the pre-authenticated `TELNYX` binding; [API reference](https://developers.telnyx.com/api/inference/chat-completions)

The WebSocket collaboration layer (`/websocket`) and the document REST endpoints are served by this sample's worker; the copilot's inference call runs inside the actor through the binding, so no credential ever crosses the network boundary you control.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  User A     │     │  User B     │     │  User C     │
│ (AgentClient)│    │ (AgentClient)│    │ (AgentClient)│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │   WebSocket /websocket?doc=<id>       │
       └─────────┬─────────┴─────────┬─────────┘
                 ▼                   ▼
        ┌─────────────────────────────────┐
        │   Edge worker (src/index.ts)    │
        │  routes upgrades + REST to the  │
        │  DOCS actor namespace           │
        └────────────────┬────────────────┘
                         │  env.DOCS.idFromName(docId)
                         ▼
        ┌─────────────────────────────────┐
        │   DocActor (StatefulActor)      │
        │  one actor per document id:     │
        │  - text (durable state)         │
        │  - cursors = presence           │
        │  - pending suggestions          │
        │  Built-in connection engine     │
        │  every setState to watchers     │
        └────────────────┬────────────────┘
                         │  onStateChanged (text change)
                         │  → queue("runCopilot")
                         ▼
        ┌─────────────────────────────────┐
        │   Copilot (own actor turn)      │
        │  this.env.TELNYX.ai.openai.     │
        │    chat.createCompletion()      │
        │  (zero-credential binding)      │
        │  → suggestion in state →        │
        │    broadcast → Accept/Reject    │
        └─────────────────────────────────┘
```

**Flow:**
1. A browser `AgentClient` connects to `/websocket?doc=<id>&name=<name>`; the worker routes the upgrade to the document's actor, and the Agent SDK's built-in connection surface sends the state snapshot + `hello`.
2. Typing calls `client.stub.edit(name, text)` — a typed RPC over the socket. The actor `setState`s the new text.
3. `onStateChanged` broadcasts the new state to every watching socket (live sync).
4. On text changes the actor queues `runCopilot` as its own turn — LLM latency never blocks an edit.
5. `runCopilot` calls Telnyx Inference through the `TELNYX` binding (rate-limited per document), stores the suggestion in state, and the broadcast puts a suggestion card in every participant's panel.
6. Any participant Accepts (text replaced everywhere) or Rejects (removed) via `stub.respondSuggestion`.

## Environment Variables

Set via `[env_vars]` in `telnyx.toml` (deployed) or `.env` (local dev):

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Telnyx Inference model name | [Model catalog](https://developers.telnyx.com/docs/inference/models) |
| `SUGGESTION_COOLDOWN_SECONDS` | `string` | `5` | no | Copilot rate limit per document | — |
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | local dev only | Telnyx API v2 key — **not needed deployed** (the `TELNYX` binding is pre-authenticated); only `scripts/local-dev.ts` uses it | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx-edge new-func --actor --name=collaborative-doc-ai-copilot
> telnyx-edge types
> telnyx-edge ship
> ```

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/collaborative-doc-ai-copilot
   ```

   <details><summary>Programmatic / CLI setup</summary>

   ```bash
   # Authenticate the Telnyx Edge CLI (stores your API key)
   telnyx-edge auth

   # Scaffold a new actor-backed edge function, then copy this folder's
   # telnyx.toml bindings into the generated config to assign func_id
   telnyx-edge new-func --actor --name=collaborative-doc-ai-copilot

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

   Edit `.env` and add your Telnyx API key (used by the local harness for real inference calls; deployed functions use the zero-credential `TELNYX` binding instead):

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   AI_MODEL=meta-llama/Llama-3.3-70B-Instruct
   PORT=8787
   ```

4. **Run locally**

   ```bash
   npm run local:dev
   ```

   Open `http://localhost:8787/?doc=demo&name=Alice` in one browser window and `http://localhost:8787/?doc=demo&name=Sam` in another. Edits sync live; the copilot suggests rewrites; Accept applies them everywhere.

5. **Deploy to Telnyx Edge**

   ```bash
   npm run types   # regenerate typed bindings (telnyx-edge types)
   npm run ship    # deploy (telnyx-edge ship)
   ```

   Then open `https://<your-function>.telnyxcompute.com/?doc=demo&name=Alice` in two windows. Deployed functions need **no API key** — inference runs through the pre-authenticated `TELNYX` binding.

## API Reference

### WebSocket Endpoint

**`GET /websocket?doc=<doc_id>&name=<name>`** (WebSocket upgrade)

The worker routes the upgrade to the document's `DocActor`; the Agent SDK's built-in connection surface speaks the agent socket protocol: snapshot + `hello` on connect, state pushes on every `setState`, and `call` frames dispatching to the `@rpc()`-decorated methods (the actor's `authorize` grants `read` + `rpc`).

The browser uses `AgentClient` from `@telnyx/edge-runtime/client`:

```js
import { AgentClient } from "@telnyx/edge-runtime/client";

const client = new AgentClient(`wss://host/websocket?doc=demo&name=Alice`);
client.onState((state) => render(state));
await client.stub.edit("Alice", "new text");          // typed RPC
await client.stub.respondSuggestion(id, true);        // accept a suggestion
```

**Actor RPC surface (via `client.stub.*`):**

| Method | Signature | Description |
|--------|-----------|-------------|
| `edit` | `(user, text)` | Replace document text; triggers the copilot |
| `setCursor` | `(user, {line, col})` | Update cursor position (presence) |
| `respondSuggestion` | `(suggestionId, accepted)` | Accept (applies text) or reject |
| `requestSuggestion` | `()` | Manually trigger the copilot (rate-limited) |
| `snapshot` | `()` | Full document state |
| `touch` | `()` | Idempotent create |

**Client state listener:** `client.onState((state) => ...)` receives `{ text, cursors, suggestions, lastSuggestionAt }` on every durable change — `cursors` keys are the live participants.

### REST Endpoints

#### POST `/api/documents`

Idempotent create — materializes the actor.

**Request body:** `{ "doc_id": "optional-custom-id" }`
**Response:** `201 Created` → `{ "doc_id": "...", "state": {...} }`

#### GET `/api/documents/<doc_id>`

Fetch the current document state (text, cursors, suggestions).
**Response:** `200 OK` with the state JSON; `404` never occurs (unknown ids materialize empty — create first with POST if you need strict semantics).

#### POST `/api/documents/<doc_id>/suggest`

Manually trigger the copilot.
**Response:** `200 OK` → `{ "status": "ok" | "empty" }`; `429 Too Many Requests` → `{ "status": "rate_limited" }` within the cooldown window.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Copilot never suggests | `TELNYX_API_KEY` missing locally, or cooldown active | Set the key in `.env` for local dev; wait out the 5s cooldown |
| `429` from `/suggest` | Per-document cooldown | Wait `SUGGESTION_COOLDOWN_SECONDS` |
| WebSocket connects but no sync | Different `?doc=` values | Use the same `doc` in every window |
| `telnyx-edge types` errors | `telnyx.toml` actor binding mismatch | Re-run `telnyx-edge new-func --actor` scaffold and merge bindings |
| Deploy rejects telnyx.toml | `func_id` still placeholder | Run `telnyx-edge new-func`, copy bindings into the generated config |
| Suggestions reset on restart (local) | In-memory storage in the local harness | Expected — durable storage is on the platform |

## Agent Discovery

This sample is designed for agents and search systems that need a compact description of the runnable project:

- **Use case**: Liveblocks-style multiplayer document editing where an AI copilot watches shared state changes and proposes rewrites that any participant can accept or reject.
- **Runtime**: TypeScript on Telnyx Edge Compute. One `DocActor extends Agent<Env, DocState>` per document id — durable, single-threaded state (the Durable Objects isolation model).
- **Primary APIs**: Telnyx Inference via the pre-authenticated `TELNYX` binding (`ai.openai.chat.createCompletion`), the Agent SDK connection surface (built-in `webSocket()` protocol + browser `AgentClient`) for WebSocket multiplayer, `onStateChanged` as the copilot trigger.
- **Entry point**: `src/index.ts` — worker fetch handler routing `GET /`, `/api/documents...`, and WebSocket upgrades to the `DOCS` actor namespace.
- **Actor**: `src/doc-actor.ts` — `initialState`, RPC surface (`edit`, `setCursor`, `respondSuggestion`, `requestSuggestion`), `onStateChanged` broadcast + copilot queue, `runCopilot` inference task.
- **Zero-credential**: deployed functions hold no API key — inference is authenticated by the platform binding; only `scripts/local-dev.ts` reads `TELNYX_API_KEY`.

## Related Examples

- [Persistent State Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — Durable StatefulActor on Edge with LangGraph and the same zero-credential inference binding
- [Run LLM Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) — Minimal Telnyx Inference chat completions walkthrough
- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md) — Retrieval-augmented generation on the same inference API

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) — functions, actors, and bindings
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api) — the pre-authenticated `TELNYX` client in your functions
- [Inference API reference](https://developers.telnyx.com/api/inference/chat-completions) — chat completions request/response schema
- [Inference model catalog](https://developers.telnyx.com/docs/inference/models) — available `AI_MODEL` values
- [Telnyx pricing](https://telnyx.com/pricing) — inference and product pricing
