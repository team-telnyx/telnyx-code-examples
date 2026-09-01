# Collaborative Document with AI Copilot — Guide

This guide walks through the `collaborative-doc-ai-copilot` example — a
Liveblocks-style multiplayer document editor on Telnyx Edge Compute with an AI
copilot that watches document changes and suggests edits. It combines one
`DocActor` StatefulActor per document, the Agent SDK's WebSocket socket layer
for multiplayer sync, and the zero-credential Telnyx Inference binding for the
copilot.

## What you'll build

- A shared document per `doc` id — durable, single-threaded actor state
- Live multiplayer editing with presence (participant cursors)
- An AI copilot that reacts to edits (rate-limited) and proposes a rewrite
- Accept/reject flow that applies the improved text to everyone in real time

## Prerequisites

- Node.js 18+
- A Telnyx account
  - **Deployed**: nothing to configure — inference uses the pre-authenticated
    `TELNYX` binding
  - **Local dev**: a Telnyx API key ([create one](https://portal.telnyx.com/api-keys))
- The [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge-compute/quickstart)
  (`telnyx-edge`) for deployment

## How it works

Three moving parts: the worker, the per-document actor, and the copilot.

### 1. The worker (`src/index.ts`)

A plain Edge worker: `GET /` serves the editor page, `/api/documents...` are
thin REST wrappers, and every WebSocket upgrade is routed to the document's
actor:

```ts
if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
  const docId = sanitizeDocId(docIdFromUrl(url));
  return env.DOCS.idFromName(docId).fetch(request);
}
```

`env.DOCS` is the actor namespace declared in `telnyx.toml`
(`[[actors]] binding = "DOCS"`). `idFromName(docId)` gives every document its
own durable, single-threaded actor — the same isolation model as a Cloudflare
Durable Object.

### 2. The document actor (`src/doc-actor.ts`)

```ts
export class DocActor extends Agent<Env, DocState> {
  protected initialState(): DocState {
    return { text: "", cursors: {}, suggestions: [], lastSuggestionAt: 0 };
  }

  async webSocket(ws, req) {
    this.sockets ??= new AgentSocketServer<DocState>(this, {
      getState: () => this.getState(),
    });
    await this.sockets.attach(ws, req);
  }

  protected async onStateChanged(next: DocState, prev: DocState): Promise<void> {
    if (this.sockets) this.sockets.broadcastSnapshot(next);
    if (next.text !== prev.text) await this.queue("runCopilot");
  }
}
```

Three things are happening:

- **Durable state**: `setState(patch)` merges RFC 7396 merge-patches into the
  actor's storage and fires `onStateChanged`.
- **Multiplayer**: `AgentSocketServer.attach` speaks the agent-client protocol
  on the actor's held sockets — state snapshot + `hello` on connect, new state
  pushed to every watcher on every change.
- **Typed RPC**: every public async method (`edit`, `setCursor`,
  `respondSuggestion`, ...) is callable from the browser as
  `client.stub.edit(...)` — the socket layer dispatches `call` frames to them.

Presence is just state: `cursors` is a `Record<name, {line, col}>`; a
participant's entry is deleted (merge-patch `null`) when their socket closes.

### 3. The copilot (zero-credential Telnyx Inference)

`onStateChanged` queues the copilot as its own actor turn — LLM latency never
blocks an edit. `runCopilot` then calls Telnyx Inference through the binding:

```ts
const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: modelId(this.env),   // default: meta-llama/Llama-3.3-70B-Instruct
  messages: [
    { role: "system", content: COPILOT_SYSTEM_PROMPT },
    { role: "user", content: `Document content:\n\n${state.text}` },
  ],
  max_tokens: 500,
  temperature: 0.7,
});
```

`this.env.TELNYX` is pre-authenticated by the platform — **no API key is
stored, read, or rotated anywhere in the deployed function**. The suggestion
is written into actor state, the broadcast puts a card in every participant's
panel, and Accept/Reject calls `stub.respondSuggestion` to apply or drop it.

## Run it locally

```bash
npm install
cp .env.example .env    # add TELNYX_API_KEY — local inference needs it
npm run local:dev       # http://localhost:8787
```

The local harness (`scripts/local-dev.ts`) runs the real worker and the real
`DocActor` in Node with in-memory storage — and real inference calls through
your API key.

Open two windows:

- `http://localhost:8787/?doc=demo&name=Alice`
- `http://localhost:8787/?doc=demo&name=Sam`

Try the full flow:

1. **Sync** — type in Alice's window; it appears live in Sam's
2. **Copilot** — stop typing ~5s; a suggestion card appears in both windows
3. **Accept** — click Accept in Sam's window; Alice's text is rewritten too
4. **Presence** — close a window; the participant chip disappears
5. **Rate limit** — `POST /api/documents/demo/suggest` twice quickly; the
   second returns `429`

## Deploy to Telnyx Edge

```bash
# 1. Scaffold an actor-backed function (assigns func_id)
telnyx-edge new-func --actor --name=collaborative-doc-ai-copilot

# 2. Copy this folder's telnyx.toml bindings into the generated config
#    (actors + [telnyx] + [edge_compute] with your func_id)

# 3. Regenerate typed bindings and deploy
npm run types    # telnyx-edge types
npm run ship     # telnyx-edge ship
```

Then open `https://<your-function>.telnyxcompute.com/?doc=demo&name=Alice` in
two windows. No secrets to configure — inference rides the `TELNYX` binding.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No suggestion appears | Missing `.env` key locally, empty doc, or cooldown | Set `TELNYX_API_KEY`, type some text, wait out the cooldown |
| Edits don't sync | Different `?doc=` values per window | Use the same `doc` in every window |
| `telnyx-edge types` fails | `telnyx.toml` binding mismatch | Re-run the `new-func --actor` scaffold and merge bindings |
| Deploy rejects `telnyx.toml` | `func_id` placeholder | Copy bindings into the scaffold-generated config |
| State resets on restart (local) | In-memory storage in the harness | Expected — the platform provides durable storage |

## Production notes

- **Rich text**: the protocol sends full-text replacements. For large documents
  move to CRDTs (e.g. Yjs) and keep the copilot trigger on state changes.
- **Auth**: the demo accepts any `?name=`. Gate the upgrade in
  `webSocket`'s connect path or the worker's routing.
- **Copilot quality**: tune `COPILOT_SYSTEM_PROMPT`, `AI_MODEL`, and
  `max_tokens`; per-user cooldowns are a small change to `runCopilot`.
- **Durability**: actor state persists across restarts on the platform; the
  local harness is in-memory by design.

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api)
- [Inference API reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Inference model catalog](https://developers.telnyx.com/docs/inference/models)
- [Telnyx pricing](https://telnyx.com/pricing)
