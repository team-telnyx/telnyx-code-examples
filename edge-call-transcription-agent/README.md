---
name: edge-call-transcription-agent
title: "Edge Call Transcription Agent"
description: "Live call transcription agent on Telnyx Edge Compute + Agent SDK — answers an inbound call, streams STT into durable agent state, and on hangup summarizes the transcript via LLM, persists it to actor-local SQL, and texts the summary via SMS. Zero-credential inference and messaging via the [telnyx] binding."
language: typescript
framework: telnyx-edge (Agent SDK)
telnyx_products: [Edge Compute, Voice, AI Inference, Messaging]
channel: [voice, sms]
---

# Edge Call Transcription Agent

Live call transcription agent on Telnyx Edge Compute + Agent SDK — answers an inbound call, streams speech-to-text into durable agent state (one actor per call), and on hangup runs a non-blocking pipeline that summarizes the transcript via LLM, persists the transcript + summary to actor-local SQL, and texts the summary to a configured recipient via SMS. Uses the `[telnyx]` binding for zero-credential inference and messaging — no API key in code for the LLM or the SMS send.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — voice, messaging, SIP, AI, and IoT on one private, global network. This example composes Call Control (answer + streaming STT), AI Inference (LLM summary), Messaging (SMS delivery), and Stateful Actors on Edge Compute (durable transcript + per-call SQL) in a single deployable function — the kind of full-stack live-call workflow that only Telnyx can ship because we own the telephony network, the inference layer, and the edge runtime.

## Telnyx API Endpoints Used

- **Call Control**: `POST /v2/calls/{call_control_id}/actions/answer` — answer the inbound call
- **Call Control TTS**: `POST /v2/calls/{call_control_id}/actions/speak` — speak a short greeting to set caller expectations
- **Call Control Transcription**: `POST /v2/calls/{call_control_id}/actions/transcription_start` — streaming STT (Telnyx engine, inbound track)
- **Call Control Transcription**: `POST /v2/calls/{call_control_id}/actions/transcription_stop` — stop STT cleanly before hangup
- **AI Inference**: `POST /v2/ai/openai/chat/completions` — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated binding, zero-credential) — post-call summary
- **Messaging**: `POST /v2/messages` — via `this.env.TELNYX.messages.send()` (pre-authenticated binding, zero-credential) — SMS the summary

## Architecture

```
   Inbound call → webhook → TranscribeAgent actor (one per call_control_id)
         │
         ▼
   ┌────────────────────────────────────────────────────────────┐
   │ call.initiated       → recordStart()  + answer()           │
   │ call.answered        → speak(greeting)                     │
   │ call.speak.ended     → transcription_start()                │
   │ call.transcription (interim)                               │
   │   → appendTranscript(text, is_final=false)                 │
   │ call.transcription (final)                                 │
   │   → appendTranscript(text, is_final=true)                   │
   │     (state.transcriptText accumulates caller's final STT)   │
   │ call.hangup          → onHangup() → queue("summarize")     │
   └────────────────────────────────────────────────────────────┘
         │
         ▼   non-blocking pipeline (durable across restarts)
   ┌────────────────────────────────────────────────────────────┐
   │ summarize()                                                 │
   │   → this.env.TELNYX.ai.openai.chat.createCompletion()       │
   │   → store summary in state                                  │
   │ store()                                                     │
   │   → this.ctx.storage.sql (per-call row)                     │
   │   → TranscriptRegistry actor ("global") — cross-call index  │
   │ notify()                                                    │
   │   → this.env.TELNYX.messages.send({ from, to, text })       │
   │   → setState({ phase: "done" })                             │
   └────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Required | Description | Where to get it |
|----------|------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | secret | **yes** | Telnyx API key for Call Control REST (answer, speak, transcription, hangup) | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | env_var | no | LLM model name for post-call summary (default: `zai-org/GLM-5.2`) | [Models](https://developers.telnyx.com/docs/inference/models) |
| `SMS_FROM` | env_var | **yes** | Telnyx number to send the SMS summary from (must have messaging + 10DLC campaign attached) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `SMS_TO` | env_var | **yes** | Recipient phone — where the post-call summary is sent (E.164, e.g. `+17177247292`) | your mobile number |
| `[telnyx]` binding | toml | **yes** | Pre-authenticated Telnyx client for zero-credential LLM inference + SMS | `telnyx.toml` |

> **Agent / CLI access**
>
> ```bash
> # Buy a number for the transcription agent to answer
> telnyx number-orders create --phone-number "+16282564655"
>
> # Create a Call Control application pointing at your webhook
> telnyx call-control-applications create \
>   --application-name "call-transcription-agent" \
>   --webhook-url "https://edge-call-transcription-agent-<id>.telnyxcompute.com/webhooks/voice"
>
> # List your numbers
> telnyx numbers list
> ```

## Setup

### Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx phone number with a Call Control application (for live calls)
- A Telnyx number with SMS capability + 10DLC campaign attached (for SMS delivery)

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-call-transcription-agent
npm install
```

### 2. Configure secrets and env

```bash
# Set your Telnyx API key as a secret on the Edge Compute function
telnyx-edge secret set TELNYX_API_KEY your_telnyx_api_key

# SMS sender (Telnyx number with messaging + 10DLC campaign)
telnyx-edge secret set SMS_FROM +1333377777

# SMS recipient (your mobile, E.164)
telnyx-edge secret set SMS_TO +173636474849
```

<details><summary>Programmatic / CLI setup</summary>

```bash
# Buy a number (if you don't have one)
telnyx number-orders create --phone-number "+13333777773"

# Create a Call Control application
telnyx call-control-applications create \
  --application-name "call-transcription-agent" \
  --webhook-url "https://edge-call-transcription-agent-<id>.telnyxcompute.com/webhooks/voice"

# Assign the number to the application
telnyx numbers update +13333777773 --connection-id <call_control_app_id>

# Verify the number can send SMS (10DLC campaign attached)
telnyx messaging-profiles list
```

</details>

### 3. Deploy

```bash
telnyx-edge ship
```

`ship` prints a URL like `edge-call-transcription-agent-<id>.telnyxcompute.com`.

### 4. Point your Call Control webhook

In the [Telnyx Portal](https://portal.telnyx.com):
1. Create or edit a Call Control application assigned to your Telnyx number
2. Set the **Webhook URL** → `https://edge-call-transcription-agent-<id>.telnyxcompute.com/webhooks/voice`

### 5. Test

```bash
# Health check
curl https://edge-call-transcription-agent-<id>.telnyxcompute.com/health/liveness

# Call your Telnyx number from your phone — the agent answers, greets, and
# transcribes. Hang up to trigger summarize → store → SMS.

# Inspect live state during/after a call
curl "https://edge-call-transcription-agent-<id>.telnyxcompute.com/debug/state?call_control_id=<your_call_id>"

# List recent transcripts (across all calls)
curl https://edge-call-transcription-agent-<id>.telnyxcompute.com/transcripts
```

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-call-transcription-agent/API.md) for the full typed endpoint reference.

### `POST /webhooks/voice`

Receives Telnyx Call Control webhooks and drives the transcription pipeline. Events handled:

| Event | Action |
|-------|--------|
| `call.initiated` | Record start, answer the call, create per-call SQL row |
| `call.answered` | Speak a short greeting to set caller expectations |
| `call.speak.ended` (greeting) | Start streaming transcription (Telnyx engine, inbound track) |
| `call.transcription` (interim or final) | Append transcript fragment to durable agent state |
| `call.hangup` | Stop transcription, queue the finalize pipeline (summarize → store → notify) |

### `GET /transcripts`

List recent transcripts across all calls (most recent first).

```bash
curl https://edge-call-transcription-agent-<id>.telnyxcompute.com/transcripts?limit=50
```

### `GET /transcripts/:call_control_id`

Fetch a single stored transcript + summary.

```bash
curl https://edge-call-transcription-agent-<id>.telnyxcompute.com/transcripts/v3:550e8400-e29b-41d4-a716-446655440000
```

### `GET /debug/state?call_control_id=...`

Inspect the live agent state for a call (phase, segments, accumulated transcript, summary, error).

```bash
curl "https://edge-call-transcription-agent-<id>.telnyxcompute.com/debug/state?call_control_id=v3:abc123"
```

### `GET /health/{liveness,readiness}`

Health checks.

```bash
curl https://edge-call-transcription-agent-<id>.telnyxcompute.com/health/liveness
```

## How It Works

1. **Inbound call** → Telnyx sends `call.initiated` → the webhook handler creates a `TranscribeAgent` actor keyed by `call_control_id`, calls `recordStart()`, and answers the call
2. **Greeting** → on `call.answered`, the handler speaks a short greeting ("Hi, I'm a Telnyx transcription agent…") so the caller knows their speech is being transcribed
3. **Streaming STT** → when the greeting finishes (`call.speak.ended`), the handler starts streaming transcription (Telnyx engine, inbound track only) — caller's speech is delivered as `call.transcription` events with `is_final` true/false
4. **Durable transcript** → each `call.transcription` event is appended to the actor's durable state via `appendTranscript(text, isFinal)`. Final segments accumulate into `state.transcriptText`; interim segments are kept in `state.segments` for the live dashboard
5. **Hangup** → on `call.hangup`, the handler stops transcription and calls `onHangup()` on the actor. The actor queues the non-blocking finalize pipeline (summarize → store → notify) — durable across restarts
6. **Summarize** → `summarize()` calls `this.env.TELNYX.ai.openai.chat.createCompletion()` (zero-credential binding) with a system prompt that produces a 1–3 sentence SMS-friendly summary
7. **Store** → `store()` writes a row to the actor's per-call SQL via `this.ctx.storage.sql` and upserts the same record into the shared `TranscriptRegistry` actor (the "global" instance) so `/transcripts` can list across calls
8. **Notify** → `notify()` calls `this.env.TELNYX.messages.send({ from: SMS_FROM, to: SMS_TO, text: summary })` — the SMS summary lands in the recipient's inbox

## Agent SDK Primitives Used

| Primitive | API | What it does |
|-----------|-----|--------------|
| Durable State | `this.setState()` / `this.getState()` | Per-call transcript accumulation (segments, transcriptText, phase) |
| Pipeline | `this.queue("summarize")` / `this.queue("store")` / `this.queue("notify")` | Non-blocking finalize stages after hangup |
| Actor-Local SQL | `this.ctx.storage.sql.exec(...)` | Per-call transcript row + shared `TranscriptRegistry` for cross-call listing |
| Telnyx Binding | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential LLM inference for the summary |
| Telnyx Binding | `this.env.TELNYX.messages.send()` | Zero-credential SMS delivery |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Call answers but no transcription events | Wrong transcription track | Ensure `transcription_tracks: "inbound"` — caller audio only |
| LLM returns empty summary | Model unavailable or empty transcript | Check `AI_MODEL` — try `zai-org/GLM-5.2`; verify the call had speech before hangup |
| No SMS received | `SMS_FROM` not set or no 10DLC campaign | Set a Telnyx number with messaging + 10DLC campaign attached |
| `404 page not found` | Function still deploying | Wait ~30s, then retry |
| Actor not processing | `[telnyx]` binding missing | Ensure `telnyx.toml` has `[telnyx] binding = "TELNYX"` |
| `TELNYX_API_KEY not configured` | Secret not set | Run `telnyx-edge secret set TELNYX_API_KEY <key>` |
| `/transcripts` returns empty | No calls have hung up yet | Each call only stores after `call.hangup` triggers the finalize pipeline |

## Related Examples

- [Edge Voice Agent That Holds a Call (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voice-agent-holds-call/README.md) — the conversational sibling: STT → LLM → TTS reply loop on a live call
- [Audio Transcribe → Summarize → SMS (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/audio-transcribe-summarize-sms/README.md) — the offline sibling: uploaded audio file → STT → LLM summary → SMS
- [Sentiment Analysis Agent (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sentiment-analysis-agent/README.md) — actor-local SQL + LLM classification pattern
- [Multi-Model Inference Switcher (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/README.md) — KV-flagged LLM model selection
- [SMS Support Agent with Follow-Up (TypeScript, Agent SDK)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-support-agent-with-followup/README.md) — Agent SDK + scheduled follow-ups

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK Quickstart](https://developers.telnyx.com/docs/agent-sdk/quickstart)
- [Roll Your Own Agent](https://developers.telnyx.com/docs/agent-sdk/examples/roll-your-own)
- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-control)
- [Streaming Transcription Guide](https://developers.telnyx.com/docs/voice/programmable-voice/transcription)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Voice AI product page](https://telnyx.com/products/voice-ai-agents)
- [SMS API product page](https://telnyx.com/products/sms-api)
- [Telnyx pricing](https://telnyx.com/pricing)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
