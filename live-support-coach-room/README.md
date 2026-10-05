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

## The Story

A regional urgent-care clinic relies on an AI assistant to triage patient calls after hours — routing appointment requests, collecting symptoms, and flagging cases that need a live nurse. If the assistant mishears a patient's account number or misses a refund request, the patient could be misfiled, billed incorrectly, or worse, given the wrong medical advice. The cost of failure is trust, compliance, and in the worst case, patient safety.

The actor IS the supervisor room for one support shift. Every support call's full conversation streams live to the coach dashboard over the assistant conversation event stream; the supervisor sees caller turns, assistant replies, and tool calls as they happen. The actor watches the feed for coaching triggers — identity-verification loop, refund promise, 90-second silence — and injects a whispered nudge into the live call via `conversation.item.create`. If the caller needs a human, it dials the supervisor's WebRTC softphone and joins that leg into the running AI conversation with `ai_assistant_join`. Coach-first support, live.

The actor is born when a call starts (`session.created`), evolves through every transcript delta and policy trigger, and either completes when the call ends (`session.ended`) or survives a platform reboot mid-batch — its durable state and scheduled tasks persist across restarts. When the coach server is killed mid-call, the call itself is untouched (side-channel guarantee); the dashboard reconnects and resumes the view without replaying backlog. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the programmable voice, real-time event streaming, and edge compute primitives that let you build coaching surfaces directly into live AI conversations. Unlike generic cloud functions, Telnyx Edge Actors are stateful and durable, surviving platform restarts so a supervisor's view never loses context. The conversation event stream is a side channel: dropping it never affects call media, and the WebRTC JS SDK lets a human join an AI conversation as a first-class participant.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| Assistant WebSocket (`wss://`) | WebSocket | Receives `session.created`, `conversation.item.created`, `response.text.delta`, `session.ended` event stream |
| `POST /v2/calls` | POST | Dials the supervisor's WebRTC device via Call Control |
| `POST /calls/{call_control_id}/actions/ai_assistant_join` | POST | Joins the supervisor leg into the live AI conversation |
| Agent Socket Server (`/ws`) | WebSocket | Fan-out to supervisor dashboard tabs |
| `GET /health` | GET | Health check |

## Architecture

```
Support Assistant
  │
  │ wss (websocket_settings → CoachRoom actor)
  ▼
┌─────────────────────────────────────────────────────────┐
│  CoachRoom Actor (Agent SDK)                             │
│  one actor per conversation (idFromName(conversationId)) │
│  ├── AgentSocketServer ──wss──> Supervisor Dashboard     │
│  │     (live transcript + policy flags)                  │
│  ├── NudgePolicy → conversation.item.create (whisper)    │
│  ├── SilenceWatcher (this.schedule)                      │
│  └── @rpc joinCall → Call Control dial → ai_assistant_join│
│                                                           │
│  SQL: coach_log(conversation_id, flags, nudges,          │
│       took_over, duration_sec)                           │
└─────────────────────────────────────────────────────────┘
  │
  │ WebRTC JS SDK
  ▼
Supervisor Softphone (new TelnyxRTC, client.newCall)
```

The event stream is a side channel — dropping it never affects the call. The actor owns the room registry, nudge policy, and coach log; the WebRTC leg is the human path.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `CALL_CONTROL_CONNECTION_ID` | `string` | `your_call_control_connection_id_here` | **yes** | CALL_CONTROL_CONNECTION_ID | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_NUMBER` | `string` | `your_telnyx_number_here` | **yes** | TELNYX_NUMBER | — |

## Setup

```bash
# Clone the repo
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/live-support-coach-room

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your Telnyx credentials

# Run the smoke test
npx tsx smoke_test.ts

# Deploy
telnyx-edge ship
```

## API Reference

See [API.md](./API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Supervisor dashboard shows no transcript | WebSocket connection rejected | Verify `COACH_AUTH` matches `auth_ref` in assistant `websocket_settings` |
| Nudge not injected | Rate limit exceeded (10 fps / 1 MiB) | Check `NudgePolicy.canNudge()` — reduce nudge frequency |
| `joinCall` RPC fails | No active conversation | Ensure `session.created` was received before calling |
| Coach server killed mid-call | Side-channel guarantee | Call continues; dashboard reconnects with exponential backoff |
| SQL insert fails | `coach_log` table missing | Run `CREATE TABLE` migration in `telnyx.toml` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-1191** — Post-call QA with conversation replay
- **DEV-831** — Conference mediation bot
- **DEV-596** — AI-initiated escalation (no supervisor surface)

## Resources

- [AI Assistants — Conversation Event Stream](https://developers.telnyx.com/docs/inference/ai-assistants/conversation-event-stream)
- [AI Assistants — Multi-Participant Calls](https://developers.telnyx.com/docs/inference/ai-assistants/multi-participant-calls)
- [Join AI Assistant Conversation API](https://developers.telnyx.com/api-reference/call-commands/join-ai-assistant-conversation)
- [WebRTC JS SDK — Make Your First Call](https://developers.telnyx.com/docs/development/webrtc/js-sdk/tutorials/make-your-first-call)
- [WebRTC JS SDK — Call Reference](https://developers.telnyx.com/docs/development/webrtc/js-sdk/reference/call)
- [Agent SDK — WebSockets](https://developers.telnyx.com/docs/agent-sdk/websockets)
- [Edge Compute — Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Pricing](https://telnyx.com/pricing)
