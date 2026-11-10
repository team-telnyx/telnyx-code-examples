---
name: acp-business-line
title: "Turn a phone number into an AI business line with the Telnyx Agent Control Plane"
description: "Declare a clinic appointment-intake agent in configuration — agent.json plus instructions.md, no application code — and answer calls and texts on one number with the Agent Control Plane."
language: acp
framework: agent-control-plane
telnyx_products: [Agent Control Plane, AI Inference, Voice AI]
channel: [voice, sms]
---

# Turn a phone number into an AI business line with the Telnyx Agent Control Plane

> **Beta.** The Agent Control Plane is in beta; behavior and CLI flags can change between releases. See the [beta limitations](https://developers.telnyx.com/docs/agents/beta-limitations).

A clinic's website lists one phone number. In this example that number becomes an AI agent: it answers calls with a greeting, takes an appointment request (name, reason, preferred time), confirms it back, and hands off to the front desk — and it answers texts on the same number. There is no application code anywhere: the whole agent is one `agent.json` and one `instructions.md`, deployed with the `telnyx-acp` CLI.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, and AI inference run on the same private network, so a config-declared agent can answer live calls and texts with hosted STT, TTS, and models, without stitching together third-party providers.

## Telnyx API Endpoints Used

This example ships configuration, not code — the Agent Control Plane wires these endpoints for you when you run `telnyx-acp deploy`:

- **Telnyx Inference**: `POST /v2/ai/chat/completions` with the declared model (`zai-org/GLM-5.3-Flash`) — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Agent Memory**: conversation profiles per caller — [API reference](https://developers.telnyx.com/api-reference/agent-memory)
- **Call Control**: one application created and wired by `deploy` — [API reference](https://developers.telnyx.com/api-reference/call-control)
- **Messaging Profile**: one profile created and wired by `deploy` — [API reference](https://developers.telnyx.com/api-reference/messaging)

## Architecture

```
  Inbound call or text
        │
        ▼
  ┌─────────────────────┐
  │ Telnyx number        │  deploy wires Call Control app + messaging profile
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐      agent.json      ┌────────────────────┐
  │ Edge Compute function│ ◄────────────────────│ acp-business-line/ │
  │ (one instance per    │      instructions.md └────────────────────┘
  │  conversation)       │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ GLM-5.3-Flash        │  reply streamed sentence-by-sentence to TTS
  │ Telnyx STT / TTS     │  texts reply over the messaging profile
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ Agent Memory         │  profile per conversation — the caller's
  └─────────────────────┘  history comes back on their next call or text
```

One conversation is one instance: a text conversation is keyed by the sender's phone number (one instance per phone, kept across every text it sends); a call runs on its own per-call instance. Agent Memory is what joins the same person's calls and texts together.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key — used by `telnyx-acp dev` for model calls, and by scripts/CI instead of `telnyx-acp login` | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US --features sms,voice
> telnyx number-orders create --phone-number +15551234567
> telnyx messaging-profiles create --name "clinic-line"
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/acp-business-line
cp .env.example .env    # ← fill in your credentials

# Prerequisites: Node.js >= 22.13 and telnyx-edge >= 0.5.7 on your PATH
npm install -g @telnyx/acp
telnyx-acp validate     # checks agent.json; every problem names the field and the fix
telnyx-acp dev          # runs the agent on http://127.0.0.1:8787
```

In a second terminal, talk to it locally:

```bash
telnyx-acp chat --local
```

Deploy it and give it a number:

```bash
telnyx-acp numbers                      # lists numbers in your account
telnyx-acp add phone +15550001234       # voice- and messaging-enabled number
telnyx-acp deploy --dry-run             # the plan; writes nothing
telnyx-acp deploy                       # builds (first build ≈ 10 min), wires the number
telnyx-acp status                       # function, revision, numbers, webhook health
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

The first `deploy` registers the agent and builds it (about ten minutes; `deploy` waits up to 25). Every `deploy` after that is a new revision — `telnyx-acp versions acp-business-line` lists them. To remove everything the agent created: `telnyx-acp delete acp-business-line`.

## API Reference

The agent answers at one address over three transports (WebSocket, SSE, RPC). Under `dev` that is `http://127.0.0.1:8787/agents/acp-business-line/<conversation>`; deployed it is the mount URL `https://<function>.telnyxcompute.com/agents/acp-business-line/<conversation>`.

| Surface | Command | What it does |
|---------|---------|--------------|
| One turn | `telnyx-acp invoke acp-business-line --conversation <id> --local "hi"` | One text turn against `dev` (`--local`) or the deployed agent |
| Conversation | `telnyx-acp chat --local` / `telnyx-acp chat` | Interactive conversation, local or deployed |
| One SMS | `telnyx-acp text "what times do you have?"` | Sends an SMS from one of your account's numbers to the agent's number and prints the reply — both numbers are Telnyx's, so no 10DLC registration is needed |
| Status | `telnyx-acp status` | Function, revision, each number, webhook health |
| Logs | `telnyx-acp logs --since 10m` | One JSON line per runtime event (`voiceCall`, `voiceTurn`, `modelStream`, `voiceFiller`, …) |
| Traces | `telnyx-acp traces <conversation> [run]` | Run waterfall: model calls with tokens, tool calls, delivery, timings |

`voice.greeting` is spoken verbatim the moment a call is answered. Each turn of the reply is streamed to TTS sentence-by-sentence, so the caller hears the first words in about a second.

## Demo Script (2–3 minute recording)

1. *"This is the number on our website. Watch it become an agent."*
2. Show `instructions.md` and `agent.json` — two files, no code.
3. Run one local interaction: `telnyx-acp chat --local`, book an intake.
4. Deploy is already done — show the plan: `telnyx-acp deploy --dry-run`.
5. Place one call to the number; let the greeting and intake run. Send one text (`telnyx-acp text`).
6. Show the logs: `telnyx-acp logs --since 5m` (call the out `voiceTurn` lines).
7. Open the trace of the text interaction: `telnyx-acp traces <number>` — walk the model and memory steps.
8. Close: *"One agent, calls and texts, with no application code."*

Record call audio on a second device if needed, and check the beta limitations before making product claims.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `You are not signed in.` (exit 4) from `telnyx-acp models` | No CLI session and no `TELNYX_API_KEY` | Run `telnyx-acp login`, or set `TELNYX_API_KEY` in `.env` |
| `telnyx-edge is not installed or not on PATH` (exit 3) | Missing or old `telnyx-edge` | Install version ≥ 0.5.7 from its releases, or point `TELNYX_EDGE_BIN` at a copy |
| A call connects but stays silent | Recognition, model, or synthesis failed mid-turn | `telnyx-acp logs --since 5m`: a `voiceCall` line with `streaming.failed` names the platform's reason; a non-`completed` `voiceTurn` outcome names the stage |
| A text from a phone got no reply | The agent's number is not 10DLC-registered (error `40010`), or the sender is outside the US | Register the number under a 10DLC campaign in Mission Control, or test with `telnyx-acp text`, which needs no 10DLC |
| `telnyx-acp add phone` fails at `deploy` | Number missing from the account or not yet active | Check `telnyx-acp numbers`; buy in [Mission Control → Numbers → Search & Buy](https://portal.telnyx.com/#/app/numbers/search-numbers) |
| Deployed `invoke` says it is waiting for approval | An `ask` approval was configured (not in this example) | Beta: `ask` works under `dev` only — `telnyx-acp unset approvals.<tool>` and redeploy |

## Related Examples

- [Build a complete voice AI agent with Telnyx (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md)
- [Route phone calls to an AI agent (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md)
- [AI SMS triage bot (Agent SDK, Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md)
- [Voice IVR with an agent backend (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-ivr-with-agent-backend/README.md)

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

- [Agent Control Plane overview](https://developers.telnyx.com/docs/agents)
- [Agent Control Plane — getting started](https://developers.telnyx.com/docs/agents/get-started)
- [`agent.json` reference](https://developers.telnyx.com/docs/agents/reference/agent-json)
- [Voice configuration](https://developers.telnyx.com/docs/agents/voice)
- [Agent Control Plane beta limitations](https://developers.telnyx.com/docs/agents/beta-limitations)
- [`telnyx-acp` CLI reference](https://developers.telnyx.com/docs/agents/cli)
- [Voice AI product page](https://telnyx.com/products/voice-ai-agents)
- [Telnyx pricing](https://telnyx.com/pricing)
