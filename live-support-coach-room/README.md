---
name: live-support-coach-room
title: "Live Support Coach Room"
description: "A Telnyx Edge Agent that streams live AI support calls to a supervisor dashboard, injects coaching nudges mid-call, and escalates to a human via WebRTC."
language: typescript
framework: edge
telnyx_products: [AI Assistants, Call Control, WebRTC, Edge Compute, Agent SDK]
---

# Live Support Coach Room

A Telnyx Edge Agent that streams live AI support calls to a supervisor dashboard, injects coaching nudges mid-call, and escalates to a human via WebRTC.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the programmable voice, real-time event streaming, and edge compute primitives that let you build coaching surfaces directly into live AI conversations. Unlike generic cloud functions, Telnyx Edge Actors are stateful and durable, surviving platform restarts so a supervisor's view never loses context. The conversation event stream is a side channel: dropping it never affects call media, and the WebRTC JS SDK lets a human join an AI conversation as a first-class participant.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| Assistant `websocket_settings` (`wss://…/agents/assist`) | WebSocket | Receives `session.created`, `conversation.item.created`, `response.text.delta`, `telnyx.call.*`, `session.ended` per conversation |
| `conversation.item.create` (injected back over the stream) | WebSocket | Coach nudge — the assistant pivots mid-call |
| `POST /v2/calls` | POST | Dials the supervisor's device via Call Control ([API reference](https://developers.telnyx.com/api-reference/call-commands/creat-call)) |
| `POST /calls/{call_control_id}/actions/ai_assistant_join` | POST | Joins the supervisor leg into the live AI conversation ([API reference](https://developers.telnyx.com/api-reference/call-commands/join-ai-assistant-conversation)) |
| `wss://…/agents/coach-room/{conversation_id}` | WebSocket | Supervisor dashboard — live transcript, flags, nudges |
| WebRTC JS SDK (`TelnyxRTC`) | Browser | Supervisor softphone — answers the escalation call muted, unmutes once joined |

## Architecture

```
Support assistant ──wss (websocket_settings → /agents/assist)──> AssistRelay actor
   one static URL, one socket per conversation; relay routes by conversation id
        │  session.created → COACHROOMS.idFromName(conversation_id)
        ▼
┌────────────────────────────────────────────────────────────┐
│  CoachRoom actor (one per conversation, durable)           │
│  ├── AgentSocketServer desk ──wss──> supervisor dashboard   │
│  │     /agents/coach-room/{id} (snapshot + live patches)    │
│  ├── policy watcher → inject frames → conversation.item.create │
│  ├── silence watcher (durable schedule, cancelled on end)   │
│  └── @rpc joinCall → Call Control dial → ai_assistant_join  │
│  coach_log row → per-actor SQL on session.ended             │
└────────────────────────────────────────────────────────────┘
        ▼
CoachRegistry actor — /rooms (live + ended rooms for the picker)
        ▼
Supervisor softphone (WebRTC JS SDK) joins as a live participant
```

The event stream is a side channel — dropping it never affects the call. The relay owns socket auth and routing; the room owns the nudge policy, coach log, and escalation; the WebRTC leg is the human path.

## Environment Variables / Secrets

Set secrets via the Edge CLI:

```bash
telnyx-edge secrets add COACH_AUTH "<integration-secret-value>"
```

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123...` | **yes** | Telnyx API v2 key (secret; used by `ai_assistant_join`) | [Portal](https://portal.telnyx.com/api-keys) |
| `CALL_CONTROL_CONNECTION_ID` | `string` | `your_call_control_connection_id_here` | **yes** | Outbound voice profile connection for the escalation dial | [Portal](https://portal.telnyx.com) → Voice |
| `TELNYX_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Caller ID for the escalation dial | [Portal](https://portal.telnyx.com) → Numbers |
| `SUPERVISOR_DEVICE` | `string` | `+1555XXXXXXXX` | **yes** | Supervisor's device (WebRTC softphone or phone) the dial targets | — |
| `COACH_AUTH` | `string` | `your_integration_secret_value_here` | **yes** | `auth_ref` value Telnyx sends as `Authorization: Bearer` on the stream; also the dashboard `?token=` | Create an [integration secret](https://developers.telnyx.com/docs/inference/ai-assistants/integrations) |
| `NUDGE_MAX_PER_CALL` | `string` | `3` | no | Max coach nudges per conversation (default `3`) | — |
| `SILENCE_SECS` | `string` | `90` | no | Silence duration before a check-in nudge (default `90`) | — |
| `DASHBOARD_ORIGIN` | `string` | `https://coach.example.com` | no | Allowed origin note for browser-based dashboards | — |

> **Agent / CLI access**
>
> ```bash
> # Provision a number + connection for the escalation dial
> telnyx number-orders create              # buy the TELNYX_NUMBER
> telnyx voice-applications create         # create the Call Control connection
> # Register runtime config as secrets (read via SECRETS.get in the actors)
> telnyx-edge secrets add TELNYX_API_KEY "<your_key>"
> telnyx-edge secrets add CALL_CONTROL_CONNECTION_ID "<conn-id>"
> telnyx-edge secrets add TELNYX_NUMBER "+1555XXXXXXXX"
> telnyx-edge secrets add SUPERVISOR_DEVICE "+1555XXXXXXXX"
> telnyx-edge secrets add COACH_AUTH "<integration-secret-value>"
> # Optional knobs (also accepted as env_vars in telnyx.toml)
> telnyx-edge secrets add NUDGE_MAX_PER_CALL 3
> telnyx-edge secrets add SILENCE_SECS 90
> ```

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/live-support-coach-room

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# 4. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# 5. Create the edge function and stamp it into telnyx.toml
telnyx-edge new-func -l ts -n live-support-coach-room --from-dir .

# 6. Register the secrets (see "Agent / CLI access" above)
telnyx-edge secrets add TELNYX_API_KEY "<your_key>"
telnyx-edge secrets add COACH_AUTH "<integration-secret-value>"
# …and the escalation secrets (CALL_CONTROL_CONNECTION_ID, TELNYX_NUMBER, SUPERVISOR_DEVICE)

# 7. Generate type bindings
telnyx-edge types

# 8. Run the smoke test
npx tsx smoke_test.ts

# 9. Deploy
telnyx-edge ship
```

`ship` prints a URL like `live-support-coach-room-<id>.telnyxcompute.com`.

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Point an AI assistant's event stream at the relay (websocket_settings)
curl -X POST https://api.telnyx.com/v2/ai/assistants/{assistant_id} \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "websocket_settings": {
      "enabled": true,
      "url": "wss://live-support-coach-room-<id>.telnyxcompute.com/agents/assist",
      "auth_ref": "<your COACH_AUTH integration secret>"
    }
  }'

# Inspect rooms / health
curl https://live-support-coach-room-<id>.telnyxcompute.com/health/liveness
curl https://live-support-coach-room-<id>.telnyxcompute.com/rooms
```

</details>

### The two-tab demo

1. Open `<fn-url>/caller` in one tab — the **caller simulator**.
2. Open `<fn-url>/dashboard` in the second tab — the **supervisor dashboard**.
3. In the caller tab: **Start simulated call**, then send caller turns. Try saying "my account number is 5521890244" twice — the room injects the DOB nudge, visible in both tabs.
4. In the dashboard tab: enter the `COACH_AUTH` value, pick the room, watch the live transcript; **Escalate to supervisor** dials your softphone and joins it into the AI conversation.
5. For the live path (real calls), point the assistant's `websocket_settings` at `<fn-host>/agents/assist` — see `GUIDE.md`.

For the full walkthrough, see [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/live-support-coach-room/GUIDE.md); the typed endpoint reference is in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/live-support-coach-room/API.md).

## API Reference

| Route | Method | Purpose |
|---|---|---|
| `/agents/assist` | WebSocket | Assistant event-stream sink (`websocket_settings.url`) |
| `/agents/coach-room/{id}` | WebSocket | Supervisor room view (snapshot + live patches) |
| `/rooms` | GET | Live + ended rooms for the shift |
| `/rooms/{id}/join` | POST | Escalation: dial supervisor + `ai_assistant_join` |
| `/rooms/{id}/snapshot` | GET | Current room snapshot |
| `/rooms/{id}/log` | GET | `coach_log` audit rows for that room's actor |
| `/demo/start` | POST | Start a simulated conversation (caller simulator) |
| `/demo/say` | POST | Inject a caller turn |
| `/demo/assistant-say` | POST | Inject an assistant turn |
| `/demo/end` | POST | End the simulated call (files the coach_log row) |
| `/dashboard`, `/caller` | GET | Browser surfaces |
| `/health/{liveness,readiness}` | GET | Health checks |

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Stream socket rejected (`401/1008`) | `COACH_AUTH` mismatch | Assistant `auth_ref` and the `?token=` must equal the `COACH_AUTH` secret |
| No rooms listed | No `session.created` seen | Check the assistant's `websocket_settings` is enabled and points at `/agents/assist` |
| Nudge not injected | Budget exhausted or oversized frame | `NUDGE_MAX_PER_CALL` caps injections per call; frames are capped at 1 MiB |
| Escalation returns 4xx | Secrets missing | Register `CALL_CONTROL_CONNECTION_ID`, `TELNYX_NUMBER`, `SUPERVISOR_DEVICE` via `telnyx-edge secrets add` |
| Supervisor audio muted | Softphone answers muted by design | Unmutes automatically once `ai_assistant_join` completes |
| Coach server killed mid-call | Side-channel guarantee | The call continues; Telnyx reconnects with exponential backoff (1s → 30s); the dashboard resyncs without replay |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [Post-Call QA Scoring (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/post-call-qa-scoring/README.md) — post-call grading on the same Agent SDK primitives
- [Conference Agent Mediator (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-agent-mediator/README.md) — real-time transcript + supervisor surface over the agent socket mount
- [Edge Call Transcription Agent (TypeScript)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-call-transcription-agent/README.md) — live call transcription on Edge Compute

## Resources

- [AI Assistants — Conversation Event Stream](https://developers.telnyx.com/docs/inference/ai-assistants/conversation-event-stream)
- [AI Assistants — Multi-Participant Calls](https://developers.telnyx.com/docs/inference/ai-assistants/multi-participant-calls)
- [Join AI Assistant Conversation API](https://developers.telnyx.com/api-reference/call-commands/join-ai-assistant-conversation)
- [WebRTC JS SDK — Make Your First Call](https://developers.telnyx.com/docs/development/webrtc/js-sdk/tutorials/make-your-first-call)
- [WebRTC JS SDK — Call Reference](https://developers.telnyx.com/docs/development/webrtc/js-sdk/reference/call)
- [Agent SDK — WebSockets](https://developers.telnyx.com/docs/agent-sdk/websockets)
- [Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Pricing](https://telnyx.com/pricing)
