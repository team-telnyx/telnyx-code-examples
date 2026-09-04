---
name: conference-agent-mediator
title: "Conference Agent Mediator"
description: "An AI meeting facilitator on Telnyx Edge that joins conference calls, transcribes participants in real time, mediates turn-taking, and sends post-call summaries via SMS."
language: typescript
framework: edge
telnyx_products: ["Call Control", "Agent SDK", "Inference", "Messaging"]
---

# Conference Agent Mediator

An AI meeting facilitator on Telnyx Edge Compute that joins conference calls, transcribes participants in real time, mediates turn-taking so nobody is left out, and delivers a post-conference summary via SMS — with a built-in demo simulator so you can exercise the full pipeline without live calls.

## Why Telnyx

Telnyx provides a unified AI Communications Infrastructure platform that bridges programmable voice (Call Control), real-time AI inference, and messaging. This sample orchestrates those primitives on the Telnyx Edge runtime as durable Stateful Actors: state survives restarts, timers (`every`) survive crashes, and LLM inference + SMS run over zero-credential bindings — no separate servers, queues, or webhook receivers to manage.

## Telnyx API Endpoints Used

- **Call Control: Calls** — answer inbound dial-ins, `join_conference`, `transcription_start` (stream STT to the agent).
- **Call Control: Conferences** — create the conference bridge on the first dial-in; lifecycle events (`conference.created`, `conference.participant.joined/left`, `conference.ended`) drive the agent; `conference speak` injects LLM-crafted prompts into the live bridge.
- **Call Control: Streaming Transcription** — `call.transcription` events feed finalized utterances into the agent.
- **Agent SDK** — `class ConferenceAgent extends Agent` — durable state, SQL storage, crash-safe `every(30s)` mediation timers, and the built-in **agent socket** connection surface (`AgentSocketServer`) for WebSocket observers.
- **AI Inference** — zero-credential `[telnyx]` binding (`ai.openai.chat.createCompletion`) for prompt crafting and post-conference summaries.
- **Programmable SMS** — zero-credential `[telnyx]` binding (`messages.send`) for the post-conference summary.
- **WebSocket (agent socket mount)** — `wss://…/agents/conference/{id}` pushes a state snapshot on connect and an incremental merge-patch on every state change: live transcript, mediator prompts, phase, and summary stream to observers in real time.

## Architecture

```text
+-------------------+       +--------------------------+       +-------------------+
| PSTN / SIP        |       | Telnyx Edge Compute      |       | Observer          |
| Participants      |       | (src/index.ts)           |       | (Dashboard/CLI)   |
+--------+----------+       +------------+-------------+       +---------+---------+
         |                               |                               |
         |  (conference events)          |                               |
         +------------------------------>|  /webhooks/voice              |
                                         |                               |
                               +---------v----------+                    |
                               | ConferenceAgent    |                    |
                               | (1 actor/conf,     |                    |
                               |  durable state)    |                    |
                               +--+--------------+--+                    |
              transcription      |              |  every(30s)             |
              events (STT)       |              |  mediate()              |
         +---------------------->+     +--------v--------+                |
         |                       |     | LLM-crafted     |                |
   +-----+-------+               |     | prompt → conf   |                |
   | Inference   |               |     | speak (live)    |                |
   | (STT + LLM) |<==============+     +-----------------+                |
   +-------------+                       |                               |
                                         | conference.ended              |
                               +---------v----------+                    |
                               | summarize → store  |                    |
                               | → SMS (live)       +------------------->|
                               +--------------------+   GET /conferences  |
```

## Environment Variables

| Variable | Type | Required | Description | Where to get it |
|----------|------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | secret | **yes** | Telnyx API key for conference speak (live mode) | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | env_var | no | Telnyx-hosted LLM for prompts + summaries (default: `zai-org/GLM-5.2`) | [Models](https://developers.telnyx.com/docs/inference/models) |
| `SMS_FROM` | env_var | **yes** | Telnyx number the summary SMS is sent from (messaging + 10DLC campaign for US delivery) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `SMS_TO` | env_var | **yes** | Recipient of the post-conference summary SMS (E.164) | your mobile number |
| `DEMO_MODE` | env_var/secret | no | `true` (default) = no live Call Control/SMS side effects; `false` = live. Flip at runtime with `telnyx-edge secrets add DEMO_MODE false` — the secret wins over the toml, no redeploy needed | set in `telnyx.toml` |
| `[telnyx]` binding | toml | **yes** | Pre-authenticated Telnyx client for zero-credential LLM inference + SMS | `telnyx.toml` |

> **Agent / CLI access**
>
> ```bash
> # Buy a Telnyx number for the conference bridge / SMS sender
> telnyx number-orders create --phone-number "+16282564655"
>
> # Create a Call Control application pointing at your webhook
> telnyx call-control-applications create \
>   --application-name "conference-agent-mediator" \
>   --webhook-url "https://conference-agent-mediator-<id>.telnyxcompute.com/webhooks/voice"
>
> # Attach the number to the application + messaging profile
> telnyx numbers list
> telnyx messaging-profiles list
> ```

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx number with SMS capability + 10DLC campaign (for live SMS summaries)
- A Call Control application wired to a conference-enabled number (for live conferences)

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/conference-agent-mediator
npm install
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Buy a number (if you don't have one)
telnyx number-orders create --phone-number "+13333777773"

# Create a Call Control application
telnyx call-control-applications create \
  --application-name "conference-agent-mediator" \
  --webhook-url "https://conference-agent-mediator-<id>.telnyxcompute.com/webhooks/voice"

# Assign the number to the application
telnyx numbers update +13333777773 --connection-id <call_control_app_id>

# Verify the number can send SMS (10DLC campaign attached)
telnyx messaging-profiles list
```

</details>

### 2. Configure secrets and env

```bash
# Set your Telnyx API key as a secret on the Edge Compute function
telnyx-edge secret set TELNYX_API_KEY your_telnyx_api_key

# SMS sender (Telnyx number with messaging + 10DLC campaign)
telnyx-edge secret set SMS_FROM +16282564655

# SMS recipient (your mobile, E.164)
telnyx-edge secret set SMS_TO +17177247292
```

`AI_MODEL`, `DEMO_MODE`, and the `[telnyx]` inference/messaging binding are configured in `telnyx.toml`.

### 3. Typecheck and smoke test

```bash
npm run typecheck
npm test
```

### 4. Deploy to Telnyx Edge

```bash
npm run deploy        # → telnyx-edge ship
```

The CLI prints the deployed function URL (`https://conference-agent-mediator-<id>.telnyxcompute.com`). Functions run on Telnyx infrastructure — there is no separate local dev server.

### 5. Run the demo (safe, no live calls)

```bash
BASE=https://conference-agent-mediator-<id>.telnyxcompute.com

curl $BASE/health/readiness

# Start a simulated conference, add participants, feed the transcript
CONF=$(curl -s -X POST $BASE/demo/conference -d '{"name":"Sprint Planning"}' | jq -r .conference_id)
curl -s -X POST $BASE/demo/conference/$CONF/join -d '{"name":"alice"}'
curl -s -X POST $BASE/demo/conference/$CONF/join -d '{"name":"bob"}'
curl -s -X POST $BASE/demo/conference/$CONF/say -d '{"speaker":"alice","text":"We need to ship the billing fix by Friday."}'
curl -s -X POST $BASE/demo/conference/$CONF/end

# Watch the transcript, mediator prompts, and LLM summary
curl -s $BASE/conferences/$CONF/transcript | jq
curl -s $BASE/conferences/$CONF | jq .summary
```

Or open `$BASE/` in a browser — the dashboard can start a demo conference, add participants, stream the transcript, and show the summary.

### Live mode

Set `DEMO_MODE=false` (`telnyx-edge secrets add DEMO_MODE false` — or flip the toml and redeploy). Live wiring:

1. Point a Call Control application's webhook at `<fn-url>/webhooks/voice` and attach your dial-in number.
2. Dial the number — `call.initiated` → the app answers, **creates a conference bridge** with your leg as participant #1, and starts streaming STT. A second dial-in **joins the same bridge**.
3. The agent greets the bridge, tracks participants and transcriptions, and every 30s **speaks an LLM-crafted prompt** into the conference for anyone silent past 60s.
4. End the call/conference — the LLM summary is generated, stored, and **texted via SMS**.
5. Watch it live: open `<fn-url>/` in a browser (WebSocket-driven dashboard), or connect a raw client to `wss://<fn-url-host>/agents/conference/{id}`.

The demo simulator always stays safe (`demo=true` at the agent) regardless of the live-mode flag.

## API Reference

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-agent-mediator/API.md) for the full typed endpoint reference. Summary:

| Route | Method | Purpose |
|-------|--------|---------|
| `/health/liveness` | GET | Liveness probe |
| `/health/readiness` | GET | Readiness + demo-mode flag |
| `/webhooks/voice` | POST | Telnyx Call Control / conference webhook receiver (call + conference lifecycle) |
| `/agents/conference/{id}` | WebSocket | Agent socket mount — live state snapshot + patches (transcript, phase, summary) |
| `/demo/conference` | POST | Start a simulated conference |
| `/demo/conference/{id}/join` | POST | Add a simulated participant |
| `/demo/conference/{id}/say` | POST | Feed a transcript utterance |
| `/demo/conference/{id}/end` | POST | End → summarize → store → (SMS) pipeline |
| `/conferences` | GET | List finished conferences (registry actor) |
| `/conferences/{id}` | GET | Full agent state snapshot |
| `/conferences/{id}/transcript?since=` | GET | Turn records after epoch ms (polling) |
| `/conferences/{id}/events?afterSeq=` | GET | Durable progress-event stream (mediation ticks, prompts, SMS) |
| `/` | GET | Live dashboard (demo controls + transcript + summary) |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `404 page not found` on the deployed URL | Function still deploying | Wait ~30s, then retry |
| `TELNYX_API_KEY not configured` | Secret not set on the function | `telnyx-edge secret set TELNYX_API_KEY <key>` |
| Demo pipeline stuck in `summarizing` | Inference binding slow or model unavailable | Retry after 30s; check `AI_MODEL` (try `zai-org/GLM-5.2`) |
| State shows `error: summarize: ...` | LLM call failed | Inspect `GET /conferences/{id}` `.error`; verify the `[telnyx]` binding in `telnyx.toml` |
| No SMS received (live mode) | `SMS_FROM` lacks messaging/10DLC campaign | Use a Telnyx number with an attached 10DLC campaign; verify `telnyx messaging-profiles list` |
| Mediator prompts never fire | Participants spoke within the 60s silence window | Prompts only fire for participants silent > 60s, with a 5-minute re-prompt cooldown |
| No prompts recorded in demo mode | Conference already ended | Mediation only runs while `phase === "active"`; start a new demo conference |
| Real conference events ignored (live mode) | Webhook not pointed at `/webhooks/voice` | Set the Call Control application webhook URL to `<fn-url>/webhooks/voice` |

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

- [Edge Call Transcription Agent (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-call-transcription-agent/README.md) — the 1:1-call sibling: answer → STT → LLM summary → SMS
- [Conference Call with AI Summary (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-call-with-ai-summary-python/README.md) — conference recording → AI summary without an in-call agent
- [AI Conference Note Taker (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-conference-note-taker-python/README.md) — note-taking variant of the same conference flow
- [Edge Voice Agent That Holds a Call (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voice-agent-holds-call/README.md) — STT → LLM → TTS reply loop on a live call
- [AI Conference Moderator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-conference-moderator-python/README.md) — DTMF/queue-based moderation alternative

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK Quickstart](https://developers.telnyx.com/docs/agent-sdk/quickstart)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Call Control Conferences Guide](https://developers.telnyx.com/docs/voice/programmable-voice/conferences)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-control)
- [Streaming Transcription Guide](https://developers.telnyx.com/docs/voice/programmable-voice/transcription)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Voice AI product page](https://telnyx.com/products/voice-ai-agents)
- [SMS API product page](https://telnyx.com/products/sms-api)
- [Telnyx pricing](https://telnyx.com/pricing)
