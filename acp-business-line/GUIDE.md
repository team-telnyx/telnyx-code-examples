# GUIDE — Turn a phone number into an AI business line

This walkthrough takes you from two config files to a phone number that answers calls and texts as a clinic appointment-intake agent. The Agent Control Plane is in **beta**; behavior can change between releases (see [limitations](https://developers.telnyx.com/docs/agents/beta-limitations)).

## What you are building

`Northside Family Clinic` puts one number on its website. Callers hear a warm greeting and give a name, a reason for the visit, and a preferred time; texters get the same treatment over SMS. Nothing below involves writing an application: the agent is `agent.json` (the spec) plus `instructions.md` (the prompt).

## Prerequisites

- Node.js ≥ 22.13, and [`telnyx-edge`](https://developers.telnyx.com/docs/edge-compute/quickstart) ≥ 0.5.7 on your `PATH`
- `npm install -g @telnyx/acp`
- A Telnyx account: sign in with `telnyx-acp login` (OAuth through telnyx-edge), or set `TELNYX_API_KEY` for scripts/CI
- One voice- and messaging-enabled phone number in the account (`telnyx-acp numbers`)

## Step 1 — Read the two files

**`agent.json`** declares everything the platform needs: the model (`zai-org/GLM-5.3-Flash`, hosted by Telnyx, so no provider key is required), where the prompt lives, and the memory block — one Agent Memory profile per conversation, keyed `{{conversation}}`. No tools: the intake flow needs nothing but the model, which keeps the demo clear of beta tool limits.

**`instructions.md`** is the system prompt. Because a call speaks every sentence out loud, it asks for short, warm sentences and captures the three intake fields one or two at a time. It also sets the guardrails: no schedule promises (the front desk confirms), steer off-topic requests back, and route emergencies to 911.

## Step 2 — Try it locally

```bash
cd acp-business-line
telnyx-acp validate
telnyx-acp dev
```

`dev` runs the managed loop in your CLI's process at `http://127.0.0.1:8787/agents/acp-business-line/<conversation>`, reloading `instructions.md` and `agent.json` on save. In a second terminal:

```bash
telnyx-acp chat --local
```

Say you are calling for a checkup, give your name and a preferred time, and watch the agent confirm all three details back. Conversations are independent: `telnyx-acp invoke acp-business-line --conversation alice --local "hi"` and the same with `--conversation bob` never see each other's turns.

Run the shipped eval suite:

```bash
telnyx-acp eval --local
```

Six cases — greeting, explaining the line, intake, off-topic steering, emergency routing, and summary confirmation — should all pass in about 1.5 s each.

## Step 3 — Deploy and attach the number

```bash
telnyx-acp add phone +15550001234   # your voice+SMS enabled number
telnyx-acp deploy --dry-run        # the plan; writes nothing
telnyx-acp deploy                  # builds (first build ≈ 10 min), then wires the number
```

`deploy` looks up the number, creates a Call Control application (calls) and a messaging profile (texts), and points their webhooks at the agent. The account's webhook public key is read automatically. `telnyx-acp status` shows the revision, each number, and webhook health.

## Step 4 — Exercise the line

**Call it.** From any phone, call the number. You hear the greeting (`voice.greeting` in `agent.json`, spoken verbatim at answer), then hold a natural conversation: the agent asks for name, reason, and preferred time, confirms them, and says the front desk will follow up.

**Text it.** From your terminal:

```bash
telnyx-acp text "Hi, I need a refill appointment"
```

This sends an SMS from one of your account's numbers to the agent's number through the messaging API — both numbers are Telnyx's, so no 10DLC registration is needed, which is why this is the reliable way to demo texting. A text from a personal phone works too, but the reply reaches a US handset only once the agent's number is 10DLC-registered (Mission Control → Messaging → 10DLC); otherwise it fails with error `40010`. A phone outside the US cannot reach a US long code at all.

**See what it did.**

```bash
telnyx-acp logs --since 10m          # voiceCall / voiceTurn / modelStream lines
telnyx-acp traces <caller-number>    # runs of a text conversation, step by step
telnyx-acp traces <caller-number> <run-id>   # one run's waterfall
```

The waterfall shows each model call with its tokens and finish reason, and the delivery of the reply — the "model and memory steps" the trace exposes. Note the beta constraint: phone calls are not traced; use `logs` for call-side detail and `traces` for text interactions.

**One instance per caller.** A text conversation is keyed by the sender's number, so each phone that texts the line gets its own instance with its own message log; a call gets a per-call instance. Agent Memory profiles tie the same person's calls and texts together, so when Jordan texts an hour after calling, the agent remembers Jordan.

## Step 5 — Change it, ship again

Edit `instructions.md`, or change one knob:

```bash
telnyx-acp set voice.greeting "Hi, Northside Clinic — how can I help you today?"
telnyx-acp deploy
```

Every `deploy` is a new revision; `telnyx-acp versions acp-business-line` lists them with their git short SHAs. Rollback is refused for CLI-deployed agents in the beta — the way back is checking out the earlier commit and deploying it.

## Step 6 — Tear down

```bash
telnyx-acp remove phone +15550001234   # next deploy restores the number's prior webhooks
telnyx-acp delete acp-business-line    # removes the function, actor type, and created artifacts
```

## Recording this demo (2–3 minutes)

There is no code to write and nothing to build on camera — every shot is a file you show or a CLI command you type. Two terminals suffice: T1 runs `dev`, T2 runs everything else.

| # | Say / do | Command |
|---|----------|---------|
| 1 | *"This is the number on our website. Watch it become an agent."* | `telnyx-acp status` (shows the live line) |
| 2 | *"This is the entire agent — two files."* | `cat agent.json instructions.md` |
| 3 | Run one intake locally | T1: `telnyx-acp dev` · T2: `telnyx-acp chat --local` |
| 4 | *"Deploy is a revision away."* (already deployed — show the plan, never wait on a build) | `telnyx-acp deploy --dry-run` |
| 5 | Place the live call from a second phone | dial `+15072291272` |
| 6 | Text the line | `telnyx-acp text "Hi, I need a checkup Thursday morning"` |
| 7 | *"Here is everything it did."* | `telnyx-acp logs --since 5m` then `telnyx-acp traces <number-printed-by-the-text>` |
| 8 | *"One agent, calls and texts, with no application code."* | — |

Notes: the deploy happened before recording (revision `87e7c065a907` is live); if you want deploy visible in the cut, record a real `telnyx-acp deploy` separately and speed it up in the edit. Record call audio on a second device, review for credentials or personal information, and check product claims against the [current docs](https://developers.telnyx.com/docs/agents) before publishing.

## Beta guardrails

Do not claim: production readiness, rollback, staging slots, a control-plane API, approvals on deployed agents, or tools on calls (those need `voice.harness`, and `ask` tools stay off calls). Say "beta" when describing the Agent Control Plane.
