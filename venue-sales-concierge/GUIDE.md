# Venue Sales Concierge — Developer Guide

This guide walks you through the `venue-sales-concierge` sample: a Telnyx Edge Function that powers a branded venue website where event planners interact with an AI concierge via text or voice to check availability, get pricing, request proposals, and book site visits.

---

## Prerequisites

- A Telnyx account with an API key ([sign up](https://portal.telnyx.com/sign-up))
- Node.js 18+ and npm
- The Telnyx Edge CLI installed:

```bash
npm install -g @telnyx/edge-cli
telnyx-edge auth api-key set <YOUR_API_KEY>
```

---

## Project Structure

```
venue-sales-concierge/
├── src/
│   └── index.ts          # Main agent + fetch handler
├── smoke_test.ts         # Verifies classes/methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
└── .gitignore
```

---

## Environment Setup

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Edit `.env` and set your Telnyx API key:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
FROM_NUMBER=+1555XXXXXXXX
VENUE_EMAIL=bookings@yourvenue.com
DEMO_MODE=true
```

3. Install dependencies:

```bash
npm install
```

4. Generate TypeScript types from your `telnyx.toml` bindings:

```bash
npm run types
```

---

## How It Works — Step by Step

### 1. Edge Function Entry Point (`src/index.ts`)

The default export is a standard Edge Function `fetch` handler. It routes incoming HTTP requests to the appropriate handler:

- **`GET /health`** — Returns a simple health-check JSON response.
- **`POST /inbound`** — Receives inbound SMS or voice webhooks from Telnyx. Routes the request to the `ConciergeAgent` Stateful Actor via `env.CONCIERGE.get(actorId).fetch(req)`.
- **`GET /voice/*`** — Handles Telnyx Call Control voice webhooks. Also routed to the actor.

The actor is retrieved using `env.CONCIERGE.idFromName("default")`, which gives a stable actor ID for all planners (single-instance demo). In production, you'd use a per-planner phone number as the ID.

### 2. The ConciergeAgent Class

`ConciergeAgent` extends `Agent<ConciergeEnv, PlannerState>`, which itself extends `StatefulActor`. This gives it:

- **Persistent state** via `this.getState()` / `this.replaceState()` — stored in durable storage, surviving across requests and days.
- **Scheduled tasks** via `this.schedule()` — used for the one-week follow-up call.
- **Per-planner isolation** — each planner's conversation state is maintained independently.

#### Initial State

The `initialState()` method returns a `PlannerState` object with default values:

```typescript
{
  phone: "",
  qualified: false,
  siteVisitBooked: false,
  lastActive: Date.now(),
  inquiryCount: 0,
}
```

This state is persisted automatically by the Agent SDK. Fields like `name`, `email`, `checkInDate`, `eventType`, and `budget` are populated as the planner provides information.

### 3. Inbound Webhook Handling

When a planner texts or calls the venue number, Telnyx sends a webhook to `POST /inbound`. The handler:

1. Parses the `from` (phone number), `text` (SMS body), and `callId` (if voice).
2. Loads the planner's existing state from the Stateful Actor.
3. Updates `lastActive` and increments `inquiryCount`.
4. If it's a voice call (`callId` present), initiates a Telnyx call via `this.env.TELNYX.calls.create()` with a voice webhook URL.
5. If it's a text message, generates an AI-powered response and sends it back via `this.env.TELNYX.messages.send()`.

### 4. Live Availability Lookup (SQLDB)

The `checkAvailability()` helper queries the `AVAILABILITY_DB` SQL database using a parameterized query:

```sql
SELECT date, available FROM availability WHERE date >= ? AND date <= ? ORDER BY date
```

This uses `this.env.AVAILABILITY_DB.prepare()` with `.bind()` to prevent SQL injection. The result is summarized as "X of Y dates are available."

### 5. FAQ Answers (KV Store)

The `getFaqContext()` helper reads a JSON object of FAQs from the `FAQ_KV` KV namespace:

```typescript
const faq = await this.env.FAQ_KV.get("faqs", { type: "json" });
```

It then searches for keywords in the planner's question and returns the matching answer. This covers capacity, catering, AV, parking, and accessibility questions without hitting the AI model.

### 6. AI-Powered Responses (Inference)

The `generateResponse()` method uses the Telnyx AI Inference binding (`this.env.TELNYX.ai.openai.chat.createCompletion`) to generate natural-language responses. It constructs a system prompt that includes:

- FAQ context from KV
- Live availability from SQLDB
- Current planner state (name, event type, guest count, budget)

In **demo mode** (`DEMO_MODE=true`), the AI model is bypassed and a template-based `demoResponse()` method generates responses based on keyword matching. This avoids API costs and works without an AI model subscription.

### 7. Site Visit Booking

When a planner requests a site visit, the agent responds with available tour slots (Tuesday–Friday, 10 AM–3 PM). The planner's preferred date is captured in state. In a full implementation, this would integrate with a calendar API — here, the state tracks `siteVisitBooked` and the conversation continues through the actor.

### 8. Email Follow-Up

The `VENUE_EMAIL` environment variable is configured for sending brochures and follow-up details. In the current sample, email sending is logged in demo mode. In live mode, you would use `this.env.TELNYX.email.send()` or the Telnyx SendGrid integration.

### 9. Outbound Voice Follow-Up (Scheduling)

After a planner's second inquiry, if they haven't been qualified, the agent schedules a follow-up call one week later:

```typescript
await this.schedule(7 * 24 * 3600, "followUpCall", { phone: from });
```

This uses the Agent SDK's `schedule()` method, which creates a durable scheduled task. After 7 days, the `followUpCall()` task handler fires. It checks if the planner has been active since the schedule was created — if so, it skips the call. Otherwise, it places an outbound call via `this.env.TELNYX.calls.create()`.

### 10. Inquiry Logs & Conversion Data

All planner interactions update the `PlannerState` in the Stateful Actor, which is durably persisted. The `inquiryCount`, `qualified` flag, `siteVisitBooked` flag, and `lastActive` timestamp provide a complete audit trail. In production, you would also write these to SQLDB for reporting dashboards.

---

## Demo Mode vs. Live Mode

| Feature | Demo Mode (`DEMO_MODE=true`) | Live Mode (`DEMO_MODE=false`) |
|---|---|---|
| SMS sending | Logged to console, not sent | Sent via `TELNYX.messages.send()` |
| Voice calls | Logged to console, not placed | Placed via `TELNYX.calls.create()` |
| AI responses | Template-based keyword matching | LLM-powered via `TELNYX.ai.openai.chat` |
| Phone numbers | Masked in logs | Real numbers used |

To switch to live mode, set `DEMO_MODE=false` in your `.env` file and ensure you have a Telnyx phone number configured as `FROM_NUMBER`.

---

## Running the Sample

### Local Development

```bash
npm run dev
```

This starts a local Edge runtime. Use a tool like [ngrok](https://ngrok.com/) to expose your local server and configure your Telnyx phone number's webhook URL to point to it.

### Deployment

```bash
telnyx-edge ship
```

This deploys the function and actor to Telnyx Edge. After deployment, configure your Telnyx phone number's SMS and voice webhooks to point to the deployed endpoint.

---

## Smoke Test

The `smoke_test.ts` file verifies that the `ConciergeAgent` class and its key methods exist and are properly typed:

```bash
npx tsx smoke_test.ts
```

Expected output:

```
✅ ConciergeAgent class loaded
✅ initialState method exists
✅ fetch method exists
✅ followUpCall method exists
✅ checkAvailability method exists
✅ getFaqContext method exists
✅ generateResponse method exists
✅ sendSms method exists
✅ maskPhone method exists
✅ Default export fetch handler exists
```

---

## Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent** | `ConciergeAgent extends Agent` — provides state management, scheduling, and task dispatch |
| **StatefulActor** | Base class for durable per-planner conversation state |
| **KV** | `FAQ_KV` namespace stores venue FAQ answers (capacity, catering, AV, parking, accessibility) |
| **SQLDB** | `AVAILABILITY_DB` stores live date availability data |
| **Voice** | `TELNYX.calls.create()` for inbound call handling and outbound follow-up calls |
| **SMS** | `TELNYX.messages.send()` for text-based planner interactions |
| **Inference** | `TELNYX.ai.openai.chat.createCompletion()` for AI-powered concierge responses |
| **Scheduling** | `this.schedule()` for one-week-delayed follow-up calls |
| **Custom Domains** | Branded venue website served on a custom domain via Telnyx Edge |

---

## Next Steps

- [Telnyx Edge Runtime Documentation](https://docs.telnyx.com/edge)
- [Agent SDK Reference](https://docs.telnyx.com/edge/agents)
- [KV Namespace Guide](https://docs.telnyx.com/edge/storage/kv)
- [SQL Database Guide](https://docs.telnyx.com/edge/storage/sqldb)
- [Telnyx AI Inference](https://docs.telnyx.com/ai)
- [Telnyx SMS API](https://developers.telnyx.com/docs/sms)
- [Telnyx Voice API](https://developers.telnyx.com/docs/voice)
- [Telnyx Edge CLI Reference](https://docs.telnyx.com/edge/cli)
