---
name: agent-fleet
title: "The Agent Fleet — three agents, operated from one CLI"
description: "Three config-only Telnyx ACP agents — support on the web page, sales in the email inbox, scheduling on the phone — each just agent.json plus instructions.md, deployed and operated through the same five-verb CLI workflow."
language: acp
framework: agent-control-plane
telnyx_products: [Agent Control Plane, AI Inference, Voice AI, Messaging]
---

# The Agent Fleet — three agents, operated from one CLI

Three specialized agents on three channels — support on the browser page, sales in the email inbox, scheduling on the phone — each a project of two files, all operated with the same `telnyx-acp` verbs: `status`, `logs`, `traces`, `versions`, `deploy`.

## Why Telnyx

Running three agents normally means three vendors, three dashboards, and three sets of credentials. Telnyx collapses that into **AI Communications Infrastructure**: the agent runtime, the phone number, the messaging profile, the email inbox, and the hosted inference model all live on one platform behind one API key and one CLI. The fleet here is configuration only — no application code anywhere — and the operating surface is identical per project, so an operator learns five verbs once and runs a whole department with them. Inference is Telnyx-hosted (`zai-org/GLM-5.3-Flash`) with no provider key to manage, and Agent Memory is keyed by the conversation — the browser id, the email thread, or the caller's number — so the same person's page chat, email, and text remember each other.

## Telnyx API Endpoints Used

This example ships configuration, not code — the Agent Control Plane wires these endpoints for you when you run `telnyx-acp deploy`:

- **Telnyx Inference**: `POST /v2/ai/chat/completions` with the declared model (`zai-org/GLM-5.3-Flash`) — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Agent Memory**: one profile per conversation, keyed by the browser id, the email thread, or the caller's number — [API reference](https://developers.telnyx.com/api-reference/agent-memory)
- **Call Control**: one application created and wired by `deploy` for the scheduling agent — [API reference](https://developers.telnyx.com/api-reference/call-control)
- **Messaging Profile**: one profile created and wired by `deploy` for the scheduling agent — [API reference](https://developers.telnyx.com/api-reference/messaging)
- **Email**: one inbox found-or-created by `deploy`, its domain subscribed to `email.received` for the sales agent — [docs](https://developers.telnyx.com/docs/agents)
- **Web**: a public chat page at `<mount>/web` plus an embed script at `<mount>/web/embed.js`, served by the support agent's function — [docs](https://developers.telnyx.com/docs/agents)

## Architecture

```
  acp-support/            acp-sales/              acp-scheduling/
  ├─ agent.json (--web)   ├─ agent.json (--email) ├─ agent.json (--phone)
  ├─ instructions.md      ├─ instructions.md      ├─ instructions.md
  └─ telnyx-acp deploy    └─ telnyx-acp deploy    └─ telnyx-acp deploy
       ↓                        ↓                        ↓
     one Edge Compute function + actor type per project, same CLI flow

  browser ──/web chat page──┐
  inbound email ──email.received──┤  → one instance per conversation
  inbound call/text ──Call Control app + messaging profile──┘
        (web: the page's conversation id · email: email-<thread id>
         · phone/text: the caller's number)
        → Telnyx Inference model → reply back on the same channel
        → Agent Memory profile keyed {{conversation}} — the person,
          not the message, carries across channels
```

One conversation is one instance. The beta ships no fleet console — `telnyx-acp list` is reserved for the control-plane API and is not available — so the fleet is the muscle memory: the same five verbs typed in three directories.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key — used by `telnyx-acp` when `telnyx-acp login` is unavailable (scripts/CI) | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | auto | The account's webhook public key. `deploy` reads it from the account automatically and stores it as the `TELNYX_PUBLIC_KEY` secret — you normally never set it by hand | [Mission Control → Webhooks](https://portal.telnyx.com) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> telnyx available-phone-numbers list --country US --features sms,voice
> telnyx number-orders create --phone-number +15551234567
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-fleet
cp .env.example .env    # ← fill in your credentials

# Prerequisites: Node.js >= 22.13 and telnyx-edge >= 0.5.7 on your PATH
npm install -g @telnyx/acp
telnyx-acp login        # OAuth through telnyx-edge, or export TELNYX_API_KEY

# Try one agent locally before deploying anything
cd acp-support
telnyx-acp validate     # checks agent.json; every problem names the field and the fix
telnyx-acp dev          # local loop on http://127.0.0.1:8787/agents/acp-support/<conversation>
```

In a second terminal, talk to it locally:

```bash
telnyx-acp chat --local
```

Deploy the fleet and attach the scheduling agent's number:

```bash
cd acp-scheduling
telnyx-acp numbers                      # lists numbers in your account
telnyx-acp add phone +15550001234       # your voice+SMS enabled number
telnyx-acp deploy                       # builds (first build ≈ 10 min), wires the number
telnyx-acp status                       # function, revision, numbers, webhook health

cd ../acp-support && telnyx-acp deploy  # web page goes live at <mount>/web
cd ../acp-sales && telnyx-acp deploy    # prints the sales inbox address
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision the scheduling agent's number (voice + SMS capable)
telnyx available-phone-numbers list --country US --features sms,voice
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

Every `deploy` is a new immutable revision — `telnyx-acp versions acp-scheduling` lists them with their git short SHAs. To remove everything a project created: `telnyx-acp delete <agent>` (and `telnyx-acp remove phone <number>` first, if a number is attached).

## API Reference

The full typed reference lives in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-fleet/API.md). Summary of the three surfaces `deploy` puts on the air:

| Agent | Channel | Address after deploy | Operate with |
|-------|---------|----------------------|--------------|
| `acp-support` | web | chat page `<mount>/web`, embed `<mount>/web/embed.js` | `status`, `logs`, `traces <conversation>` |
| `acp-sales` | email | inbox address printed by `deploy` | `status`, `logs`, `traces email-<thread id>` |
| `acp-scheduling` | phone + SMS | the attached number; answers calls and texts | `status`, `logs` (calls are not traced) |

Each conversation is one instance: the web page's conversation id, `email-<thread id>` for email, the caller's number for phone and text. `telnyx-acp text "..."` sends an SMS from one of your account's numbers to the agent's number — both are Telnyx's, so no 10DLC registration is needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `You are not signed in.` (exit 4) | No CLI session and no `TELNYX_API_KEY` | Run `telnyx-acp login`, or set `TELNYX_API_KEY` in `.env` |
| `telnyx-edge is not installed or not on PATH` | Missing or old `telnyx-edge` | Install version ≥ 0.5.7, or point `TELNYX_EDGE_BIN` at a copy |
| First `deploy` seems to hang | First build ≈ 10 min (`deploy` waits up to 25) | Pre-deploy all three before a demo; revision builds are ≈ 4 min |
| `telnyx-acp add phone` fails at `deploy` | Number missing from the account or not yet active | Check `telnyx-acp numbers`; buy in [Mission Control → Numbers → Search & Buy](https://portal.telnyx.com/#/app/numbers/search-numbers) |
| Sales inbox reply never arrives | The `email` inbox is on the account's shared inbound subdomain, or your domain isn't verified | Use `telnyx-acp add email` with no argument for the shared subdomain, or verify the domain first for a custom address |
| A text from a personal phone got no reply | The agent's number is not 10DLC-registered (error `40010`) | Register under a 10DLC campaign in Mission Control, or demo with `telnyx-acp text`, which needs no 10DLC |
| A call connects but stays silent | Recognition, model, or synthesis failed mid-turn | `telnyx-acp logs --since 5m`: a `voiceCall` line with `streaming.failed` names the reason; a non-`completed` `voiceTurn` names the stage |
| Looking for `telnyx-acp list` | Reserved for the control-plane API; not shipped in the beta | Run `telnyx-acp status` inside each project directory instead |
| Want to undo a bad revision | `rollback` is refused for CLI-deployed agents in the beta | Check out the earlier commit and deploy it — that is the way back |

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

- [The Business Line — one ACP agent on one number](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/acp-business-line/README.md) — the single-agent predecessor this fleet extends (DEV-1430)
- [Agent Fleet Shared Workspace (CloudFS)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-fleet-shared-workspace/README.md) — agents sharing files on CloudFS
- [AI SMS triage bot (Agent SDK, Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md) — the Agent SDK route for the same messaging surface

## Resources

- [Agent Control Plane overview](https://developers.telnyx.com/docs/agents)
- [Agent Control Plane — getting started](https://developers.telnyx.com/docs/agents/get-started)
- [`agent.json` reference](https://developers.telnyx.com/docs/agents/reference/agent-json)
- [`telnyx-acp` CLI reference](https://developers.telnyx.com/docs/agents/cli)
- [Agent Control Plane beta limitations](https://developers.telnyx.com/docs/agents/beta-limitations)
- [Voice AI product page](https://telnyx.com/products/voice-ai-agents)
- [Telnyx pricing](https://telnyx.com/pricing)
