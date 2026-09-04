# Guide: Conference Agent Mediator

This guide walks you through the `conference-agent-mediator` sample: an AI meeting facilitator that joins Telnyx conferences, transcribes participants in real time, mediates turn-taking so nobody is left out, and sends a post-conference summary via SMS. A live dashboard and polling endpoints let observers follow the transcript without joining the call.

Because the sample uses the Telnyx Edge Agent SDK, it runs entirely on Telnyx's edge runtime as durable Stateful Actors — there is no separate server process to manage, and no local dev server. You ship the function with the Edge CLI and interact with it at its `*.telnyxcompute.com` URL.

## Prerequisites

- A Telnyx account with API access
- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+, authenticated (`telnyx-edge auth login`)
- Node.js 18+
- For live mode: a conference-enabled Telnyx number on a Call Control application, and an SMS-capable number with a 10DLC campaign

## Environment setup

The function's configuration lives in `telnyx.toml` (actors, `[telnyx]` inference/messaging binding, env vars). Secrets are set on the deployed function:

| Variable | Type | Description |
|---|---|---|
| `TELNYX_API_KEY` | secret | Telnyx API key (live-mode conference speak) |
| `AI_MODEL` | env_var | Telnyx-hosted LLM for prompts + summaries (default `zai-org/GLM-5.2`) |
| `SMS_FROM` | env_var | Telnyx number the summary SMS is sent from (E.164) |
| `SMS_TO` | env_var | Recipient of the post-conference summary SMS (E.164) |
| `DEMO_MODE` | env_var | `true` (default) = safe demo mode; `false` = live mode |

```bash
cp .env.example .env   # local reference copy — the deployed function reads secrets/env from telnyx.toml + `telnyx-edge secret set`
```

## Running the sample

Install dependencies and verify locally:

```bash
npm install
npm run typecheck
npm test
```

Deploy to Telnyx Edge:

```bash
npm run deploy        # telnyx-edge ship
```

The CLI prints the function URL, e.g. `https://conference-agent-mediator-<id>.telnyxcompute.com`.

Set secrets on the function:

```bash
telnyx-edge secret set TELNYX_API_KEY your_telnyx_api_key
telnyx-edge secret set SMS_FROM +16282564655
telnyx-edge secret set SMS_TO +17177247292
```

## Demo mode vs live mode

By default the sample runs in **safe demo mode** (`DEMO_MODE=true`). In demo mode:

- The demo simulator drives the exact same agent pipeline as live webhooks — participants, transcripts, mediator prompts, LLM summary, storage — with no real calls.
- SMS summaries are recorded in agent state (`smsSent=false`, event `sms_skipped_demo`) instead of being sent.
- Mediator prompts are recorded as `[mediator]` turns in the transcript instead of being spoken into a bridge.

To switch to **live mode**, set `DEMO_MODE=false`:

```bash
telnyx-edge secrets add DEMO_MODE false   # wins over the toml — no redeploy needed
# flip back: telnyx-edge secrets delete DEMO_MODE
```

In live mode the app performs the full telephony orchestration:

1. **Dial-in → bridge**: `call.initiated` → answer; `call.answered` → the first caller's leg **creates the conference bridge**, later callers `join_conference` onto it, and every leg gets `transcription_start` with `client_state` routing.
2. **Agent joins**: `conference.created` spawns the agent, which **greets the bridge** via conference speak.
3. **Live mediation**: every 30s the durable timer checks silence clocks; anyone silent > 60s gets an **LLM-crafted prompt spoken into the conference** (Telnyx Ultra TTS: `Telnyx.Ultra.3e1ed423-17e5-4773-b87c-25b031106e41`).
4. **Real summary SMS**: `conference.ended` → LLM summary → SMS via the zero-credential messaging binding.

Always test in demo mode first to avoid unexpected charges.

## Observers: WebSocket live transcript

The agent exposes its state over the **agent socket mount** at `wss://<fn-host>/agents/conference/{id}`. On connect: a full state snapshot plus `hello`. On every state change: an RFC 7396 merge-patch frame. Observers — dashboards, note-takers, monitoring bots — receive the transcript, mediator prompts, phase, and summary in real time with no polling. The bundled dashboard connects with a ~20-line browser client; a raw client is equally simple:

```js
const ws = new WebSocket("wss://<fn-host>/agents/conference/demo-abc123");
ws.onmessage = (e) => {
  const f = (JSON.parse(e.data)).json; // mount wraps frames in {"json": ...}
  if (f.kind === "state") {
    if (f.snapshot) render(f.snapshot);
    else if (f.patch) render(mergePatch(localState, f.patch));
  }
};
```

## How the code is structured

The entry point is `src/index.ts`. It exports the default Edge app handler and routes health, webhook, demo, query, and dashboard traffic to the actors declared in `telnyx.toml`.

### 1. Call Control — conference lifecycle and speak

The webhook handler at `/webhooks/voice` consumes Telnyx conference events:

- `conference.created` / `conference.start` — spawns the agent and arms its mediation timer
- `conference.participant.joined` / `left` — tracks the silence clock per participant
- `call.transcription` — feeds finalized utterances into the transcript
- `conference.ended` — finalizes: summary → storage → SMS

In live mode the agent injects prompts with the Call Control **conference speak** command (`/v2/conferences/{id}/actions/speak`, voice `female`, `en-US`).

### 2. Agent SDK — `ConferenceAgent` with durable conversation state

`ConferenceAgent extends Agent<ConferenceEnv, ConferenceState>` (one actor instance per conference, keyed by a Dapr-safe conference id). It maintains:

- **Participant tracking** — a map of participant → last-spoken timestamp
- **Transcript buffer** — every turn, including the mediator's own prompts
- **Prompt bookkeeping** — a 5-minute re-prompt cooldown per participant

The agent's surface (called over actor stubs from the router):

- `onConferenceStart()` — initializes state, arms `every(30, "mediate")` — a **durable timer that survives crashes and restarts**
- `addParticipant()` / `removeParticipant()` — join/leave tracking
- `onTranscript()` — appends utterances and refreshes the speaker's silence clock
- `mediate()` — every 30s, finds participants silent > 60s and prompts them back in
- `onConferenceEnd()` — cancels the timer and queues the finalize pipeline
- `summarize()` → `store()` → `notify()` — LLM summary, per-actor SQL + registry write, SMS (skipped in demo)

### 3. Inference — zero-credential LLM

Both the turn-taking prompt and the post-conference summary run through the `[telnyx]` binding (`this.env.TELNYX.ai.openai.chat.createCompletion`) — no API keys in code, no separate LLM account. The mediator sends the transcript so far plus the silent participant's name and asks for one short, warm invitation sentence; with no transcript it falls back to a neutral template.

### 4. Observers — dashboard + polling endpoints

- `GET /conferences/{id}/transcript?since=<epoch-ms>` — incremental turn feed for pollers
- `GET /conferences/{id}` — full state snapshot (phase, prompts, summary, error)
- `GET /conferences` — finished-conference list from the shared `ConferenceRegistry` actor
- `GET /` — a single-page dashboard that drives the demo simulator and polls the live transcript

## End-to-end flow

1. Start a demo conference (`POST /demo/conference`) — or create a real one whose Call Control application posts to `/webhooks/voice`.
2. The router spawns a `ConferenceAgent` for that conference and arms the 30s mediator.
3. Participants join; their silence clocks start (`join`, or `conference.participant.joined`).
4. Utterances flow in (`say`, or `call.transcription`) and update both the transcript and the speaker's clock.
5. Every 30s the mediator checks for silent participants; anyone silent > 60s gets an LLM-crafted nudge, recorded as a `[mediator]` turn (spoken into the bridge in live mode).
6. On `end` (`conference.ended`), the agent summarizes the transcript via the LLM, stores the row in per-actor SQL + the registry, and sends the summary via SMS (logged in demo mode).

## Verifying it works

After deploying:

1. `curl $BASE/health/readiness` → `{"status":"ok","demoMode":true}`
2. Run the demo walkthrough in the README's Setup section — start, join, say, end.
3. Watch `GET /conferences/$CONF/transcript` — transcript turns appear, and after a couple of minutes (or immediately after `end`) the mediator/summary entries show up.
4. `GET /conferences` lists the finished conference with its summary.

## Next steps

- [Telnyx Call Control Conferences docs](https://developers.telnyx.com/docs/voice/programmable-voice/conferences)
- [Telnyx Edge / Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Telnyx Inference](https://developers.telnyx.com/docs/inference)
- [Telnyx SMS API](https://developers.telnyx.com/docs/messaging)
- [Telnyx WebSocket media streaming](https://developers.telnyx.com/docs/voice/media-streaming)
