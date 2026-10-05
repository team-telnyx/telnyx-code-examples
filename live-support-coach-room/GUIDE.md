# Live Support Coach Room — A Telnyx Edge Agent Tutorial

This guide walks you through the `live-support-coach-room` sample: a Telnyx Edge Agent that streams a live AI support call's conversation events to a supervisor dashboard, injects coaching nudges mid-call, and escalates to a human WebRTC softphone when needed.

## Prerequisites

- A Telnyx account with an API key (`TELNYX_API_KEY`)
- A Telnyx Call Control connection ID (`CALL_CONTROL_CONNECTION_ID`)
- A Telnyx phone number (`TELNYX_NUMBER`)
- Node.js 18+ and `telnyx-edge` CLI installed
- The `@telnyx/edge-runtime` package (v0.15.1)

## Environment Setup

Create a `.env` file (or use `telnyx-edge secrets add`):

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
CALL_CONTROL_CONNECTION_ID=your_call_control_connection_id
TELNYX_NUMBER=+1555XXXXXXXX
SUPERVISOR_DEVICE=+1555XXXXXXXX
DASHBOARD_ORIGIN=http://localhost:3000
NUDGE_MAX_PER_CALL=3
SILENCE_SECS=90
COACH_AUTH=your_coach_auth_secret
```

## Project Structure

```
live-support-coach-room/
├── src/
│   └── index.ts          # CoachRoom agent + NudgePolicy
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
├── .gitignore
└── smoke_test.ts
```

## How It Works — Step by Step

### 1. The CoachRoom Agent

The `CoachRoom` class (in `src/index.ts`) extends `Agent<CoachEnv, CoachState>`. Each conversation gets its own durable actor instance, created via `env.COACHROOMS.idFromName(conversationId)`. This means every support call has an isolated, stateful room that persists for the duration of the call.

The agent has three responsibilities:
- **Receive** the assistant's conversation event stream over a WebSocket
- **Watch** for coaching triggers and inject nudges
- **Escalate** to a human by dialing a WebRTC softphone and joining them into the call

### 2. WebSocket Server — Receiving the Event Stream

The `webSocket(ws, req)` method handles the WebSocket connection that Telnyx opens from the AI Assistant's `websocket_settings`. When the assistant starts a call, Telnyx connects to `wss://coach-room.../ws?auth_ref=<secret>`.

The `auth_ref` query parameter is verified against `env.COACH_AUTH`. If it doesn't match, the socket is closed with code 1008 (policy violation). This ensures only authorized assistant instances can stream events.

When a `session.created` event arrives, the actor:
- Stores the `conversationId` and `callControlId` in durable state
- Broadcasts the session start to all connected supervisor dashboard tabs
- Schedules a silence watcher via `this.schedule(silenceSecs, "checkSilence", {})`

### 3. Live Transcript Streaming

As the conversation progresses, the assistant sends:
- `conversation.item.created` — new user or assistant message
- `response.text.delta` — streaming text from the assistant

Each event is broadcast to supervisor dashboard tabs via `AgentSocketServer.broadcast()`. The dashboard renders the running transcript in real time, typically within 2 seconds of the event arriving.

### 4. Nudge Policy — Injecting Coach Instructions

The `NudgePolicy` class enforces two limits:
- **Rate limit**: ≤10 nudges per second (100ms minimum between nudges)
- **Size limit**: ≤1 MiB per injected frame
- **Count limit**: ≤3 nudges per call (configurable via `NUDGE_MAX_PER_CALL`)

When a trigger fires (e.g., the caller gives an account number wrong twice), the actor calls `injectNudge(text)`. This sends a `conversation.item.create` frame back over the assistant WebSocket:

```typescript
{
  type: "conversation.item.create",
  item: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Verify identity with date of birth next." }]
  }
}
```

Because the injected item has `role: "user"`, the assistant treats it as a new caller message and pivots its response accordingly — all without the supervisor saying a word.

### 5. Policy Triggers

The `evaluateNudgeTriggers(text, state)` method watches for:
- **Failed account-number confirmations**: If the caller mentions an account number twice, the actor injects a nudge telling the assistant to verify identity with date of birth instead.
- **Refund promises**: If the caller mentions a refund, a `refund_promise` flag is set and broadcast to the dashboard.
- **90-second silence**: The scheduled `checkSilence` task fires every `SILENCE_SECS` and checks if `lastActivity` is stale. If so, it injects a check-in nudge.

### 6. Escalation — Dialing the Supervisor

When a supervisor clicks "Join Call" in the dashboard, the `@rpc joinCall` method is invoked. This:

1. Dials the supervisor's WebRTC device via Call Control (`env.TELNYX.calls.create`)
2. Gets the supervisor's `call_control_id` from the dial response
3. Joins the supervisor leg into the live AI conversation via:
   ```
   POST https://api.telnyx.com/v2/calls/{callControlId}/actions/ai_assistant_join
   ```
   with the payload:
   ```json
   {
     "conversation_id": "<conversationId>",
     "participant": {
       "id": "<supervisorCallControlId>",
       "role": "user",
       "name": "Supervisor"
     }
   }
   ```

The supervisor's WebRTC softphone (browser-side JS SDK) receives the inbound call and is now part of the same AI conversation.

### 7. Session Finalization — SQL Audit Trail

When `session.ended` arrives, the actor:
- Inserts a row into `coach_log` (SQL binding) with `conversation_id`, `flags`, `nudges`, `took_over`, and `duration_sec`
- Resets the room state via `this.replaceState(this.initialState())`
- The next conversation spawns a fresh room actor

### 8. Side-Channel Guarantee

The WebSocket event stream is a **side channel** — if the coach server goes down mid-call, the live call continues unaffected. The dashboard reconnects with exponential backoff (handled client-side) and resumes the view without replaying backlog.

## Telnyx Primitives Used

| Primitive | Usage |
|-----------|-------|
| **Agent SDK** (`Agent` class) | `CoachRoom extends Agent` — durable per-conversation state, `@rpc` methods, `this.schedule()` |
| **AgentSocketServer** | Fan-out to supervisor dashboard tabs over WebSocket |
| **WebSocket server** (`webSocket()`) | Receives assistant conversation event stream |
| **Call Control** (`env.TELNYX.calls.create`) | Dials the supervisor's WebRTC device |
| **AI Assistant Join API** | `POST /calls/{id}/actions/ai_assistant_join` — joins supervisor into live conversation |
| **SQL binding** (`env.COACH_LOG`) | `coach_log` table for audit trail |
| **Secrets** (`env.SECRETS.get`) | Retrieves `TELNYX_API_KEY` for API calls |
| **Task scheduling** (`this.schedule()`) | Silence watcher — fires every `SILENCE_SECS` |

## Demo Mode vs Live Mode

This sample runs in **live mode** by default — it uses real Telnyx API calls for dialing and joining. To run in a safe demo mode for local testing:

1. Set `SUPERVISOR_DEVICE` to a test number
2. Use the caller simulator in the dashboard to simulate a support call
3. The nudge and escalation features work end-to-end, but no real customer calls are placed

To switch to full live mode, ensure all environment variables point to real Telnyx resources.

## Running the Sample

```bash
# Install dependencies
npm install

# Generate type definitions
telnyx-edge types

# Run smoke test
npx tsx smoke_test.ts

# Deploy
telnyx-edge ship
```

## Next Steps

- [Telnyx AI Assistants — Conversation Event Stream](https://developers.telnyx.com/docs/inference/ai-assistants/conversation-event-stream)
- [Telnyx AI Assistants — Multi-Participant Calls](https://developers.telnyx.com/docs/inference/ai-assistants/multi-participant-calls)
- [Join AI Assistant Conversation API](https://developers.telnyx.com/api-reference/call-commands/join-ai-assistant-conversation)
- [WebRTC JS SDK — Make Your First Call](https://developers.telnyx.com/docs/development/webrtc/js-sdk/tutorials/make-your-first-call)
- [Agent SDK — WebSockets](https://developers.telnyx.com/docs/agent-sdk/websockets)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
