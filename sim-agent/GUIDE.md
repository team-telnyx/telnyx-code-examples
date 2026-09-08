# SIMAgent — The Actor IS the SIM

A step-by-step tutorial for the `sim-agent` sample, which demonstrates a Telnyx Edge Agent that acts as a persistent, stateful SIM card entity. The agent tracks data usage, proactively alerts on thresholds, responds to natural-language customer queries, auto-provisions plan upgrades via the Telnyx API, and answers inbound calls with full usage history.

---

## Prerequisites

- Node.js 20+
- A Telnyx account with an API key (get one at [telnyx.com](https://telnyx.com))
- The Telnyx Edge CLI (`telnyx-edge`) for local development and deployment
- A phone number provisioned in your Telnyx account (for live mode)
- A SIM card registered in Telnyx Wireless (for live mode)

---

## Environment Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-agent
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Telnyx credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_SMS_FROM_NUMBER=+1555XXXXXXXX
DEMO_MODE=true
```

> **Demo mode** is the default. No real SMS, calls, or provisioning actions are taken. See the [Demo vs Live Mode](#demo-vs-live-mode) section below.

---

## Project Structure

```
sim-agent/
├── src/
│   ├── index.ts            # Worker: routes webhooks and demo requests to the agent
│   └── simAgent.ts         # SIMAgent class — the actor IS the SIM
├── scripts/
│   ├── smoke.mjs           # Self-contained smoke test (builds and exercises the flow)
│   └── start.mjs           # Boots `telnyx-edge dev`
├── package.json
├── tsconfig.json
├── telnyx.toml             # Edge bindings: actors, [telnyx], secrets, env_vars
├── .env.example
├── README.md
├── API.md
└── GUIDE.md
```

---

## How It Works

The `SIMAgent` is a Telnyx Edge Agent that extends the `Agent` base class. It represents a single SIM card as a durable, stateful entity. Here's the demo flow:

### 1. Agent Initialization — `SIMAgent("sim-abc123")`

The worker routes each SIM ID to a durable actor via the `[[actors]]` binding in `telnyx.toml`:

```typescript
const stub = env.SIM_AGENT.idFromName(`sim-${simId}`);
await stub.initialize({ simId, phoneNumber, plan: "1GB" });
```

The same SIM ID always routes back to the same durable actor. State persists via the SDK's merge-patch state store — the actor IS the SIM, not a transient conversation.

### 2. Normal Usage (Days 1–15) — Silent Operation

The agent arms two durable named timers during initialization:

```typescript
await this.every(checkSeconds, "checkThresholds", undefined, { id: "usage-check" });
await this.every(cycleSeconds, "resetBillingCycle", undefined, { id: "billing-cycle" });
```

Tasks ride the actor's single alarm slot and survive crashes and restarts. During normal usage, the agent receives usage updates from Telnyx and updates its durable state silently — no alerts are sent.

### 3. 80% Threshold Alert (Day 16) — Proactive SMS

When usage crosses 80% of the plan limit, the agent sends a proactive SMS:

```typescript
await this.env.TELNYX.messages.send({
  from: this.env.TELNYX_SMS_FROM_NUMBER,
  to,
  text: `You've used ${Math.round(pct)}% of your data on SIM ${state.simId}. Reply "options" for upgrade plans.`,
});
```

This uses the `[telnyx]` binding's SMS channel.

### 4. Customer Inquiry (Day 17) — Natural Language Plan Comparison

When the customer replies "what are my options?", the agent uses the Telnyx inference binding to generate a natural-language comparison of available plans:

```typescript
const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: state.model,
  messages: [
    { role: 'system', content: 'You are a helpful SIM card assistant...' },
    { role: 'user', content: `Current plan: ${state.plan.name}. Available plans: ...` }
  ]
});
```

The reply is sent back as an SMS. If inference fails, the agent falls back to a plain preset list.

### 5. Auto-Provisioning Upgrade (Day 17) — Telnyx API

When the customer texts "upgrade to 10GB", the agent provisions the upgrade via the Telnyx API:

```typescript
await this.env.TELNYX.simCards.update(state.simId, {
  data_limit: { amount: "10", unit: "GB" },
});
```

It then sends a confirmation SMS and updates durable state.

### 6. Webhook Updates (Day 20) — State Sync

Telnyx sends data usage webhooks to the worker's `/webhooks/usage` endpoint. In live mode the handler verifies the Ed25519 signature before trusting the body:

```typescript
const publicKey = await env.SECRETS?.get("TELNYX_PUBLIC_KEY");
const event = telnyxClient.webhooks.unwrap(rawBody, { headers, key: publicKey });
await env.SIM_AGENT.idFromName(actorName).recordUsage({ deltaMB: usageMb });
```

### 7. Billing Cycle Reset (Day 30) — Scheduled Reset

The durable `billing-cycle` timer fires `resetBillingCycle()`, which sends a billing summary SMS and resets the usage counters in durable state.

### 8. Inbound Call (Day 31) — Call Control with Usage History

When the customer calls, the worker receives `call.initiated` and answers using Telnyx Call Control, speaking the full usage history:

```typescript
const context = await env.SIM_AGENT.idFromName(actorName).handleInboundCall();
await telnyxAction(env.TELNYX_API_KEY, callControlId, "answer", {});
await telnyxAction(env.TELNYX_API_KEY, callControlId, "speak", { payload: context.message, voice: "Telnyx.KokoroTTS.af" });
```

The agent uses text-to-speech to read out the usage summary, plan details, and history.

---

## Telnyx Primitives Used

| Primitive | How It's Used |
|-----------|---------------|
| **Agent SDK** | `class SIMAgent extends Agent` — owns the SIM entity with persistent state |
| **`every()` + `schedule()`** | Threshold re-checks, billing cycle resets |
| **`[telnyx]` binding** | SMS sending, inference, SIM provisioning via the real Telnyx API client |
| **Webhooks** | Inbound usage/SMS/call events from Telnyx (Ed25519 verified in live mode) |
| **Durable state** | `getState()` / `setState()` for usage counters, plan info, alert state |
| **Inference (LLM)** | Natural language plan comparison via `this.env.TELNYX.ai.openai.chat.createCompletion()` |
| **Call Control** | Customer calls answered with full usage history via text-to-speech |

---

## Demo vs Live Mode

### Demo Mode (Default)

By default, the agent runs in **demo mode** (`DEMO_MODE=true`). In this mode:

- SMS messages are recorded in the agent's event log instead of being sent
- Call Control actions are simulated (no real calls placed)
- SIM provisioning updates are simulated, not executed
- Webhook payloads are parsed without Ed25519 verification

```env
# .env (demo mode)
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_SMS_FROM_NUMBER=+1555XXXXXXXX
DEMO_MODE=true
```

### Live Mode

To switch to **live mode**, set `DEMO_MODE=false` in your `.env`:

```env
TELNYX_API_KEY=your_real_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_real_telnyx_public_key_here
TELNYX_SMS_FROM_NUMBER=+1555XXXXXXXX
DEMO_MODE=false
```

In live mode, the agent will:
- Send real SMS messages via Telnyx
- Answer and speak on real calls via Call Control
- Execute real SIM provisioning updates via `POST /v2/sim_cards/{id}`
- Verify every inbound webhook with `telnyx.webhooks.unwrap`

> **Warning**: Live mode incurs real charges. Use only with a test SIM and verified phone numbers.

---

## Running the Sample

### Local Development

```bash
npm start
```

This typechecks, builds, and starts the agent locally with `telnyx-edge dev`. The agent will:
1. Load durable state (or initialize fresh state on first contact)
2. Serve the webhook and demo endpoints
3. Resume durable scheduled tasks (threshold checks, billing resets)

### Smoke Test

Verify the agent end to end without any external services:

```bash
npm run build
npm run smoke
```

The smoke test runs a real Node HTTP server around the compiled worker with an in-process actor host, then exercises the full demo flow: threshold alert, plan Q&A, upgrade, webhooks, and health.

### Deploying

Deploy to Telnyx Edge:

```bash
telnyx-edge ship
```

---

## Key Code Locations

| Feature | File | Description |
|---------|------|-------------|
| Agent class definition | `src/simAgent.ts` | `class SIMAgent extends Agent` with SIM state |
| Threshold check logic | `src/simAgent.ts` | `checkThresholds()` method — 80% proactive alert |
| Plan comparison | `src/simAgent.ts` | `planOptionsReply()` method — LLM-powered with fallback |
| Auto-provisioning | `src/simAgent.ts` | `provisionUpgrade()` method — `TELNYX.simCards.update()` |
| Billing cycle reset | `src/simAgent.ts` | `resetBillingCycle()` method — durable timer |
| Call handling | `src/index.ts` | `handleCallWebhook()` — Call Control answer + speak |
| Webhook intake | `src/index.ts` | `webhookBody()` — Ed25519 verified in live mode |
| Durable state | `src/simAgent.ts` | `getState()` / `setState()` merge-patch state store |

---

## Next Steps

- **Telnyx Edge Compute**: [https://developers.telnyx.com/docs/edge-compute](https://developers.telnyx.com/docs/edge-compute)
- **Telnyx SMS API**: [https://developers.telnyx.com/docs/messaging](https://developers.telnyx.com/docs/messaging)
- **Telnyx Call Control**: [https://developers.telnyx.com/docs/voice/programmable-voice](https://developers.telnyx.com/docs/voice/programmable-voice)
- **Telnyx SIM Cards API**: [https://developers.telnyx.com/api-reference/sim-cards](https://developers.telnyx.com/api-reference/sim-cards)
- **Telnyx Webhooks**: [https://developers.telnyx.com/docs/development/server-instructions](https://developers.telnyx.com/docs/development/server-instructions)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Agent fails to load | Check that `TELNYX_API_KEY` is set in `.env` |
| SMS not sending | Verify `TELNYX_SMS_FROM_NUMBER` is a valid Telnyx number |
| Webhook verification fails | Ensure `TELNYX_PUBLIC_KEY` matches the public key from the Telnyx dashboard; live mode requires it |
| Plan comparison returns canned text | The inference call failed — check the model name and the `[telnyx]` binding in telnyx.toml |
| Call Control not working | Verify your phone number is in E.164 format and `TELNYX_API_KEY` is configured |
| State not persisting | Ensure the agent runs on Telnyx Edge; durable state requires the actor runtime |

---

## Related Examples

- **`network-incident-agent`** — Durable incident actor with proactive SMS, Call Control, and scheduling
- **`edge-cron-scheduler`** — Durable `every()` / `schedule()` patterns on the Agent SDK
- **`agent-with-tool-calling`** — LLM tool calling with demo-mode SMS transport
- **`conference-agent-mediator`** — Inference and Call Control via the `[telnyx]` binding

---

## Resources

- **Telnyx Developer Portal**: [https://developers.telnyx.com](https://developers.telnyx.com)
- **Telnyx Community Forum**: [https://community.telnyx.com](https://community.telnyx.com)
- **Telnyx Status Page**: [https://status.telnyx.com](https://status.telnyx.com)
- **GitHub Repository**: [https://github.com/team-telnyx/telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples)
