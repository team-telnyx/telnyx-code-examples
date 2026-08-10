# Guide: Building an Entity Agent on Telnyx Edge Compute

This guide walks through the `edge-customer-agent-typescript` sample and shows how the Entity Agent pattern maps to Telnyx Edge Compute primitives. Read this alongside `README.md` (architecture) and `API.md` (endpoint reference).

## The Big Idea

> The Assistant isn't the durable object. **Ian is.**

A conventional AI Assistant is stateless — every call is a fresh conversation. You bolt memory on with a database lookup, but the assistant itself is ephemeral.

An **Entity Agent** inverts this. The durable object IS the entity — a customer, an order, a ticket. The AI Assistant is a reasoning harness that lives *inside* the entity. The entity owns:

- **Identity** — the actor name is the customer's phone number (`env.AGENT.idFromName("+13125550100")`)
- **State** — `CustomerState` persisted in Edge Storage, survives across days/channels/restarts
- **Schedule** — `this.schedule(259200, "checkShipmentStatus", ...)` lets the entity wake itself
- **Channels** — voice, SMS, WhatsApp all flow through the same durable object
- **Human-in-the-loop** — escalation is just a state flag the entity sets on itself

The Agent SDK (`@telnyx/edge-runtime`) provides the `Agent<E, State>` base class that handles the durable plumbing. Your subclass adds the domain logic.

## Files at a Glance

```
edge-customer-agent-typescript/
├── telnyx.toml          # Edge Compute manifest (actors, telnyx, secrets bindings)
├── package.json         # ESM, @telnyx/edge-runtime dep
├── tsconfig.json        # ES2022, bundler resolution, strict
├── .env.example         # Required environment variables
├── README.md            # Overview, architecture, AC table
├── API.md               # Typed webhook reference
├── GUIDE.md             # This file
└── src/
    ├── index.ts         # Fetch handler — webhook router → actor methods
    ├── customer-agent.ts# CustomerAgent extends Agent<Env, CustomerState>
    ├── state.ts         # CustomerState interface + helpers
    ├── llm.ts           # Telnyx Inference (OpenAI-compatible) client
    ├── salesforce.ts    # Salesforce client (mockable)
    ├── voice.ts         # TeXML builders + Call Control commands
    └── messaging.ts     # Telnyx binding types + SMS helpers
```

## Acceptance Criteria → Code

The README lists 8 acceptance criteria (AC1–AC8). Each maps to specific code.

### AC1 — Actor IS the Customer

> The actor name is the customer's phone number. State survives across channels and days.

**Where**: `src/index.ts` (every webhook handler), `src/customer-agent.ts` (class definition), `src/state.ts` (state shape)

The fetch handler resolves the actor from the webhook payload:

```ts
// src/index.ts
const customerId = env.AGENT.idFromName(payload.from);
const stub = env.AGENT.get(customerId);
await stub.handleSMS(payload.from, payload.to, payload.text);
```

The actor class extends the SDK's `Agent` base:

```ts
// src/customer-agent.ts
export class CustomerAgent extends Agent<Env, CustomerState> {
  initialState(): CustomerState { return initialCustomerState(); }
  // ...
}
```

State persists in Edge Storage between invocations. There is exactly one durable object per customer.

### AC2 — Voice Channel

> Ian calls. The AI Assistant answers, grounded in his state.

**Where**: `src/customer-agent.ts` (`handleCall`), `src/voice.ts` (`buildInboundTeXml`)

When a Telnyx Call Control webhook hits `POST /webhooks/voice`, the fetch handler calls `handleCall()`. The agent records the interaction, then returns TeXML with an `<AIAssistant>` element:

```ts
// src/customer-agent.ts
async handleCall(callControlId: string, from: string, to: string): Promise<string> {
  this.setState({
    last_interaction_at: new Date().toISOString(),
    preferred_channel: "voice",
  });
  this.messages.add({ role: "system", content: this.systemPrompt() });
  this.messages.add({ role: "assistant", content: `Inbound call from ${from}` });
  return buildInboundTeXml(this.env.TELNYX_AI_ASSISTANT_ID);
}
```

`buildInboundTeXml` returns the TeXML that tells Telnyx to answer with the AI Assistant:

```xml
<Response>
  <AIAssistant id="..." voice="ian">Hi Ian, how can I help you today?</AIAssistant>
</Response>
```

The Assistant ID is configured via the `TELNYX_AI_ASSISTANT_ID` secret.

### AC3 — Follow-Up SMS After Call

> After the call ends, the agent sends a follow-up SMS — without an external scheduler.

**Where**: `src/customer-agent.ts` (`onCallEnded`, `sendFollowupSMS`)

Telnyx fires a `call-ended` webhook when the call hangs up. The fetch handler calls `onCallEnded()`, which records the interaction and uses `this.queue()` to schedule `sendFollowupSMS`:

```ts
// src/customer-agent.ts
async onCallEnded(callControlId: string, duration: number): Promise<void> {
  this.recordInteraction({ channel: "voice", direction: "inbound", summary: `Call (${duration}s)` });
  this.queue("sendFollowupSMS", {});
}

async sendFollowupSMS(): Promise<void> {
  const draft = await draftFollowup(this.messages.all(), this.state, this.env);
  if (!draft) return;
  await sendSMS(this.env, this.state.phone_e164, draft);
  this.recordInteraction({ channel: "sms", direction: "outbound", summary: draft });
}
```

`queue()` runs the method on the same durable object after the webhook returns. No external queue or cron is required.

### AC4 — SMS Channel

> Ian texts. The agent replies, grounded in the conversation so far.

**Where**: `src/customer-agent.ts` (`handleSMS`), `src/llm.ts` (`draftReply`), `src/messaging.ts` (`sendSMS`)

Inbound SMS hits `POST /webhooks/messaging`. The fetch handler calls `handleSMS()`:

```ts
// src/customer-agent.ts
async handleSMS(from: string, to: string, text: string): Promise<void> {
  const intent = await classifyIntent(text, this.env);

  if (intent === "escalation") {
    this.escalateToHuman(`Customer SMS: ${text}`);
    return;
  }

  this.messages.add({ role: "user", content: text });
  this.setState({ last_interaction_at: new Date().toISOString(), preferred_channel: "sms" });

  const reply = await draftReply(this.messages.all(), this.state, this.env);
  if (!reply) return;
  await sendSMS(this.env, from, reply);

  this.messages.add({ role: "assistant", content: reply });
  this.recordInteraction({ channel: "sms", direction: "inbound", summary: text });
  this.recordInteraction({ channel: "sms", direction: "outbound", summary: reply });
}
```

`draftReply` calls Telnyx Inference (OpenAI-compatible endpoint at `https://api.telnyx.com/v2/ai/openai`) with the full message log + state as context:

```ts
// src/llm.ts
export async function draftReply(messages, state, env): Promise<string | null> {
  const llm = telnyxLLM(env);
  const response = await llm.chat.completions.create({
    model: env.TELNYX_AI_MODEL || "zai-org/GLM-5.2",
    messages: [
      { role: "system", content: systemPrompt(state) },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });
  return response.choices[0]?.message?.content ?? null;
}
```

If `classifyIntent` returns `"escalation"`, the agent escalates instead of replying (AC5).

### AC5 — Human-in-the-Loop Escalation

> The agent escalates to a human when it should. The human replies and the agent resumes.

**Where**: `src/customer-agent.ts` (`escalateToHuman`, `resumeEscalation`), `src/index.ts` (`POST /hitl/reply`)

`escalateToHuman` sets a flag in state:

```ts
// src/customer-agent.ts
escalateToHuman(reason: string): void {
  this.setState({
    escalation_pending: true,
    escalation_reason: reason,
    escalation_at: new Date().toISOString(),
  });
  this.messages.add({ role: "system", content: `Escalation requested: ${reason}` });
}
```

While `escalation_pending` is `true`, the agent will not reply to further SMS — it queues them. The human replies via `POST /hitl/reply`:

```ts
// src/index.ts
if (url.pathname === "/hitl/reply" && request.method === "POST") {
  const { phone_e164, reply_text } = await request.json();
  if (!phone_e164 || !reply_text) return json({ error: "missing phone_e164 or reply_text" }, 400);
  const stub = env.AGENT.get(env.AGENT.idFromName(phone_e164));
  await stub.resumeEscalation(reply_text);
  return json({ ok: true });
}
```

`resumeEscalation` clears the flag, appends the human reply to `this.messages`, and forwards the reply to the customer on their preferred channel:

```ts
// src/customer-agent.ts
async resumeEscalation(replyText: string): Promise<void> {
  if (!this.state.escalation_pending) return;
  this.setState({ escalation_pending: false, escalation_reason: null, escalation_at: null });
  this.messages.add({ role: "assistant", content: replyText });
  if (this.state.preferred_channel === "sms") {
    await sendSMS(this.env, this.state.phone_e164, replyText);
  }
  this.recordInteraction({ channel: "sms", direction: "outbound", summary: `HITL: ${replyText}` });
}
```

### AC6 — Self-Waking via `schedule()`

> The agent schedules a shipment check 3 days out. It wakes itself, checks, and optionally re-schedules.

**Where**: `src/customer-agent.ts` (`watchShipment`, `checkShipmentStatus`)

The agent uses `this.schedule()` (provided by the Agent SDK) to wake itself:

```ts
// src/customer-agent.ts
watchShipment(salesforceId: string): void {
  this.schedule(3 * 24 * 60 * 60, "checkShipmentStatus", { salesforce_id: salesforceId });
  this.setState({ shipment_watch: { salesforce_id: salesforceId, next_check_at: new Date(Date.now() + 3 * 86400_000).toISOString() } });
}

async checkShipmentStatus(payload: { salesforce_id: string }): Promise<void> {
  const shipments = await getShipments(this.salesforce, this.state.phone_e164);
  const target = shipments.find(s => s.salesforce_id === payload.salesforce_id);
  if (!target) return;

  if (target.status === "delivered") {
    this.setState({ shipment_watch: null });
    return;
  }

  if (this.state.proactive_consent) {
    const msg = await draftProactive(`Shipment ${target.salesforce_id} status: ${target.status}`, this.state, this.env);
    if (msg) await sendProactiveSMS(this.env, this.state.phone_e164, msg);
  }

  // Re-schedule for another 3 days
  this.schedule(3 * 24 * 60 * 60, "checkShipmentStatus", payload);
}
```

`schedule(delaySeconds, method, payload?)` is a primitive of the Agent SDK. The actor wakes on its own — no external cron, no Cloudflare Worker, no Celery.

### AC7 — External System (Salesforce) Integration

> A Salesforce status change triggers proactive outreach to the customer.

**Where**: `src/customer-agent.ts` (`ingestSalesforceUpdate`), `src/salesforce.ts` (`SalesforceClient`)

Salesforce posts to `POST /webhooks/salesforce` when a shipment status changes. The fetch handler calls `ingestSalesforceUpdate()`:

```ts
// src/customer-agent.ts
async ingestSalesforceUpdate(update: {
  salesforce_id: string;
  status: string;
  tracking_number?: string;
  estimated_delivery?: string;
}): Promise<void> {
  this.setState({
    shipments: [
      ...this.state.shipments.filter(s => s.salesforce_id !== update.salesforce_id),
      {
        salesforce_id: update.salesforce_id,
        status: update.status,
        tracking_number: update.tracking_number ?? null,
        estimated_delivery: update.estimated_delivery ?? null,
        last_updated: new Date().toISOString(),
      },
    ],
  });

  if (this.state.proactive_consent) {
    const msg = await draftProactive(`Your shipment ${update.salesforce_id} is now ${update.status}.`, this.state, this.env);
    if (msg) await sendProactiveSMS(this.env, this.state.phone_e164, msg);
  }

  this.recordInteraction({ channel: "system", direction: "outbound", summary: `SF update: ${update.status}` });
}
```

`SalesforceClient` is behind a seam so you can mock it in tests:

```ts
// src/salesforce.ts
export class SalesforceClient {
  constructor(private env: Env) {}

  async getCustomer(phoneE164: string): Promise<SalesforceCustomer | null> { /* ... */ }
  async getShipments(phoneE164: string): Promise<Shipment[]> { /* ... */ }
  async updateShipmentStatus(salesforceId: string, status: string): Promise<void> { /* ... */ }
}
```

Set `USE_MOCK_SALESFORCE=true` in `.env` to use a mock implementation that returns canned data.

### AC8 — Unified Customer Context

> Any channel returns the same customer context — voice, SMS, or programmatic.

**Where**: `src/customer-agent.ts` (`getCustomerContext`), `src/state.ts` (`CustomerState`)

```ts
// src/customer-agent.ts
getCustomerContext(): CustomerState {
  return this.state;
}
```

The state shape includes identity, shipments, interaction log, preferences, escalation flag, and schedule:

```ts
// src/state.ts
export interface CustomerState {
  phone_e164: string;
  salesforce_id: string | null;
  preferred_channel: "voice" | "sms" | "whatsapp";
  proactive_consent: boolean;
  shipments: Shipment[];
  escalation_pending: boolean;
  escalation_reason: string | null;
  escalation_at: string | null;
  shipment_watch: { salesforce_id: string; next_check_at: string } | null;
  last_interaction_at: string | null;
  interaction_count: number;
  interactions: Interaction[];
  created_at: string;
  updated_at: string;
}
```

Because the actor is the single durable object for the customer, all channels read and write the same state.

## Telnyx Edge Compute Primitives Used

| Primitive | Where | Purpose |
|-----------|-------|---------|
| `Agent<E, State>` | `customer-agent.ts` | Durable entity with typed state |
| `this.messages` | `handleSMS`, `handleCall`, `resumeEscalation` | Conversation log (MessageLog) |
| `this.getState()` / `this.setState()` | everywhere | Typed state management |
| `this.schedule()` | `watchShipment` | Self-waking — no external cron |
| `this.queue()` | `onCallEnded` | Run a method after webhook returns |
| `this.env.TELNYX` | `sendSMS`, LLM client | Telnyx SDK binding (messaging + AI) |
| `this.env.AGENT` | `index.ts` | Actor namespace binding |
| `this.env.SECRETS` | everywhere | Secret references |

## Telnyx Binding

The `[telnyx]` section in `telnyx.toml` exposes the Telnyx SDK as `this.env.TELNYX`:

```toml
# telnyx.toml
[telnyx]
binding = "TELNYX"
```

This gives you the standard `telnyx` npm client inside the edge function:

```ts
// src/messaging.ts
import Telnyx from "telnyx";
export async function sendSMS(env: Env, to: string, body: string): Promise<void> {
  const telnyx = new Telnyx(env.SECRETS.TELNYX_API_KEY);
  await telnyx.messages.create({ from: env.TELNYX_FROM_NUMBER, to, text: body });
}
```

For AI inference, Telnyx is OpenAI-compatible. Point an OpenAI client at the Telnyx base URL:

```ts
// src/llm.ts
import OpenAI from "openai";
export function telnyxLLM(env: Env): OpenAI {
  return new OpenAI({
    apiKey: env.SECRETS.TELNYX_API_KEY,
    baseURL: "https://api.telnyx.com/v2/ai/openai",
  });
}
```

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env
# Fill in TELNYX_API_KEY, TELNYX_AI_ASSISTANT_ID, TELNYX_FROM_NUMBER

# 3. Start the local edge runtime
npm start

# 4. Expose via ngrok (for Telnyx webhook delivery)
ngrok http 8787
```

Configure Telnyx webhooks to point at your ngrok URL:
- Voice: `https://<ngrok>.ngrok.io/webhooks/voice`
- Call ended: `https://<ngrok>.ngrok.io/webhooks/call-ended`
- Messaging: `https://<ngrok>.ngrok.io/webhooks/messaging`

## Deploying

```bash
# Deploy to Telnyx Edge Compute
telnyx-edge deploy
```

The `telnyx.toml` manifest tells the runtime about the actor binding, Telnyx binding, and secret references. The runtime provisions the durable object namespace and wires up the bindings.

## Testing the Flow

1. **Call** your Telnyx number → AI Assistant answers (AC2)
2. **Hang up** → follow-up SMS arrives within seconds (AC3)
3. **Text** your Telnyx number → agent replies (AC4)
4. **Text "speak to a human"** → escalation flag set (AC5)
5. **POST /hitl/reply** with your reply → customer gets SMS (AC5)
6. **POST /webhooks/salesforce** with a shipment update → proactive SMS to customer (AC7)
7. **Call `watchShipment`** programmatically → wait 3 days → agent self-wakes (AC6)

## Why This Matters

The Entity Agent pattern is different from "AI Assistant with a database":

- **No glue code** for state, scheduling, or channels — the Agent SDK owns it
- **No external cron** — `schedule()` is a first-class primitive
- **No channel-specific logic** — voice, SMS, WhatsApp all hit the same durable object
- **No "memory plugin"** — state IS the agent, not a sidecar
- **Human-in-the-loop is a flag** — not a separate queue system

This is what "AI Communications Infrastructure" means in practice: the durable entity, the reasoning harness, and the comms channels are all one thing.

## Related Examples

- `edge-call-control-ai-assistant-python` — TeXML + AI Assistant (voice only, no entity)
- `edge-send-sms-python` — Telnyx Messaging API basics
- `edge-schedule-reminder-go` — Durable actor scheduling primitive

## Next Steps

- Read `README.md` for the architecture diagram and acceptance criteria table
- Read `API.md` for the full webhook reference
- Browse `src/customer-agent.ts` to see how the pattern composes
- Check the [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk) for the full primitive set
