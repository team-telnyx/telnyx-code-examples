# Multi-Agent Debate — A Telnyx Edge Tutorial

This guide walks you through building a **multi-agent debate** application using the **Telnyx Edge SDK**. Two AI agents take opposing stances on a topic, debate turn-by-turn, and stream the conversation live over **WebSocket**. An audience votes on the winner, and votes are tallied in a **SQL database**.

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** (for `tsx` and Edge runtime compatibility)
- **npm** or **yarn**
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

> 🔒 Never commit your real `.env` file. The `.gitignore` excludes it.

---

## Project Structure

```
multi-agent-debate/
├── src/
│   └── index.ts          # Main entry point — agents, WebSocket server, SQL, voting
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── smoke_test.ts         # Verifies the module loads without error
├── README.md
├── API.md
└── GUIDE.md              # This file
```

---

## How It Works — Step by Step

### Step 1: Agent SDK — Two Debate Agents

In `src/index.ts`, two agents are defined by extending the `Agent` class from `@telnyx/edge-sdk`:

```typescript
class DebateAgent extends Agent {
  stance: 'pro' | 'con'
  // ...
}
```

Two instances are created — one for the **pro** stance and one for the **con** stance:

```typescript
const agentA = new DebateAgent('pro', initialState)
const agentB = new DebateAgent('con', initialState)
```

Each agent has a unique personality prompt injected into its system message, ensuring they argue from their assigned position.

---

### Step 2: Inference Binding — Zero-Credential OpenAI

Both agents use the Telnyx Edge SDK's built-in AI binding to call OpenAI's chat completion API:

```typescript
const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: 'gpt-3.5-turbo',
  messages: [...],
})
```

This uses **zero-credential** inference — the Telnyx Edge runtime handles authentication and routing to OpenAI. You do **not** need an OpenAI API key.

---

### Step 3: StateStore — Turn-Based Debate State

A `StateStore` instance tracks the current debate state:

```typescript
const state = new StateStore({
  topic: 'Resolved: AI should be regulated',
  turn: 'agentA',
  arguments: [],
  votes: { pro: 0, con: 0 },
})
```

Each agent reads the current turn from state, generates an argument, appends it to the state, and flips the turn to the other agent. This enforces **turn-based** debate.

---

### Step 4: WebSocket — Live Streaming with AgentSocketServer

The `AgentSocketServer` broadcasts each argument as it's generated:

```typescript
const socketServer = new AgentSocketServer(env)
socketServer.on('connection', (socket) => {
  socket.on('vote', (vote) => { ... })
})
```

When Agent A finishes its argument, the server broadcasts:

```json
{
  "type": "argument",
  "agent": "agentA",
  "stance": "pro",
  "text": "AI regulation is essential to prevent misuse..."
}
```

Agent B then generates a rebuttal, which is also broadcast. The audience sees the debate unfold in real time.

---

### Step 5: Audience Voting via WebSocket + SQL Tally

Audience members vote by sending a WebSocket message:

```json
{
  "type": "vote",
  "choice": "pro"
}
```

The vote handler:

1. Receives the vote over WebSocket
2. Writes it to the **SQL database** via `env.SQL.prepare(...).run(...)`
3. Updates the in-memory vote tally in `StateStore`
4. Broadcasts the updated tally to all connected clients

```typescript
socket.on('vote', async (vote) => {
  await env.SQL.prepare(
    'INSERT INTO votes (choice, timestamp) VALUES (?, ?)'
  ).bind(vote.choice, Date.now()).run()

  state.updateVotes(vote.choice)
  socketServer.broadcast({ type: 'tally', votes: state.get('votes') })
})
```

---

### Step 6: Winner Determination

After a fixed number of rounds (configurable), the debate ends. The agent with the most votes wins:

```typescript
const winner = votes.pro > votes.con ? 'agentA' : 'agentB'
socketServer.broadcast({ type: 'winner', winner })
```

---

## Demo Mode vs. Live Mode

### Demo Mode (Default)

By default, the app runs in **demo mode**:

- Agents use a **mock inference function** that returns pre-written arguments
- No real OpenAI API calls are made
- Votes are stored in SQL but the app logs what would happen

To run in demo mode:

```bash
npm run dev
```

### Live Mode

To switch to **live mode** (real AI inference via Telnyx Edge):

1. Set `DEMO_MODE=false` in your `.env`:

```env
DEMO_MODE=false
TELNYX_API_KEY=your_telnyx_api_key_here
```

2. Restart the server:

```bash
npm run dev
```

In live mode, agents call `this.env.TELNYX.ai.openai.chat.createCompletion()` for real, and the debate is generated dynamically.

---

## Running the Smoke Test

Before running the app, verify the module loads correctly:

```bash
npx tsx smoke_test.ts
```

You should see:

```
✅ Module loaded successfully
✅ DebateAgent class instantiated
✅ StateStore initialized
✅ AgentSocketServer ready
```

---

## Running the Application

Start the Edge dev server:

```bash
npm run dev
```

Then open your browser to:

```
http://localhost:8787
```

Connect a WebSocket client to:

```
ws://localhost:8787/ws
```

Send a vote:

```json
{ "type": "vote", "choice": "pro" }
```

---

## Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** | `DebateAgent extends Agent` — two instances with pro/con stances |
| **Inference (binding)** | `this.env.TELNYX.ai.openai.chat.createCompletion()` — zero-credential OpenAI |
| **WebSocket** | `AgentSocketServer` — live streaming of arguments and vote tallies |
| **StateStore** | Debate state: current turn, arguments, vote counts |
| **SQL DB** | Vote tally persistence via `env.SQL.prepare(...).run(...)` |

---

## Troubleshooting

### "TELNYX_API_KEY is not set"

Ensure `.env` exists and contains your key:

```bash
cp .env.example .env
```

### WebSocket connection refused

Make sure the dev server is running and you're connecting to `ws://localhost:8787/ws`.

### SQL table not found

The app auto-creates the `votes` table on startup. If you see errors, check the SQL schema in `src/index.ts`.

### No arguments appearing

In demo mode, arguments are pre-written. In live mode, ensure your Telnyx API key has access to the AI inference binding.

---

## Next Steps

- [Telnyx Edge SDK Reference](https://docs.telnyx.com/edge-sdk)
- [Agent SDK Documentation](https://docs.telnyx.com/edge-sdk/agents)
- [WebSocket on Telnyx Edge](https://docs.telnyx.com/edge-sdk/websockets)
- [SQL Storage on Telnyx Edge](https://docs.telnyx.com/edge-sdk/sql)
- [AI Inference Bindings](https://docs.telnyx.com/edge-sdk/ai)

Explore more Telnyx code samples in the [telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples) repository.
