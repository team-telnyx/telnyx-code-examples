# Guide: Build a Live Conversation Replay on Telnyx Edge Compute

This guide walks through how `agent-message-replay` works, end to end: the durable replay actor, the WebSocket protocol, and the pieces you would reuse to replay *your own* agent conversations.

By the end you will understand how to:

1. Model a replay as a durable agent (`ReplayAgent extends Agent`).
2. Stream a conversation through a `MessageLog` and over a WebSocket with `AgentSocketServer`.
3. Re-enact recorded state changes as live state patches.
4. Add optional LLM commentary with the pre-authenticated `TELNYX` binding.
5. Deploy it and connect from any WebSocket client.

## Prerequisites

- Node.js 18+
- A Telnyx account with Edge Compute enabled
- The `telnyx-edge` CLI (`npm install -g @telnyx/edge-cli`)
- A `TELNYX_API_KEY` (deploy-time only — the running sample uses the pre-authenticated Edge binding for inference)

## 1. The model: a recording, an actor, and a log

Three data structures carry the whole feature:

- **A recording** — an ordered list of steps: `{role, content, delayMs, stage?}`. `delayMs` is the original pacing; `stage` is the agent state the original agent had reached when it emitted the step. Stored in per-actor SQLite (`src/script.ts`).
- **A durable actor** — one `ReplayAgent` per conversation id (`env.REPLAY.idFromName(id)`). The actor owns the recording, the replay state, the `MessageLog`, and the event stream. It survives restarts; its `playhead` is durable.
- **A MessageLog** — `this.messages`, the Agent SDK's durable conversation log. During replay it is *live*: every recorded step is appended as it plays, and every append is pushed to connected WebSocket clients.

## 2. The agent: socket wiring

`src/replay-agent.ts` builds the socket half of the agent protocol explicitly — the pattern to copy when you want control over pushes:

```ts
import { Agent, rpc, type Claim } from "@telnyx/edge-runtime";
import { AgentSocketServer, type AgentServerSocket } from "@telnyx/edge-runtime/agent-socket";

export class ReplayAgent extends Agent<ReplayEnv, ReplayState> {
  private desk = new AgentSocketServer<ReplayState>(this, {
    getState: () => this.getState(),
    getMessages: () => this.messages.all(),
    getEvents: (after) => this.events.read(after),
    authorize: (token) =>
      token === (this.env.REPLAY_TOKEN ?? "replay-demo")
        ? ["read", "rpc"]
        : ["read"],
  });

  override async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    await this.desk.attach(ws, req);
  }
}
```

What each option does:

- `getState` — snapshotted and sent to every client on connect, then patched on every change.
- `getMessages` — a `messages` snapshot on connect (full history so far), then appends.
- `getEvents` — powers the `events` stream with cursor replay: a reconnecting client sends `cursors: {events: <lastSeq>}` and receives everything it missed.
- `authorize` — maps a credential to claims. The demo token grants `["read", "rpc"]`; everyone else is a read-only watcher. The SDK itself only interprets the `"rpc"` claim (needed for `call` frames).

Every state change in the agent flows through one helper so clients see each transition:

```ts
private async changeState(patch: ReplayStatePatch): Promise<ReplayState> {
  const next = await super.setState(patch);
  this.desk.broadcastPatch(patch);
  return next;
}
```

## 3. Playback: a durable tick chain

Playback is not a loop in memory — it is a chain of durable tasks. Each `tick()` plays one step, then schedules the next:

```ts
async tick(): Promise<void> {
  const state = await this.getState();
  if (state.status !== "playing") return;        // pause/finish = durable no-op

  const step = steps[index];
  await this.messages.add(step.role, step.content); // live append → pushed to watchers
  this.desk.broadcastMessages([last]);

  if (step.stage && step.stage !== state.agentStage) {
    await this.events.emit("state_change", { stage: step.stage, stepIndex: index });
    await this.changeState({ agentStage: step.stage }); // re-enact + broadcast patch
  }

  await this.changeState({ playhead: nextIndex });
  const delaySeconds = Math.max(step.delayMs, 250) / 1000 / state.speed;
  await this.schedule(delaySeconds, "tick");     // durable next tick
}
```

Why this shape:

- **Pausing is durable by construction.** `pause()` only sets `status: "paused"`. The pending tick wakes later, sees the status, and exits — no task-id bookkeeping.
- **Crash-safe.** If the actor restarts mid-replay, the pending `tick` task is still scheduled; press play and it resumes from the persisted `playhead`.
- **Speed changes take effect naturally** on the next tick, because the delay is computed from the *current* speed each time.

## 4. Commentary: MessageLog history → inference

When commentary is enabled, each played assistant step triggers one LLM call. The context comes straight from the `MessageLog`:

```ts
const history = toChatMessages(await this.messages.toOpenAI()); // MessageLog → OpenAI shape
const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: this.env.MODEL ?? "zai-org/GLM-5.2",
  messages: [{ role: "system", content: COMMENTARY_SYSTEM_PROMPT }, ...history],
  max_tokens: 120,
  temperature: 0.6,
});
const text = firstChoiceText(completion);
if (text) {
  await this.events.emit("commentary", { stepIndex, text, model });
  await this.broadcastLastEvent();
}
```

Two details worth copying:

- **`this.env.TELNYX` is pre-authenticated.** No API key appears in code, config, or logs — the Edge binding carries the credential. Swap the model by changing `MODEL`.
- **Commentary lands on the event stream, not the message log.** The replayed conversation stays a faithful recording; annotations ride alongside as events.

## 5. The client: attach, consume, call

The demo UI (`src/demo-html.ts`) is a dependency-free browser client that speaks the same protocol any client needs:

```js
const ws = new WebSocket("wss://<your-function>.telnyxcompute.com/ws?conv=demo-1");
ws.onopen = () => ws.send(JSON.stringify({
  json: { v: 2, kind: "attach", token: "replay-demo", subscribe: ["state", "messages", "events"] }
}));
ws.onmessage = (ev) => {
  const frame = JSON.parse(ev.data).json;   // SuperJSON envelope
  switch (frame.kind) {
    case "state":    /* snapshot? replace. patch? merge-patch (RFC 7396) */ break;
    case "messages": /* snapshot? replace. appended? concat               */ break;
    case "event":    /* commentary + state_change feed                     */ break;
  }
};
// controls are RPC:
ws.send(JSON.stringify({ json: { v: 1, kind: "call", id: "c1", method: "play", args: [] } }));
```

Scrubbing is client-side by design: every streamed frame is retained with its position, so the timeline can walk back through history (messages, state trail, and commentary all filter by step index) with zero server round-trips. `seek()` exists for the server-side case — rewinding the durable playhead.

## 6. Bring your own conversation

Two ways to load something other than the demo:

```bash
# 1. Ingest a recording
curl -X POST https://<your-function>.telnyxcompute.com/ingest \
  -H "content-type: application/json" \
  -d '{"conversation_id": "support-48211", "steps": [
        {"role": "user", "content": "Where is my order?", "delayMs": 500},
        {"role": "assistant", "content": "It ships today.", "delayMs": 900, "stage": "resolving"}
      ]}'
# then open /ws?conv=support-48211 (the demo UI: set the conversation field)

# 2. Or extend ReplayAgent to import from your production MessageLog —
#    any agent built on this SDK already persists history in this format.
```

The second path is the real payoff: because the Agent SDK persists every conversation as a durable `MessageLog`, a replay is *reading your production agent's history back* — no special instrumentation, no schema translation.

## 7. Deploy

```bash
npm install -g @telnyx/edge-cli
telnyx-edge login
telnyx-edge new-func --actor --name=agent-message-replay
# copy bindings from telnyx.toml, then:
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
npm run types && npm run ship
```

Open the function URL: connect → **Load demo** → **Play** → toggle **LLM commentary** → scrub the timeline.

## What to build next

- **Replay production agents**: point `ingest` at your agent's export endpoint and replay real support conversations for QA and training.
- **Time-travel debugging**: re-enact tool calls alongside state changes and step through them frame by frame.
- **Multi-conversation gallery**: a registry actor that lists live conversation ids, letting viewers hop between replays.
