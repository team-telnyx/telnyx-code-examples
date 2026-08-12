# Build an Agent SMS Triage Bot

SMS triage bot on Telnyx Edge Compute + Agent SDK — classifies inbound customer messages by topic via LLM inference, looks up the destination queue in a durable route table, and replies via zero-credential SMS.

## How It Works

```
  Inbound SMS → webhook → TriageAgent.triage(from, text)
        │
        ▼
  ┌──────────────────────────────────────────────────┐
  │ Agent SDK (Stateful Actor)                        │
  │                                                  │
  │  1. LLM classify:                                │
  │     → env.TELNYX.ai.openai.chat                  │
  │       .createCompletion()  (topic detection)     │
  │     → topic = billing | support | sales | general│
  │  2. KV route table lookup:                        │
  │     → env.ROUTES.get("route/billing")            │
  │     → returns queue name (global, not per-actor)  │
  │  3. Reply via SMS:                                │
  │     → env.TELNYX.messages.send()  (zero-cred)   │
  │  4. Log triage entry (durable, per-actor)         │
  └──────────────────────────────────────────────────┘
```

## Telnyx Products Used

- **Edge Compute (Agent SDK)** — `Agent` base class with durable state for route table and triage history
- **Messaging** — via `this.env.TELNYX.messages.send()` (pre-authenticated `[telnyx]` binding)
- **AI Inference** — via `this.env.TELNYX.ai.openai.chat.createCompletion()` (pre-authenticated `[telnyx]` binding) for topic classification

## Prerequisites

- [Telnyx Edge CLI](https://github.com/team-telnyx/edge-compute/releases) v0.2.2+
- Node.js 18+
- A Telnyx phone number with a messaging profile (for real SMS)

## Step 1: Understand the Code

### `src/triageAgent.ts` — The Agent

```typescript
export class TriageAgent extends Agent<TriageEnv, TriageState> {
  async triage(from: string, text: string) {
    // 1. LLM classify
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: "moonshotai/Kimi-K2.6",
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: `Customer message: "${text}"` },
      ],
    });
    const { topic, confidence } = JSON.parse(completion.choices[0].message.content);

    // 2. KV route lookup
    const route = await this.env.ROUTES.get(`route/${topic}`);

    // 3. Reply via SMS
    await this.env.TELNYX.messages.send({
      from: state.fromNumber,
      to: from,
      text: `Thanks! Routed to ${route}.`,
    });

    // 4. Log (durable, per-actor)
    await this.setState({ ...state, triageHistory: [...history, entry] });
  }
}
```

### `src/index.ts` — The Front Door

Routes inbound SMS webhooks to the per-number actor:

```typescript
if (evt.event_type === "message.received") {
  await env.TRIAGE.idFromName(actorName(to)).triage(from, text);
}
```

### `telnyx.toml` — Config

```toml
[[actors]]
binding = "TRIAGE"
type = "TriageAgent"

[telnyx]
binding = "TELNYX"  # pre-authenticated client — no API key in code

[[kv]]
binding = "ROUTES"  # global route table — shared across all actors
namespace_id = "<kv-namespace-id>"
```

### Agent SDK Primitives

| Primitive | Method | Purpose |
|-----------|--------|---------|
| Durable State | `this.setState()` / `this.getState()` | Triage history, topic counts (per-actor) |
| KV Namespace | `this.env.ROUTES.get()` / `this.env.ROUTES.put()` | Global route table (shared across all actors) |
| Telnyx Binding | `this.env.TELNYX.messages.send()` | Zero-credential SMS replies |
| Telnyx Binding | `this.env.TELNYX.ai.openai.chat.createCompletion()` | Zero-credential topic classification |

## Step 2: Deploy

```bash
npm install
telnyx-edge ship
```

## Step 3: Point your messaging profile webhook

In the [Telnyx Portal](https://portal.telnyx.com/messaging/profiles):
1. Create or edit a Messaging Profile assigned to your Telnyx number
2. Set the **Webhook URL** → `https://agent-sms-triage-bot-<id>.telnyxcompute.com/webhooks/sms`

## Step 4: Test

### Health

```bash
curl https://agent-sms-triage-bot-<id>.telnyxcompute.com/health/liveness
```

### Simulate inbound SMS (no real SMS needed)

```bash
# Billing question
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/debug/triage \
  -H "Content-Type: application/json" \
  -d '{"from":"+17177247292","text":"Why was I charged $50?"}'

# Sales question
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/debug/triage \
  -H "Content-Type: application/json" \
  -d '{"from":"+17177247292","text":"I want to upgrade my plan"}'

# Support question
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/debug/triage \
  -H "Content-Type: application/json" \
  -d '{"from":"+17177247292","text":"The app keeps crashing when I log in"}'
```

### View triage history

```bash
curl "https://agent-sms-triage-bot-<id>.telnyxcompute.com/history?number=+16282564655"
```

### Update a route

```bash
curl -X POST https://agent-sms-triage-bot-<id>.telnyxcompute.com/routes \
  -H "Content-Type: application/json" \
  -d '{"topic":"billing","queue":"priority-billing-queue"}'
```

## Going to Production

- **Webhook signature verification** — verify the `telnyx-signature-ed25519` header
- **Custom topics** — add topics beyond billing/support/sales/general via `POST /routes`
- **Multi-language** — detect language and route to language-specific queues
- **Escalation** — high-confidence sales leads could trigger an immediate callback
- **Analytics dashboard** — expose topic counts over time via a REST endpoint
- **Integration** — forward triaged messages to Slack, Zendesk, or Salesforce via webhook

## Run

```bash
npm install
telnyx-edge ship
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md)
- [Agent SDK Overview](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK Quickstart](https://developers.telnyx.com/docs/agent-sdk/quickstart)
- [Roll Your Own Agent](https://developers.telnyx.com/docs/agent-sdk/examples/roll-your-own)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
