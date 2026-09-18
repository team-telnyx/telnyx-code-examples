# Multi-Agent Debate — A Telnyx Edge Tutorial

This guide walks you through building a **multi-agent debate** application on **Telnyx Edge Compute** with the Telnyx Agent SDK (`@telnyx/edge-runtime`). Two AI agents take opposing stances on a topic, debate turn-by-turn, and stream the conversation live over **WebSocket** through the agent's built-in connection surface. An audience votes on the winner, and votes are tallied in the actor's embedded **SQL** store.

---

## Prerequisites

Before you begin, ensure you have:

- **Docker** (the local actor stack runs as a compose project)
- The **Edge Compute CLI** (`telnyx-edge`, v0.4.1+ — [releases](https://github.com/team-telnyx/edge-compute/releases))
- **npm**
- A **Telnyx account** with an API key — [sign up here](https://telnyx.com/sign-up)
- Basic familiarity with TypeScript and WebSocket concepts

---

## Environment Setup

### 1. Clone the repo and navigate to the sample

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-agent-debate
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in your Telnyx API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
```

> 🔒 Never commit your real `.env` file. The `.gitignore` excludes it. The API key
> authenticates the `telnyx-edge` CLI; the actors themselves use the zero-credential
> `[telnyx]` binding for inference and never read the key.

---

## Project Structure

```
multi-agent-debate/
├── src/
│   ├── index.ts          # Front door — routes, dashboard HTML, /agents socket mount
│   ├── debateAgent.ts    # DebateAgent actor — pro/con argument composition
│   ├── debateRoom.ts     # DebateRoom actor — orchestration, votes, SQL tally
│   └── dashboard.ts      # Live dashboard HTML
├── scripts/
│   ├── start.mjs         # Boots the local stack (telnyx-edge dev)
│   └── smoke.mjs         # End-to-end smoke against a running stack
├── package.json
├── tsconfig.json
├── telnyx.toml           # Edge Compute project config — actor bindings, env vars
├── .env.example
├── README.md
├── API.md
└── GUIDE.md              # This file
```

---

## How It Works — Step by Step

### Step 1: Agent SDK — Two Debate Agents

`src/debateAgent.ts` defines the debater by extending the `Agent` class from `@telnyx/edge-runtime`:

```typescript
export class DebateAgent extends Agent<DebateEnv, DebateAgentState> {
  protected override initialState(): DebateAgentState {
    return { debateId: "", topic: "", stance: "pro", argument: "", turnCount: 0, error: "", updatedAt: 0 };
  }

  async compose(input: { debateId: string; topic: string; stance: Stance; demo: boolean; model: string; previousArgument: string }): Promise<DebateAgentState> {
    // build the persona prompt, generate, and store the argument in state
  }
}
```

You never construct an agent yourself — the runtime does. Each debate gets two durable
instances, addressed by actor name: `env.DEBATER.idFromName("<debateId>-pro")` and
`env.DEBATER.idFromName("<debateId>-con")`. Each instance has its own persona prompt
injected into the system message, so they argue from their assigned position.

---

### Step 2: Inference Binding — Zero-Credential OpenAI

The debater uses the Telnyx API binding to call the inference endpoint:

```typescript
const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: input.model,
  messages: [
    { role: "system", content: SYSTEM_PROMPT(input.stance) },
    { role: "user", content: prompt },
  ],
  max_tokens: 256,
  temperature: 0.7,
});
```

This uses **zero-credential** inference — the `[telnyx]` binding declared in `telnyx.toml`
handles authentication and routing. You do **not** need an OpenAI API key. In demo mode
(`DEMO_MODE` != `false`) the agent returns canned arguments and skips the call.

---

### Step 3: Agent State — Turn-Based Debate State

The `DebateRoom` actor tracks the current debate state with the Agent base class's
merge-patch state:

```typescript
export class DebateRoom extends Agent<DebateEnv, DebateRoomState> {
  // durable state: topic, phase, currentTurn, args[], tally, winner
  const state = await this.getState();          // read
  await this.setState({ currentTurn: "con" });  // RFC 7396 merge-patch — other keys untouched
}
```

Every `setState` merge is committed durably and pushed live to connected clients —
no broadcast code needed. Arrays are atomic in a merge patch, so the room replaces
`args` wholesale each turn.

Each agent reads the current turn from state, generates an argument, appends it to the state, and flips the turn to the other agent. This enforces **turn-based** debate.

---

### Step 4: WebSocket — Live Streaming via the Agent Connection Surface

The room activates the Agent base class's built-in connection surface by overriding the
`authorize` seam — no socket code in the subclass:

```typescript
protected override authorize(token: string | undefined): readonly Claim[] {
  return token === undefined ? ["read"] : ["read", "rpc"];
}
```

The front door mounts the agent with `mountAgents` from `@telnyx/edge-runtime/mount`:

```typescript
const handleAgents = mountAgents<Env>((env) => ({ room: env.DEBATE_ROOM }));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/agents/")) return handleAgents(req, env);
    // ... HTTP routes
  },
};
```

A WebSocket upgrade to `/agents/room/<debateId>` lands in the agent's default
`webSocket()` handler. The client receives a state snapshot on connect and an
incremental merge-patch on every `setState`, so each new argument, the phase, and the
tally stream to every connected client in real time — the same protocol the bundled
dashboard consumes.

---

### Step 5: Audience Voting — `@rpc()` over WebSocket, SQL Tally

The vote method is decorated with `@rpc()`, so it is dispatchable over the agent socket
protocol (a `call` frame from a connected client with the `rpc` claim) and callable via
actor RPC from the front door:

```typescript
@rpc({ description: "Cast an audience vote for the pro or con side" })
async vote(input: { voterId: string; choice: Stance }): Promise<DebateRoomState> {
  // upsert into the room's embedded SQL ledger
  const existing = this.ctx.storage.sql
    .exec("SELECT choice FROM votes WHERE voter_id = ?", input.voterId)
    .toArray()[0];
  if (existing) {
    if (existing.choice === input.choice) return this.getState();
    this.ctx.storage.sql.exec("UPDATE votes SET choice = ?, voted_at = ? WHERE voter_id = ?", input.choice, Date.now(), input.voterId);
  } else {
    this.ctx.storage.sql.exec("INSERT INTO votes (voter_id, choice, voted_at) VALUES (?, ?, ?)", input.voterId, input.choice, Date.now());
  }
  const tally = await this.readTally();   // GROUP BY over the ledger
  await this.setState({ tally });          // streams live to connected clients
  await this.events.emit("vote.recorded", { choice: input.choice, tally });
  return this.getState();
}
```

One vote per audience member: a repeat call with the same `voterId` replaces the earlier
vote. `POST /debate/{debateId}/vote` runs the same method from HTTP without a token.

---

### Step 6: Winner Determination

When the host calls `POST /debate/{debateId}/end`, the room reads the final tally from
the SQL ledger and declares the winner:

```typescript
const winner: Winner = tally.pro > tally.con ? "pro" : tally.con > tally.pro ? "con" : "tie";
await this.setState({ phase: "ended", tally, winner, endedAt: Date.now() });
await this.events.emit("debate.ended", { winner, tally });
```

---

## Demo Mode vs. Live Mode

### Demo Mode (Default)

By default, the app runs in **demo mode**:

- Debaters return **canned arguments** — no inference call is made
- Everything else is real: durable actor state, SQL vote ledger, WebSocket streaming

Demo mode is the `[env_vars]` default in `telnyx.toml`:

```bash
npm start
```

### Live Mode

To switch to **live mode** (real AI inference via the `[telnyx]` binding):

1. Set `DEMO_MODE=false` in `telnyx.toml` `[env_vars]`, or flip it without a redeploy:

```bash
telnyx-edge secrets add DEMO_MODE false
```

2. Restart the local stack:

```bash
npm start
```

In live mode, debaters call `this.env.TELNYX.ai.openai.chat.createCompletion()` for real
with `AI_MODEL` from `telnyx.toml`, and the debate is generated dynamically.

---

## Running the Smoke Test

The smoke test exercises the full flow — start a debate, cast votes, fetch status, end
and verify the winner — against a running edge stack:

```bash
npm start &        # boots the local actor stack (requires Docker)
npm run smoke
```

You should see:

```
Smoke test passed for debate-m9x2k1-4f8a
```

Set `DEMO_BASE_URL` to run it against a deployed function instead.

---

## Running the Application

Start the edge dev stack:

```bash
npm start
```

Then open your browser to:

```
http://localhost:8787
```

Connect a WebSocket client to the live stream:

```
ws://localhost:8787/agents/room/<debateId>
```

Cast a vote (the simplest path):

```bash
curl -X POST http://localhost:8787/debate/<debateId>/vote \
  -H "Content-Type: application/json" \
  -d '{"voterId": "audience-1", "choice": "pro"}'
```

---

## Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** | `DebateAgent` / `DebateRoom extends Agent` — durable actors addressed by name |
| **Inference (binding)** | `this.env.TELNYX.ai.openai.chat.createCompletion()` — zero-credential `[telnyx]` binding |
| **WebSocket** | The agent's built-in connection surface via the `/agents` mount — snapshots, merge-patches, and events stream live |
| **Agent state** | `getState()` / `setState()` — debate phase, turn, arguments, live tally |
| **Embedded SQL** | Vote ledger via `this.ctx.storage.sql.exec(...)` — one upsert row per audience member |
| **`@rpc()` + `authorize()`** | Vote dispatch over socket `call` frames with the `rpc` claim |

---

## Troubleshooting

### "argument generation failed"

The debater could not reach the inference binding. Ensure the `[telnyx]` binding is
declared in `telnyx.toml` and the Edge CLI is authenticated with your Telnyx API key.

### WebSocket connection refused

Make sure the edge stack is running (`npm start`, requires Docker) and you're connecting
to `ws://localhost:8787/agents/room/<debateId>`.

### SQL table not found

The room auto-creates the `votes` table on debate start (`ensureSchema()`). If you see
errors, check the SQL schema in `src/debateRoom.ts`.

### No arguments appearing

In demo mode, arguments are pre-written and appear within the `POST /debate` call. In
live mode, ensure your `AI_MODEL` is available on the Telnyx AI Inference endpoint.

---

## Next Steps

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)

Explore more Telnyx code samples in the [telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples) repository.
