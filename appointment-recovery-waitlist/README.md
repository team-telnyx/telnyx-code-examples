---
name: appointment-recovery-waitlist
title: "Missed Appointment Recovery + Waitlist Filler — Durable Slot Actor Prevents Double-Booking"
description: "A scheduling webhook opens an appointment slot and a durable AppointmentSlot actor owns the recovery workflow end-to-end — call/text the missed patient to reschedule, then work the waitlist in priority order until the first confirmation wins. Retries, reply windows, and the confirmation lock survive restarts."
language: typescript
framework: edge
telnyx_products: [Messaging, Voice, Agent SDK]
---

# Missed Appointment Recovery + Waitlist Filler — Durable Slot Actor Prevents Double-Booking

A clinic scheduling webhook opens an appointment slot and one durable `AppointmentSlot` actor owns the recovery workflow end-to-end — it calls/texts the missed patient to reschedule, then works the waitlist in priority order until the first confirmation wins. Retries, reply windows, the waitlist cursor, and the confirmation lock survive worker eviction, so double-booking is impossible even if the actor is killed mid-outreach.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a platform where durable, stateful actors are first-class primitives, voice + messaging are carrier-grade, and call-control + SMS compose into one workflow. Unlike stateless functions that forget everything between invocations, Telnyx's Agent SDK gives each `AppointmentSlot` actor per-entity SQL persistence (an append-only outreach ledger plus a single-row confirmation table that acts as the durable confirmation lock), durable scheduled tasks (sweep timers and retry budgets survive restarts), and the `@telnyx/edge-runtime` Agent model that serializes events so the slot can never be claimed twice. Outbound voice (`POST /v2/calls` + `/actions/speak`) and inbound SMS (the `[telnyx]` `messages.send` binding plus `message.received` webhooks) both resolve through the same actor-owned slot state — coordination is the hard problem, and the actor owns the scarce resource (one appointment slot).

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `env.SLOTS.idFromName(slotId)` | Agent SDK | Self-provisions one durable actor per appointment slot on the scheduling webhook's `openSlot` RPC |
| `env.SLOT_INDEX.idFromName("index")` | Agent SDK | Single shared actor that routes inbound replies/call events to the slot actor currently reaching out |
| `this.ctx.storage.sql.exec(...)` | Agent SDK SQL | Per-actor `outreach_attempts(slot_id, patient, channel, status, detail, ts)` ledger + `confirmations(slot_id PRIMARY KEY, ...)` confirmation lock |
| `this.schedule(seconds, "sweepCandidate", { generation }, { id })` | Agent SDK | Reply-window sweep, retry timer, and slot expiry — every pending outreach survives restarts |
| `POST /v2/ai/assistants/{id}/scheduled_events` | AI Assistants | **Primary voice channel** — triggers the conversational agent's outbound call with dynamic variables (patient name, provider, human-readable slot time, offer text, slot id) |
| Webhook tool `report_outcome` (`POST /v2/ai/tools`) | AI Assistants | The assistant reports the patient's decision mid-call; the body is flat args with `slot_id` + `caller_phone` injected server-side and an Ed25519 signature header |
| `POST /webhook/assistant-tool` | AI Assistants | Receives the tool call, verifies the signature, routes the intent to the owning slot actor |
| `voice ultra katie` + Telnyx-hosted inference | AI Assistants | Natural conversational voice for the recovery and waitlist offers |
| `POST /v2/calls` + `/actions/speak` + `/actions/gather_using_ai` | Voice (Call Control) | **Fallback voice channel** (when `VOICE_ASSISTANT_ID` is unset) — dial, speak the offer, classify the reply via gather_using_ai, hang up |
| `call.answered` / `call.speak.ended` / `call.ai_gather.ended` / `call.hangup` webhooks (`/webhook/call-events`) | Voice (Call Control) | Call lifecycle routed to the slot actor via `client_state` (fallback path only) |
| `env.TELNYX.messages.send({ to, from, text })` | Messaging | Outreach SMS, retry SMS, and confirmation SMS — zero-credential binding |
| `message.received` webhook (`/webhook/inbound-message`) | Messaging | Patient replies resolve through the same actor-owned slot state |
| `call.answered`, `call.ai-gather-ended`, `call.hangup` webhooks (`/webhook/call-events`) | Voice (Call Control) | Call lifecycle routed to the slot actor via `client_state` (or the index fallback) |

## Architecture

```
                ┌──────────────────────────────────────────────────────────┐
                │                  Telnyx Edge Runtime                      │
                │                                                          │
  Scheduling    │   ┌────────────────────────────────────┐                  │
  webhook  ─────┼──►│            AppointmentSlot         │                  │
                │   │            (extends Agent)         │                  │
  POST          │   │   one durable actor per slot       │                  │
  /webhook/     │   │   env.SLOTS.idFromName(slotId)     │                  │
  scheduling    │   │                                    │                  │
  {slotId,      │   │   state:                            │                  │
   provider,    │   │     missedPatient, waitlist[]       │                  │
   startsAt,    │   │     cursor, currentCandidate        │                  │
   missedPt,    │   │     confirmation, status, generation│                 │
   waitlist[]}  │   │                                    │                  │
                │   │   SQL:                             │                  │
                │   │     outreach_attempts(...) ledger  │                  │
                │   │     confirmations(... PK) lock     │                  │
                │   │                                    │                  │
                │   │   schedules:                       │                  │
                │   │     sweep timer (reply window)    │                  │
                │   │     retry budget (channel flip)    │                  │
                │   │     slot expiry (close as expired) │                  │
                │   └────────────────────────────────────┘                  │
                │                                                          │
                │   ┌────────────────────────────────────┐                  │
                │   │             SlotIndex              │                  │
                │   │   single shared actor (fallback)   │                  │
                │   │   patient E.164 → slotId + role    │                  │
                │   └────────────────────────────────────┘                  │
                │                                                          │
                │   Telnyx:                                                │
                │     AI Assistant (katie) ──conversational call─► patient  │
                │       report_outcome tool ──signed webhook──► slot actor │
                │     (fallback) POST /v2/calls + speak + gather_using_ai  │
                │     TELNYX.messages.send ──SMS──► patient                │
                │     message.received    ──SMS──► inbound webhook         │
                └──────────────────────────────────────────────────────────┘

  Demo mode (default) — DEMO_MODE=true:
    - voice call/SMS are logged instead of dispatched
    - patient replies are driven by the demo endpoints below

  Live mode — DEMO_MODE=false:
    - real Call Control dials; outbound + inbound webhooks must be
      signature-verified against TELNYX_PUBLIC_KEY (Telnyx Ed25519)
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key — injected automatically by the `[telnyx]` binding; also used by the `telnyx-edge` CLI | [Telnyx Portal → API Keys](https://portal.telnyx.com) |
| `DEMO_MODE` | `string` | `true` / `false` | no | `true` (default) logs calls/SMS and drives replies via `/demo/reply` + `/demo/call-event`; `false` dials real calls, sends real SMS, and verifies inbound webhook signatures | `telnyx-edge secrets add DEMO_MODE false` |
| `OUTBOUND_CONNECTION_ID` | `string` | `1900001234567890` | yes (live mode) | Call Control connection (voice app) used to dial the missed patient and waitlist candidates | `telnyx-edge secrets add OUTBOUND_CONNECTION_ID 19…` |
| `OUTBOUND_CALLER_ID` | `string` | `+16282564655` | yes (live mode) | E.164 clinic line presented on outbound calls | `telnyx-edge secrets add OUTBOUND_CALLER_ID "+1555..."` |
| `SCHEDULING_SMS_E164` | `string` | `+16282564655` | yes (live mode) | SMS-capable clinic number used for outreach SMS, retries, and confirmation SMS | `telnyx-edge secrets add SCHEDULING_SMS_E164 "+1555..."` |
| `VOICE_ASSISTANT_ID` | `string` | `assistant-…` | no | Telnyx AI Assistant used for the live conversational voice channel (voice ultra katie + the `report_outcome` webhook tool). Unset → the Call Control fallback path is used | [Telnyx Portal → AI Assistants](https://portal.telnyx.com) or the Telnyx AI repo |
| `AI_MODEL` | `string` | `meta-llama/Llama-3.3-70B-Instruct` | no | Model used by `gather_using_ai` intent classification (fallback voice path) and hosted inference | [Telnyx Inference models](https://developers.telnyx.com/docs/ai/inference) |
| `WAITLIST_REPLY_TIMEOUT_MIN` | `number` | `10` | no | Reply window per outreach attempt, in minutes | `telnyx-edge secrets add WAITLIST_REPLY_TIMEOUT_MIN 10` |
| `OUTREACH_RETRY_MAX` | `number` | `2` | no | Extra attempts per candidate before moving to the next waitlist patient | `telnyx-edge secrets add OUTREACH_RETRY_MAX 2` |
| `SLOT_EXPIRY_MIN` | `number` | `60` | no | Minutes until an unclaimed slot closes as expired | `telnyx-edge secrets add SLOT_EXPIRY_MIN 60` |
| `CLINIC_TIMEZONE` | `string` | `America/New_York` | no | IANA timezone shown in confirmation messages | `telnyx-edge secrets add CLINIC_TIMEZONE America/New_York` |
| `TELNYX_PUBLIC_KEY` | `string` | `MCowBQYDK2VwAyEA…` | yes (live mode) | Base64 Telnyx Ed25519 public key used to verify inbound webhook signatures | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s https://api.telnyx.com/v2/public_key)"` |

> **Note:** the Edge runtime does **not** inject `[env_vars]` for actor projects. Config ships as `[[secrets]]` bindings in `telnyx.toml` and is read via `SECRETS.get()` with a plain env-var fallback (`readConfig` in `src/index.ts`). The `.env` file is for local tooling only.

> **Agent / CLI access** — all of the above can be provisioned from the CLI/agent without the portal:
>
> ```bash
> telnyx auth set-key KEY…                                       # human CLI auth (or TELNYX_API_KEY env var for agents)
> telnyx call-control-apps create --name "clinic-line"            # create a Call Control app (returns the connection id)
> telnyx number-orders create --profile international --quantity 1   # buy an SMS-capable number
> telnyx-edge new-func --actor -l ts -n appointment-recovery-waitlist   # register the actor function
> telnyx-edge secrets add DEMO_MODE true                         # demo mode (default)
> telnyx-edge secrets add OUTBOUND_CONNECTION_ID 19…              # voice app id (Call Control)
> telnyx-edge secrets add OUTBOUND_CALLER_ID "+1555XXXXXXXX"      # clinic line on outbound calls
> telnyx-edge secrets add SCHEDULING_SMS_E164 "+1555XXXXXXXX"     # SMS-capable clinic number
> telnyx-edge secrets add WAITLIST_REPLY_TIMEOUT_MIN 10           # reply window (minutes)
> telnyx-edge secrets add OUTREACH_RETRY_MAX 2                    # retries per candidate
> telnyx-edge secrets add SLOT_EXPIRY_MIN 60                      # slot lifetime (minutes)
> telnyx-edge secrets add CLINIC_TIMEZONE America/New_York
> telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s https://api.telnyx.com/v2/public_key)"
> ```

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Telnyx account with an SMS-capable number (10DLC campaign required for US A2P traffic)
- A Telnyx Call Control voice app (or use an existing connection) for outbound dialing
- Telnyx Edge CLI: install from [github.com/team-telnyx/edge-compute/releases](https://github.com/team-telnyx/edge-compute/releases)

### Local Development

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/appointment-recovery-waitlist

# Authenticate the Edge CLI (or export TELNYX_API_KEY)
export TELNYX_API_KEY=your_telnyx_api_key_here

# Install dependencies
npm install

# Typecheck + smoke test (loads the module, exercises the full actor
# state machine: missed-patient recovery, waitlist priority, retry budget,
# first-confirm-wins lock, restart proof, expiry, and the HTTP surface)
npm run typecheck
npm test
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Create the StatefulActor function (registers func_id with the platform)
telnyx-edge new-func --actor -l ts -n appointment-recovery-waitlist
# → copy the printed func_id into telnyx.toml [edge_compute]

# Ship to Telnyx Edge (~5-10 min: upload, build, deploy)
telnyx-edge ship

# Point your messaging profile's inbound webhook at the deployed function:
#   message.received callback → https://<your-function>.telnyxcompute.com/webhook/inbound-message
# Point your Call Control voice app's webhooks at:
#   https://<your-function>.telnyxcompute.com/webhook/call-events

# Deployed URL is printed at the end; also visible via:
telnyx-edge list
```
</details>

### Deploy and Run

```bash
# Ship to Telnyx Edge Compute
telnyx-edge ship

# Health check
curl https://<your-function>.telnyxcompute.com/health

# 1. A scheduling system reports a missed appointment → the slot actor is born
curl -X POST https://<your-function>.telnyxcompute.com/webhook/scheduling \
  -H "Content-Type: application/json" \
  -d '{
    "slotId": "SLOT-8217",
    "provider": "Dr. Okafor",
    "startsAt": "2026-10-08T10:00:00",
    "missedPatient": { "name": "Alex Rivera", "phone": "+15557000001" },
    "waitlist": [
      { "name": "Casey Doyle", "phone": "+15557000003", "priority": 1 },
      { "name": "Brooke Chen", "phone": "+15557000002", "priority": 2 },
      { "name": "Devin Shah",  "phone": "+15557000004", "priority": 3 }
    ]
  }'

# 2. The missed patient replies by SMS — "reschedule" closes the workflow
curl -X POST https://<your-function>.telnyxcompute.com/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000001", "text": "RESCHEDULE please" }'

# 3. Or: missed patient declines → actor works the waitlist in priority order
curl -X POST https://<your-function>.telnyxcompute.com/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000001", "text": "no, can'\''t make it" }'

# 4. Priority-1 waitlist patient (Casey) confirms — first confirmation wins
curl -X POST https://<your-function>.telnyxcompute.com/demo/reply \
  -H "Content-Type: application/json" \
  -d '{ "slotId": "SLOT-8217", "from": "+15557000003", "text": "YES" }'

# 5. Inspect the actor state and outreach ledger
curl https://<your-function>.telnyxcompute.com/state/SLOT-8217
curl https://<your-function>.telnyxcompute.com/ledger/SLOT-8217
```

Demo mode (default) logs every call/SMS to the actor console and accepts the `/demo/*` endpoints above — no charges, no real phone numbers needed. One-shot version of the whole flow: `BASE=<function-url> ./demo.sh`. In live mode, register the secrets above (including `VOICE_ASSISTANT_ID` for the conversational voice channel), then re-ship.

### The live dashboard

`GET /` serves a dark, auto-refreshing dashboard (2s polling over `GET /api/dashboard`): one card per open slot with its status badge, waitlist progress, current candidate (phone numbers are masked for demos), confirmation banner, and the outreach ledger. Closed slots disappear when the slot resolves.

### Local development server

`npm run dev` runs the real agent code on `node:http` with file-backed durable storage (`.dev-store/`) on `http://localhost:8787` — the full demo flow works locally with zero account-side effects, and killing the server mid-outreach is a hands-on restart proof (see `smoke_test.ts` section 5).

### Project Structure

```
appointment-recovery-waitlist/
├── src/
│   └── index.ts          # AppointmentSlot actor + SlotIndex actor + fetch front door
├── telnyx.toml           # Edge manifest — SLOTS, SLOT_INDEX, [telnyx] binding, [[secrets]]
├── package.json
├── tsconfig.json
├── smoke_test.ts         # State-machine + restart-proof + double-booking tests
├── .env.example
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md
```

## API Reference

See [API.md](./API.md) for the full typed endpoint reference (routes, params, responses).

## Troubleshooting

- **`npm test` fails with "AppointmentSlot is not exported"** — make sure you're on Node 18+ and `npm install` completed successfully.
- **Live calls do not dial** — check `OUTBOUND_CONNECTION_ID` and `OUTBOUND_CALLER_ID` are set: `telnyx-edge secrets list`. The Call Control voice app id is the `OUTBOUND_CONNECTION_ID`.
- **Inbound webhooks return `TELNYX_PUBLIC_KEY is required when DEMO_MODE is false`** — fetch your org's public key once and register it as a secret:
  ```bash
  telnyx-edge secrets add TELNYX_PUBLIC_KEY "$(curl -s https://api.telnyx.com/v2/public_key)"
  ```
- **A confirmation was lost across a worker restart** — it shouldn't be: the confirmation lives in `confirmations` (per-actor SQL, `slot_id` PRIMARY KEY) AND in actor state. Re-run the smoke test (`npm test`) to exercise the restart-proof scenario: "Restart proof: kill mid-outreach, resume with same cursor" — it kills the actor instance and rebuilds it over the same durable store to verify the cursor and confirmation lock survive.
- **Late SMS from a waitlist patient keeps saying "claimed this slot first"** — that's correct: the first confirmation wins and every later reply is rejected. The lock is in the `confirmations` table (`slot_id` PRIMARY KEY) and the actor state.

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

- [order-status-self-service](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/order-status-self-service/README.md) — a customer texts "where's my order?" and a durable `OrderAgent` answers from per-actor SQL state and message history; same `@telnyx/edge-runtime` Agent SDK + `[telnyx]` binding pattern as this sample
- [restaurant-reservation-waitlist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/restaurant-reservation-waitlist-python/README.md) — table-availability + waitlist in Python (different domain, same "waitlist" vocabulary)
- [edge-outage-hotline-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-outage-hotline-typescript/README.md) — multi-actor `RegionAgent` + shared `HotlineIndex` discovery actor — same `env.X.idFromName(...)` pattern as this sample's `SlotIndex`
- [scheduled-reminder-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/scheduled-reminder-agent/README.md) — durable agent that owns a scheduled task lifecycle (the `this.schedule(...)` mechanics used here for sweep timers, retries, and expiry)

## Resources

- Dev docs: [developers.telnyx.com/docs/edge/compute](https://developers.telnyx.com/docs/edge/compute)
- Dev docs: [developers.telnyx.com/docs/v2/call-control](https://developers.telnyx.com/docs/v2/call-control)
- Dev docs: [developers.telnyx.com/docs/v2/messaging](https://developers.telnyx.com/docs/v2/messaging)
- API reference: [developers.telnyx.com/api-reference/v2/calls](https://developers.telnyx.com/api-reference/v2/calls)
- API reference: [developers.telnyx.com/api-reference/v2/messages](https://developers.telnyx.com/api-reference/v2/messages)
- Agent SDK + Edge Runtime: [github.com/team-telnyx/edge-compute](https://github.com/team-telnyx/edge-compute)
- Telnyx Edge SDK (Node): [developers.telnyx.com/development/sdk/node](https://developers.telnyx.com/development/sdk/node)
- Telnyx Edge CLI: [github.com/team-telnyx/edge-compute/releases](https://github.com/team-telnyx/edge-compute/releases)
- Product page: [telnyx.com/products/voice-ai-agents](https://telnyx.com/products/voice-ai-agents)
- Product page: [telnyx.com/products/sms-api](https://telnyx.com/products/sms-api)
- Pricing: [telnyx.com/pricing](https://telnyx.com/pricing)
