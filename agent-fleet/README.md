---
name: agent-fleet
title: "Agent Fleet — Three Agents, One CLI"
description: "Three config-only Telnyx ACP agents — support on the web page, sales in the email inbox, scheduling on the phone — deployed and operated through the same five-verb workflow."
language: typescript
framework: edge
telnyx_products: [AI Agent Control Plane, Inference, Messaging, Voice, Agent Memory]
---

# Agent Fleet — Three Agents, One CLI

Three specialized agents on three channels, each a project of two files, all operated with the same verbs: `status`, `logs`, `traces`, `versions`, `deploy`.

## The Story

A regional home-services company — HVAC, plumbing, electrical — runs its whole front office off three channels: a support desk fielding refund and warranty questions on the website, a sales inbox answering inbound quote requests, and a scheduling line booking technicians. A missed emergency call is a burst pipe flooding a basement; a slow email reply is a quote that goes to the competitor down the road; a scheduling agent that forgets the caller's preferred window is a truck sent to the wrong address. The stakes are money and trust, and both are measured in minutes, not business days.

The actor IS the fleet. It is born the night before a Monday shift, when three projects are scaffolded — support on web, sales on email, scheduling on phone — each one nothing but an `agent.json` and an `instructions.md`. It evolves the moment an operator edits the scheduling agent's instructions for a warmer greeting and redeploys: a new revision goes live while the other two keep answering, and all three report their revision in the same terminal session. It survives: when the scheduling agent's build is interrupted by a redeploy mid-afternoon, the caller's name, service, and preferred time are already written to a memory profile keyed to their number — the call resumes and the agent picks up where it left off instead of asking again. It completes the day with three live revisions, one per department, and a trace on screen showing exactly which model and memory steps answered a customer's email. The rest of this README is the API surface of that story.

## Why Telnyx

Running three agents normally means three vendors, three dashboards, and three sets of credentials. Telnyx collapses that into **AI Communications Infrastructure**: the agent runtime, the phone numbers, the messaging profile, the email inbox, and the inference model all live on one platform behind one API key and one CLI. The fleet here is configuration only — no application code per agent — and the operating surface is identical per project, so an operator learns five verbs once and runs a department with them. Inference is Telnyx-hosted (`meta-llama/Llama-3.3-70B-Instruct` by default) with no provider key to manage, and Agent Memory is keyed by the conversation — the browser id, the email thread, or the caller's number — so the same person's page chat, email, and text remember each other.

## Telnyx API Endpoints Used

| Surface | Operation | Purpose |
|---------|-----------|---------|
| Agent Control Plane (ACP) | `create --web \| --email \| --phone <E.164>` | Scaffold one project per channel (`agent.json` + `instructions.md`) |
| Agent Control Plane (ACP) | `deploy` | Build and ship a revision; prints inbox address, web URL + embed tag, number wiring |
| Agent Control Plane (ACP) | `status` / `logs --since 10m` / `traces <conversation> <run>` / `versions <agent>` | Operate the fleet — the same five verbs in every project directory |
| Telnyx Inference | `POST /v2/ai/chat/completions` (via `TELNYX.ai.openai.chat.createCompletion`) | Model call per turn, with token usage and finish reason captured in the trace |
| Messaging | `POST /v2/messages` (via `TELNYX.messages.send`) | SMS reply on the scheduling agent's number |
| Messaging | `message.received` webhook | Inbound SMS → scheduling agent, conversation keyed to the sender's number |
| Email | `email.received` webhook | Inbound email → sales agent, conversation keyed to `email-<thread id>` |
| Call Control | `call.initiated` webhook | Inbound call → scheduling agent (logged; calls are not traced in the beta) |
| Webhooks | Ed25519 signature verification | Every inbound event verified against `TELNYX_PUBLIC_KEY` before dispatch |

## Architecture

```
  acp-support/            acp-sales/              acp-scheduling/
  ├─ agent.json (--web)   ├─ agent.json (--email) ├─ agent.json (--phone)
  ├─ instructions.md      ├─ instructions.md      ├─ instructions.md
  └─ deploy               └─ deploy               └─ deploy
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

Inside this sample the same shape is expressed as one Edge worker with three actor namespaces:

```
  POST /webhook/telnyx  ── Ed25519 verify ──┬─ email.received   → acp-sales
                                            ├─ message.received → acp-scheduling
                                            └─ call.initiated   → acp-scheduling (log only)

  GET  /acp-support/status      GET /acp-sales/status      GET /acp-scheduling/status
  GET  /{project}/versions      GET /{project}/logs?since=10m
  GET  /{project}/traces/{conversation}/{run}
  POST /{project}/deploy        POST /{project}/message

  {project}/message → ActorNamespace.get(conversation)
        → memory.read → model.call → memory.write → delivery
        → trace:{project}:{conversation}:{run}  +  log:{project}:{at}:{sha}
```

Each turn is four traced steps — `memory.read`, `model.call` (with prompt/completion tokens and finish reason), `memory.write`, `delivery` — so the waterfall you walk on screen is the same data the CLI's `traces` verb prints. `list` is deliberately absent (reserved for the control-plane API, not shipped in the beta) and rollback is refused: the way back is checkout + redeploy.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Telnyx-hosted model id used for every turn. `openai/*`-style ids need your own provider key as a secret. | `telnyx-acp models` |
| `DEMO_MODE` | `string` | `true` | no | Defaults to demo. Set to `false` to actually send SMS through the `TELNYX` binding. | — |
| `AGENT_NUMBER` | `string` | `+1555XXXXXXXX` | no | The scheduling agent's number, used as the `from` on outbound SMS. Required only in live mode. | Telnyx Portal → Numbers |

## Setup

```bash
# 1. Clone and install
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-fleet
npm install

# 2. Configure
cp .env.example .env
# edit .env — TELNYX_API_KEY, TELNYX_PUBLIC_KEY, optionally AI_MODEL / DEMO_MODE / AGENT_NUMBER

# 3. Authenticate the Edge CLI and push secrets
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<your webhook public key>"

# 4. Generate binding types from telnyx.toml, then ship
telnyx-edge types
telnyx-edge ship

# 5. Smoke test (no network, no credentials required)
npx tsx smoke_test.ts
```

The three projects are already scaffolded in this repo as `acp-support/`, `acp-sales/`, and `acp-scheduling/` — each holds only `agent.json` and `instructions.md`. To reproduce the beta flow with the real CLI:

```bash
npm install -g @telnyx/acp
telnyx-acp login                       # or export TELNYX_API_KEY
telnyx-acp create --name acp-support --web
telnyx-acp create --name acp-sales --email
telnyx-acp create --name acp-scheduling --phone +15550101200
cd acp-support && telnyx-acp deploy    # first build ≈ 10 min (waits up to 25)
```

Channels can also be added after the fact with `telnyx-acp add web`, `add email`, or `add phone`, and edited with `set` / `unset` (e.g. `telnyx-acp set voice.greeting "..."`).

**Demo mode is the default.** With `DEMO_MODE` unset or `true`, the scheduling agent's delivery step returns `demo: would SMS <number>` and logs it — nothing is sent and nothing is charged. Set `DEMO_MODE=false` and `AGENT_NUMBER` to a number you own to switch to live SMS. See GUIDE.md for the full walkthrough of both modes.

## API Reference

All routes are served by the single Edge worker in `src/index.ts`. `{project}` is one of `acp-support`, `acp-sales`, `acp-scheduling`.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/{project}/status` | Revision, git short SHA, channel, address, deploy time, and webhook health (last event within the hour) |
| `GET` | `/{project}/versions` | Every revision with its git short SHA and deploy timestamp |
| `GET` | `/{project}/logs?since=10m` | Runtime events (`deploy`, `modelStream`, `voiceCall`, …). `since` accepts `30s`, `10m`, `2h`; default `10m` |
| `GET` | `/{project}/traces/{conversation}/{run}` | The run waterfall: `memory.read` → `model.call` → `memory.write` → `delivery` |
| `POST` | `/{project}/deploy` | Build a new revision. Body: `{ "instructions"?: string, "gitSha"?: string }` → `201` |
| `POST` | `/{project}/message` | One turn. Body: `{ "conversation": string, "text": string, "from"?: string }` |
| `POST` | `/webhook/telnyx` | Ed25519-verified inbound events: `email.received`, `message.received`, `call.initiated` |

**`POST /acp-sales/deploy`**

```json
{ "instructions": "You are the sales agent replying to inbound email in the same thread. Plain text, under 120 words.", "gitSha": "a1b2c3d" }
```

```json
{
  "name": "acp-sales",
  "channel": "email",
  "revision": 2,
  "gitSha": "a1b2c3d",
  "deployedAt": "2026-01-12T09:12:44.001Z",
  "address": "sales-inbox@example.com",
  "instructions": "You are the sales agent replying to inbound email in the same thread. Plain text, under 120 words.",
  "versions": [
    { "revision": 1, "gitSha": "9f8e7d6", "deployedAt": "2026-01-11T22:04:10.882Z" },
    { "revision": 2, "gitSha": "a1b2c3d", "deployedAt": "2026-01-12T09:12:44.001Z" }
  ]
}
```

**`POST /acp-support/message`**

```json
{ "conversation": "web-7f3a91", "text": "where do I send a refund?" }
```

```json
{ "project": "acp-support", "conversation": "web-7f3a91", "reply": "Send it back to the address on your packing slip and we'll refund the card on file within one business day.", "run": "m3k9x2-4a1f" }
```

**`GET /acp-sales/traces/email-18f2c9/m3k9x2-4a1f`**

```json
{
  "project": "acp-sales",
  "conversation": "email-18f2c9",
  "run": "m3k9x2-4a1f",
  "steps": [
    { "step": "memory.read", "detail": "2 fact(s) on file", "at": "2026-01-12T09:14:02.114Z" },
    { "step": "model.call", "detail": "meta-llama/Llama-3.3-70B-Instruct", "tokens": { "prompt": 412, "completion": 96 }, "finishReason": "stop", "at": "2026-01-12T09:14:03.870Z" },
    { "step": "memory.write", "detail": "3 fact(s) stored", "at": "2026-01-12T09:14:03.902Z" },
    { "step": "delivery", "detail": "email thread email-18f2c9", "at": "2026-01-12T09:14:03.905Z" }
  ]
}
```

Status codes: `200` success, `201` deploy created, `400` missing `conversation`/`text` or malformed trace path, `401` invalid webhook signature, `404` unknown project / unknown verb / no trace for that conversation and run, `500` generic failure (details go to the worker log only).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 invalid signature` on `/webhook/telnyx` | `TELNYX_PUBLIC_KEY` missing or wrong, or the timestamp is more than 300s off | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<key>"`; check the host clock |
| `404 unknown project` | Path is not one of the three project names | Use `acp-support`, `acp-sales`, or `acp-scheduling` — there is no fleet-wide route |
| `404 no trace for that conversation and run` | Traces expire after 7 days, or the run id is from a different conversation | Re-run the turn and copy the `run` from the `message` response |
| `status` says `deployed: false` | Nothing has been deployed for that project yet | `POST /{project}/deploy` (or `telnyx-acp deploy` inside the project directory) |
| `webhook.healthy` is `false` | No runtime event in the last hour | Expected on a quiet fleet — send one message to confirm wiring |
| SMS never arrives in live mode | `DEMO_MODE` still `true`, or `AGENT_NUMBER` unset | Set `DEMO_MODE=false` and `AGENT_NUMBER` to a number you own |
| `traces` returns nothing for a phone call | Calls are not traced in the beta | Use `logs --since 10m` and look for `voiceCall` / `voiceTurn` events |
| Want to undo a bad revision | `rollback` is refused in the beta | Check out the earlier commit and redeploy — that is the way back |
| Looking for `telnyx-acp list` | Not shipped; reserved for the control-plane API | Run `status` inside each project directory instead |
| First deploy seems to hang | First build ≈ 10 min, `deploy` waits up to 25 | Pre-deploy all three before recording; revision builds are ≈ 4 min |

## Agent Discovery

- [Sign up for Telnyx agents](https://telnyx.com/agent-signup.md)
- [Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt — machine-readable Telnyx docs](https://developers.telnyx.com/llms.txt)
- [LLM-ready Agent Control Plane beta docs](https://developers.telnyx.com/public/llms/ai-agent-control-plane-beta.txt)

## Related Examples

- [`acp-business-line`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/acp-business-line) — the shipped single-agent sample this fleet extends (DEV-1430: one agent, one number, calls + texts)
- [`telnyx-messaging-sms`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-messaging-sms) — inbound/outbound SMS with Ed25519 webhook verification
- [`telnyx-voice-call-control`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-voice-call-control) — Call Control applications and inbound call webhooks
- [`telnyx-ai-inference`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-ai-inference) — Telnyx-hosted model calls with token accounting

## Resources

- [Agent Control Plane documentation](https://developers.telnyx.com/docs/agents)
- [Getting started with agents](https://developers.telnyx.com/docs/agents/get-started)
- [`telnyx-acp` CLI reference](https://developers.telnyx.com/docs/agents/cli)
- [`agent.json` reference](https://developers.telnyx.com/docs/agents/reference/agent-json)
- [Beta Limitations](https://developers.telnyx.com/docs/agents/beta-limitations)
- [Telnyx API reference](https://developers.telnyx.com/api)
- [Telnyx Node SDK](https://github.com/team-telnyx/telnyx-node)
- [Telnyx AI product page](https://telnyx.com/products/ai)
- [Telnyx pricing](https://telnyx.com/pricing)
