# GUIDE — The Agent Fleet: three agents, one CLI

This walkthrough takes you from three two-file projects to a live fleet: support on the web page, sales in the email inbox, scheduling on the phone — all deployed and operated with the same `telnyx-acp` verbs. The Agent Control Plane is in **beta**; behavior can change between releases (see [limitations](https://developers.telnyx.com/docs/agents/beta-limitations)).

## What you are building

A regional home-services company runs its front office on three channels: a support desk answering refund and shipping questions on the website, a sales inbox replying to quote requests in-thread, and a scheduling line booking technicians. Each agent is one directory holding exactly two files:

| Project | Channel | Channel config in `agent.json` | Instructions focus |
|---|---|---|---|
| `acp-support/` | web | `"web": { … }` (page + embed script) | refunds, shipping, account changes |
| `acp-sales/` | email | `"email": true` | reply in-thread, qualify, one next step |
| `acp-scheduling/` | phone + SMS | `"phone": [ … ]` + `voice.greeting` | greeting + intake (name, job, time) |

There is no application code anywhere. The whole agent is `agent.json` (the spec) plus `instructions.md` (the prompt), and the `telnyx-acp` CLI deploys and operates all three identically. The point of the demo: **learn five verbs once, run a department with them** — `status`, `logs`, `traces`, `versions`, `deploy`.

## Prerequisites

- Node.js ≥ 22.13 and [`telnyx-edge`](https://developers.telnyx.com/docs/edge-compute/quickstart) ≥ 0.5.7 on your `PATH`
- `npm install -g @telnyx/acp`
- A Telnyx account in the Agent Control Plane beta: sign in with `telnyx-acp login`, or set `TELNYX_API_KEY` for scripts/CI
- One voice- and messaging-enabled phone number for the scheduling agent (`telnyx-acp numbers`)
- Permission to deploy three separate agents

> The ACP beta ships as `latest` on npm and flags move between releases. Re-check `telnyx-acp --help` against the [current docs](https://developers.telnyx.com/docs/agents) before recording.

## Step 1 — Read the three projects

Each project is the same shape with one channel block changed:

- **`acp-support/agent.json`** declares the model (`zai-org/GLM-5.3-Flash`, Telnyx-hosted — no provider key), the prompt file, the `web` block (page title, opening greeting, suggestion chips), and the memory profile keyed `{{conversation}}`.
- **`acp-sales/agent.json`** declares the same model and memory with `"email": true` — `deploy` finds or creates the inbox on the account's shared inbound subdomain and subscribes its domain to `email.received`.
- **`acp-scheduling/agent.json`** declares `"phone": []` (attach your number with `add phone`) and a `voice.greeting` spoken verbatim the moment a call is answered.

The `instructions.md` files are the prompts. Each is short and specific about what the agent may not do: no invented prices or dates, one qualification question per reply (sales), no schedule promises (scheduling), and requests routed to the desk that owns them.

## Step 2 — Try one agent locally

```bash
cd acp-support
telnyx-acp validate
telnyx-acp dev
```

`dev` runs the managed loop in your CLI's process at `http://127.0.0.1:8787/agents/acp-support/<conversation>`, reloading `instructions.md` and `agent.json` on save. In a second terminal:

```bash
telnyx-acp chat --local
```

Ask about a return; give an order number; watch it confirm the request and set a one-business-day expectation. Conversations are independent: `telnyx-acp invoke acp-support --conversation alice --local "hi"` and the same with `--conversation bob` never see each other's turns.

Run the shipped eval suite in each project:

```bash
telnyx-acp eval --local
```

## Step 3 — Deploy the fleet

```bash
cd ../acp-scheduling
telnyx-acp numbers                  # confirm the number is in the account
telnyx-acp add phone +15550001234   # your voice+SMS enabled number
telnyx-acp deploy --dry-run         # the plan; writes nothing
telnyx-acp deploy                   # builds (first build ≈ 10 min), wires the number

cd ../acp-support && telnyx-acp deploy
cd ../acp-sales && telnyx-acp deploy
```

Each `deploy` registers the agent, builds it, and wires the channel: a Call Control application plus a messaging profile for the scheduling number, the inbox plus the `email.received` subscription for sales, and the public page for support. `deploy` prints what it set up and the addresses. `telnyx-acp status` in each project shows the revision, every channel, and webhook health.

## Step 4 — Exercise the three channels

**Web (support).** Open the chat page `deploy` printed — `<mount>/web`. The page is public from deployment; `--title` sets its title, and the launcher label. Ask "Where do I send a return?" and watch the reply render in the same tab. For any other site, the embed script is `<mount>/web/embed.js`.

**Email (sales).** Send one email from a test address to the inbox address printed by `deploy`. The reply lands in the same thread — one instance per `email-<thread id>`. Tip for demos: send the email before recording so a completed reply is already in the thread.

**Phone/SMS (scheduling).** Call the number: you hear `voice.greeting` verbatim, then the intake (name, job, preferred time). Or text it:

```bash
telnyx-acp text "Hi, I need a furnace check Thursday morning"
```

This sends an SMS from one of your account's numbers to the agent's number — both are Telnyx's, so no 10DLC registration is needed. A text from a personal phone also works once the agent's number is 10DLC-registered (Mission Control → Messaging → 10DLC); otherwise it fails with error `40010`.

## Step 5 — Operate the fleet

Run in each project directory:

```bash
telnyx-acp status                   # revision, channels, address, webhook health
telnyx-acp logs --since 10m         # voiceCall / voiceTurn / modelStream lines
```

There is no fleet-wide `list` — it is reserved for the control-plane API and not shipped in the beta. `status` inside each project *is* the honest fleet view, and the demo should say so.

## Step 6 — Revise one agent

Edit `acp-scheduling/instructions.md` (for the demo: ask for a warmer greeting), or change one knob:

```bash
telnyx-acp set voice.greeting "Hi, Fleet scheduling — how can I help you today?"
telnyx-acp deploy                   # a revision build ≈ 4 min
telnyx-acp versions acp-scheduling  # revisions with git short SHAs
```

Every `deploy` is a new immutable revision. **Rollback is refused for CLI-deployed agents in the beta** — the way back is checking out the earlier commit (which `versions` names) and deploying it. Say that on camera rather than hiding it.

## Step 7 — Walk a trace

```bash
telnyx-acp traces <conversation>            # the conversation's newest runs
telnyx-acp traces <conversation> <run>      # one run's waterfall
```

The waterfall shows each model call with its tokens and finish reason, and the delivery of the reply — the "model and memory steps" on screen. Two beta properties to narrate correctly: traces hold **no message text** (what the agent did, not what was said), and **phone calls are not traced** — use `logs --since 10m` for the call side and walk a text or email trace instead.

## Step 8 — Tear down

```bash
cd acp-scheduling
telnyx-acp remove phone +15550001234    # next deploy restores the number's prior webhooks
telnyx-acp delete acp-scheduling        # removes the function, actor type, and created artifacts
```

Repeat `delete` for the other two agents.

## Recording the demo (5–8 minutes)

The whole demo is files you show and CLI verbs you type. Two terminals: T1 runs `dev` (support), T2 runs everything else. Deploy everything and send the sales email **before** recording.

| # | Say / do | Command |
|---|----------|---------|
| 1 | *"Support, sales, scheduling — three agents, one CLI."* | `cd agent-fleet` |
| 2 | Show the three projects and each agent's job | `ls acp-support acp-sales acp-scheduling` · `cat acp-support/agent.json` |
| 3 | Interact with support through its web page | open `<mount>/web`, ask about a return |
| 4 | Send a message to the sales inbox; show the reply in-thread | send the email (pre-sent), open the thread |
| 5 | Call the scheduling number (or text it) | dial, or `telnyx-acp text "furnace check Thursday"` |
| 6 | Run `status` inside each project; show all three deployed | `cd acp-support && telnyx-acp status` (repeat ×3) |
| 7 | Edit one `instructions.md`, deploy the revision | edit + `telnyx-acp deploy` (cut the ≈ 4 min build) |
| 8 | Show versions and recent logs for all three | `telnyx-acp versions acp-scheduling` · `logs --since 10m` |
| 9 | Open the email trace; explain the model and memory steps | `telnyx-acp traces email-<thread-id> <run>` |
| 10 | *"Three specialized agents, deployed and operated through the same ACP workflow."* | — |

**Fallbacks while recording:**

- If the phone is unreliable, use a pre-recorded call clip, or exercise the text path with `telnyx-acp text`.
- If the sales reply is delayed, show the pre-sent thread and walk its trace.
- If a revision build runs long, pre-deploy it and show `versions` instead of the wait.
- Record separate clean clips per channel so network and delivery delays can be cut in the edit.

**Before publishing, review the recording for:** exposed credentials or API keys, private email addresses or customer data, unsupported claims (list command, rollback, staging, approvals, production readiness), and unnecessary waiting.

## Beta guardrails

Do not claim: production readiness, `telnyx-acp list`, rollback, staging slots, a control-plane API, approvals on deployed agents, phone-call traces, or `texml_application` channels (unanswered, 501). Say "beta" when describing the Agent Control Plane.
