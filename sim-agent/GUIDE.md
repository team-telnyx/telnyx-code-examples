# SIMAgent — The Actor IS the SIM

A step-by-step tutorial for the `sim-agent` sample, which demonstrates a Telnyx Edge Agent that acts as a persistent, stateful SIM card entity. The agent tracks data usage, proactively alerts on thresholds, responds to natural-language customer queries, auto-provisions plan upgrades via the Telnyx API, and answers inbound calls with full usage history.

---

## Prerequisites

- Node.js 18+
- A Telnyx account with an API key (get one at [telnyx.com](https://telnyx.com))
- The Telnyx CLI (optional, for local testing): `npm install -g @telnyx/telnyx-cli`
- A phone number provisioned in your Telnyx account (for live mode)

---

## Environment Setup

### 1. Clone and install

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sim-agent
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Telnyx API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1555XXXXXXXX
TELNYX_SIM_ID=sim-abc123
OPENAI_API_KEY=your_openai_api_key_here
```

> **Demo mode** is the default. No real SMS, calls, or provisioning actions are taken. See the [Demo vs Live Mode](#demo-vs-live-mode) section below.

---

## Project Structure

```
sim-agent/
├── src/
│   └── index.ts          # Main agent entry point
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── smoke_test.ts
├── README.md
├── API.md
└── GUIDE.md
```

---

## How It Works

The `SIMAgent` is a Telnyx Edge Agent that extends the `Agent` base class. It represents a single SIM card as a durable, stateful entity. Here's the demo flow:

### 1. Agent Initialization — `SIMAgent("sim-abc123")`

The agent is instantiated with a unique SIM identifier. On startup, it loads persistent state from KV:

```typescript
const usage = await this.kv.get(`sim:${this.simId}:usage`);
const plan = await this.kv.get(`sim:${this.simId}:plan`);
```

This state persists across billing cycles and reboots — the actor IS the SIM, not a transient conversation.

### 2. Normal Usage (Days 1–15) — Silent Operation

The agent schedules a daily check using `this.schedule()` and `every()`:

```typescript
this.schedule('0 9 * * *', () => this.checkUsageThreshold());
```

During normal usage, the agent receives webhook updates from Telnyx with data usage. It updates its KV counters silently — no alerts are sent.

### 3. 80% Threshold Alert (Day 16) — Proactive SMS

When usage crosses 80% of the plan limit, the agent wakes and sends a proactive SMS:

```typescript
await this.telnyx.messages.create({
  from: this.phoneNumber,
  to: this.customerPhone,
  text: `You've used 80% of your data plan (${used}MB of ${limit}MB).`
});
```

This uses the `[telnyx]` binding's SMS channel.

### 4. Customer Inquiry (Day 17) — Natural Language Plan Comparison

When the customer replies "what are my options?", the agent uses the OpenAI LLM binding to generate a natural-language comparison of available plans:

```typescript
const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: 'gpt-3.5-turbo',
  messages: [
    { role: 'system', content: 'You are a SIM plan advisor...' },
    { role: 'user', content: `Customer has used ${used}MB of ${limit}MB. What plans are available?` }
  ]
});
```

The agent parses the LLM response and sends it back as an SMS.

### 5. Auto-Provisioning Upgrade (Day 17) — Telnyx API

When the customer texts "upgrade to 10GB", the agent provisions the upgrade via the Telnyx API:

```typescript
await this.telnyx.simCards.update(this.simId, {
  data_plan: { id: 'plan_10gb_monthly' }
});
```

It then sends a confirmation SMS and updates the KV state.

### 6. Webhook Updates (Day 20) — State Sync

Telnyx sends data usage webhooks to the agent's webhook endpoint. The agent verifies the Ed25519 signature and updates its state:

```typescript
const event = client.webhooks.unwrap(req.body, req.headers);
const usage = event.data.payload.usage;
await this.kv.set(`sim:${this.simId}:usage`, usage);
```

### 7. Billing Cycle Reset (Day 30) — Scheduled Reset

The agent uses `this.schedule()` to reset counters at the end of each billing cycle:

```typescript
this.schedule('0 0 1 * *', () => this.resetBillingCycle());
```

It sends a billing summary SMS and resets usage counters in KV.

### 8. Inbound Call (Day 31) — Call Control with Usage History

When the customer calls, the agent answers using Telnyx Call Control and speaks the full usage history:

```typescript
await this.telnyx.calls.create({
  from: this.customerPhone,
  to: this.phoneNumber,
  webhook_url: this.webhookUrl,
  webhook_url_method: 'POST'
});
```

The agent uses text-to-speech to read out the usage summary, plan details, and billing history.

---

## Telnyx Primitives Used

| Primitive | How It's Used |
|-----------|---------------|
| **Agent SDK** | `class SIMAgent extends Agent` — owns the SIM entity with persistent state |
| **`schedule()` + `every()`** | Daily threshold checks, billing cycle resets |
| **`[telnyx]` binding** | SMS sending, call control, SIM provisioning via Telnyx API |
| **Webhooks** | Inbound data usage updates from Telnyx (Ed25519 verified) |
| **KV** | Persistent storage for usage counters, plan info, alert state |
| **Inference (LLM)** | Natural language plan comparison via `this.env.TELNYX.ai.openai.chat.createCompletion()` |
| **Call Control** | Customer calls answered with full usage history via text-to-speech |

---

## Demo vs Live Mode

### Demo Mode (Default)

By default, the agent runs in **demo mode**. In this mode:

- SMS messages are logged to the console instead of being sent
- Call Control actions are simulated (no real calls placed)
- SIM provisioning updates are logged, not executed
- Webhook payloads are processed but no real Telnyx resources are modified

To enable demo mode, ensure `.env` does **not** contain `TELNYX_LIVE_MODE=true`:

```env
# .env (demo mode)
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1555XXXXXXXX
TELNYX_SIM_ID=sim-abc123
OPENAI_API_KEY=your_openai_api_key_here
# TELNYX_LIVE_MODE is not set — demo mode active
```

### Live Mode

To switch to **live mode**, set `TELNYX_LIVE_MODE=true` in your `.env`:

```env
TELNYX_API_KEY=your_real_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1555XXXXXXXX
TELNYX_SIM_ID=sim-abc123
OPENAI_API_KEY=your_real_openai_api_key_here
TELNYX_LIVE_MODE=true
```

In live mode, the agent will:
- Send real SMS messages via Telnyx
- Place and receive real calls via Call Control
- Execute real SIM provisioning updates via the Telnyx API
- Process real webhook events from Telnyx

> **Warning**: Live mode incurs real charges. Use only with a test SIM and verified phone numbers.

---

## Running the Sample

### Local Development

```bash
npm run dev
```

This starts the agent locally using the Telnyx Edge runtime emulator. The agent will:
1. Load state from KV (or initialize fresh state)
2. Register webhook endpoints
3. Begin scheduled tasks (threshold checks, billing resets)

### Smoke Test

Before running, verify the agent loads correctly:

```bash
npm run smoke-test
```

This imports the `SIMAgent` class and verifies it initializes without error.

### Deploying

Deploy to Telnyx Edge:

```bash
telnyx deploy
```

---

## Key Code Locations

| Feature | File | Description |
|---------|------|-------------|
| Agent class definition | `src/index.ts` | `class SIMAgent extends Agent` with SIM state |
| Threshold check logic | `src/index.ts` | `checkUsageThreshold()` method — 80% alert |
| Plan comparison | `src/index.ts` | `comparePlans()` method — LLM-powered |
| Auto-provisioning | `src/index.ts` | `upgradePlan()` method — Telnyx API call |
| Billing cycle reset | `src/index.ts` | `resetBillingCycle()` method — scheduled |
| Call handling | `src/index.ts` | `handleIncomingCall()` method — Call Control |
| Webhook handler | `src/index.ts` | `handleWebhook()` method — Ed25519 verified |
| KV state management | `src/index.ts` | `loadState()` / `saveState()` methods |

---

## Next Steps

- **Telnyx Edge Agents Documentation**: [https://docs.telnyx.com/edge/agents](https://docs.telnyx.com/edge/agents)
- **Telnyx SMS API**: [https://docs.telnyx.com/api/messages](https://docs.telnyx.com/api/messages)
- **Telnyx Call Control**: [https://docs.telnyx.com/voice/call-control](https://docs.telnyx.com/voice/call-control)
- **Telnyx SIM Cards API**: [https://docs.telnyx.com/api/sim-cards](https://docs.telnyx.com/api/sim-cards)
- **Telnyx Webhooks Guide**: [https://docs.telnyx.com/webhooks](https://docs.telnyx.com/webhooks)
- **Telnyx Edge KV Store**: [https://docs.telnyx.com/edge/kv](https://docs.telnyx.com/edge/kv)
- **Telnyx AI Inference**: [https://docs.telnyx.com/edge/ai](https://docs.telnyx.com/edge/ai)
- **Telnyx Edge Scheduling**: [https://docs.telnyx.com/edge/schedule](https://docs.telnyx.com/edge/schedule)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Agent fails to load | Check that `TELNYX_API_KEY` is set in `.env` |
| SMS not sending | Verify `TELNYX_PHONE_NUMBER` is a valid Telnyx number |
| Webhook verification fails | Ensure you're using the correct public key from Telnyx dashboard |
| LLM responses are slow | Check `OPENAI_API_KEY` is valid and has sufficient quota |
| Call Control not working | Verify your phone number is in E.164 format |
| KV state not persisting | Ensure the agent is running on Telnyx Edge (not local emulator) |

---

## Related Examples

- **`sms-chatbot`** — A simpler SMS-based chatbot without persistent state
- **`voice-agent`** — A Call Control agent for voice-only interactions
- **`kv-counter`** — A minimal example of KV store usage on Telnyx Edge
- **`scheduled-tasks`** — Demonstrates `this.schedule()` and `every()` patterns

---

## Resources

- **Telnyx Developer Portal**: [https://developers.telnyx.com](https://developers.telnyx.com)
- **Telnyx Community Forum**: [https://community.telnyx.com](https://community.telnyx.com)
- **Telnyx Status Page**: [https://status.telnyx.com](https://status.telnyx.com)
- **GitHub Repository**: [https://github.com/team-telnyx/telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples)
