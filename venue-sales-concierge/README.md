---
name: venue-sales-concierge
title: "Venue Sales Concierge — AI-Powered Booking Agent for Hotels, Resorts & Event Venues"
description: "A Telnyx Edge Function that deploys an AI concierge agent for venue sales, enabling planners to check availability, get pricing, request proposals, and book site visits via text or voice — with per-planner stateful conversations, KV FAQs, SQLDB availability, email brochures, and automated voice follow-ups."
language: typescript
framework: edge
telnyx_products: [Messaging, Voice, AI Inference, Agents, Stateful Actors, KV, SQL Database, Scheduling, Email]
---

# Venue Sales Concierge

An AI-powered venue sales concierge deployed as a single Telnyx Edge Function, enabling event planners to interact with a branded venue website via text or voice to check availability, get pricing, request proposals, and book site visits — with persistent per-planner conversation state, automated follow-ups, and full inquiry logging.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the real-time, programmable building blocks that let this concierge agent talk to planners across every channel they prefer: SMS, voice calls, and email. Unlike traditional contact-center platforms, Telnyx Edge Functions run stateful agents with built-in KV, SQL databases, and scheduling — so the concierge remembers each planner's conversation history across days or weeks, pulls live availability from a real database, answers FAQs from a managed key-value store, and automatically places personalized voice follow-up calls when a planner goes quiet. All of this runs on Telnyx's global edge network with zero server management, zero credential handling in code, and native integration with Telnyx's Messaging, Voice, AI Inference, and Email APIs.

## Telnyx API Endpoints Used

| Endpoint | Product | Usage |
|---|---|---|
| `TELNYX.messages.send()` | Messaging | Sends SMS replies to planners during text conversations |
| `TELNYX.calls.create()` | Voice | Initiates outbound voice calls for inbound voice webhooks and one-week follow-up calls |
| `TELNYX.ai.openai.chat.createCompletion()` | AI Inference | Generates natural-language responses from the LLM-powered concierge agent |
| `Agent` / `StatefulActor` | Agents | Maintains per-planner conversation state across touchpoints |
| `this.schedule()` | Scheduling | Schedules the one-week follow-up call after planner inactivity |
| `FAQ_KV.get()` | KV Store | Retrieves FAQ answers for capacity, catering, AV, parking, and accessibility |
| `AVAILABILITY_DB.prepare()` | SQL Database | Queries live date availability for requested booking windows |
| `env.SECRETS.get()` | Secrets | Securely retrieves the Telnyx API key at runtime |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PLANNER (Browser / Phone)                        │
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐   │
│  │ Custom Domain│     │ Text (SMS)   │     │ Voice Call           │   │
│  │ Website      │     │              │     │                      │   │
│  │ Galleries,   │────▶│ /inbound     │◀───▶│ /voice/{callId}      │   │
│  │ Capacity,    │     │              │     │                      │   │
│  │ Menus, AV    │     └──────────────┘     └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              TELNYX EDGE FUNCTION (src/index.ts)                        │
│                                                                         │
│  ┌──────────────────┐    ┌─────────────────────────────────────────┐  │
│  │ Default Export   │    │ ConciergeAgent (extends Agent)          │  │
│  │ fetch()          │    │                                         │  │
│  │ Routes:          │───▶│  • getState() / replaceState()          │  │
│  │  /health         │    │  • checkAvailability() → SQLDB          │  │
│  │  /inbound        │    │  • getFaqContext() → KV                 │  │
│  │  /voice/*        │    │  • generateResponse() → TELNYX.ai       │  │
│  └──────────────────┘    │  • sendSms() → TELNYX.messages          │  │
│                          │  • followUpCall() → TELNYX.calls        │  │
│                          │  • schedule(7d, "followUpCall")         │  │
│                          └─────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Stateful     │  │ KV Store     │  │ SQL Database │  │ Scheduler  │ │
│  │ Actor        │  │ FAQ_KV       │  │ AVAILABILITY_│  │ this.sched-│ │
│  │ CONCIERGE    │  │ FAQs,        │  │ DB           │  │ ule()      │ │
│  │              │  │ capacity,    │  │ availability │  │            │ │
│  │ PlannerState │  │ catering, AV │  │ dates        │  │ 7-day      │ │
│  │ per phone    │  │ parking,     │  │              │  │ follow-up  │ │
│  │              │  │ accessibility│  │              │  │            │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         VENUE DASHBOARD                                 │
│  • Inquiry logs (every interaction)                                     │
│  • Qualified leads (state.qualified)                                    │
│  • Conversion data (state.siteVisitBooked)                              │
│  • Email brochures sent via TELNYX.Email                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. Planner visits the branded custom-domain website to browse galleries, capacity charts, catering menus, and AV specs.
2. Planner texts or calls the venue number → webhook hits `/inbound` or `/voice/{callId}`.
3. The `ConciergeAgent` loads per-planner state from the Stateful Actor's durable storage.
4. Agent queries `AVAILABILITY_DB` (SQLDB) for live date availability and `FAQ_KV` for common questions.
5. Agent uses `TELNYX.ai.openai.chat.createCompletion()` to generate a natural-language response.
6. Reply is sent via `TELNYX.messages.send()` (SMS) or Telnyx Call Control XML (voice).
7. If the planner shows interest (≥2 inquiries, not yet qualified), `this.schedule(7 days, "followUpCall")` is queued.
8. After 7 days of inactivity, `followUpCall()` places a personalized outbound voice call.
9. Brochures and follow-up details are sent by email.
10. All inquiries, qualified leads, and conversion data are logged in the actor's state for the venue dashboard.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Telnyx phone number used as the sender for SMS and voice calls | [Telnyx Mission Control](https://portal.telnyx.com/) |
| `VENUE_EMAIL` | `string` | `bookings@yourvenue.com` | **yes** | Email address for sending brochures and follow-up details | Your venue's email system |
| `DEMO_MODE` | `string` | `true` | no | When `true`, logs actions instead of sending real SMS/calls (default: `true`) | Set in `.env` |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/venue-sales-concierge

# 2. Install dependencies
npm install

# 3. Create a .env file from the example
cp .env.example .env
# Edit .env and fill in your Telnyx API key, phone number, and venue email

# 4. Authenticate with Telnyx CLI
telnyx-edge auth api-key set your_telnyx_api_key_here

# 5. Set required secrets
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"

# 6. Generate TypeScript types from telnyx.toml bindings
telnyx-edge types

# 7. Run the smoke test to verify everything loads
npx tsx smoke_test.ts

# 8. Deploy to Telnyx Edge
telnyx-edge ship
```

## API Reference

### `POST /inbound`

Receives inbound SMS or voice webhook from Telnyx.

**Request Body:**
```json
{
  "from": "+1555XXXXXXXX",
  "text": "Hi, I'm interested in booking for 150 guests on June 15-17",
  "callId": "call_abc123"
}
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | `string` | yes | The planner's phone number |
| `text` | `string` | no | The SMS message content (omitted for voice calls) |
| `callId` | `string` | no | Telnyx call ID — if present, triggers a voice response |

**Response (200 OK):**
```json
{
  "reply": "I can check availability for your requested dates. 3 of 3 dates are available. Please let me know your preferred check-in and check-out dates."
}
```

### `GET /voice/{callId}`

Returns TwiML-like XML for Telnyx Call Control when a planner calls the venue number.

**Response (200 OK):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female" language="en-US">Hello! This is your venue sales concierge...</Say>
  <Record timeout="10" maxLength="120" />
  <Hangup />
</Response>
```

### `GET /health`

Health check endpoint.

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

### Scheduled Task: `followUpCall`

Automatically triggered 7 days after a planner's last activity if they haven't been qualified. Places a personalized outbound voice call.

**Payload:**
```json
{
  "phone": "+1555XXXXXXXX"
}
```

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `Error: Missing 'from' field` | Inbound webhook received without a `from` parameter | Verify the Telnyx webhook payload includes the planner's phone number |
| `Error: TELNYX_API_KEY not configured` | Secret not set in the Telnyx Edge environment | Run `telnyx-edge secrets add TELNYX_API_KEY "your_key_here"` |
| `No availability data found for those dates` | SQLDB has no records for the requested date range | Insert availability records into the `availability` table |
| `No FAQ context available` | KV namespace `FAQ_KV` is empty or missing `faqs` key | Populate `FAQ_KV` with FAQ entries using `telnyx-edge types` and the KV API |
| `[DEMO] Would send SMS...` appears in logs | `DEMO_MODE=true` is set | Set `DEMO_MODE=false` in `.env` to send real SMS messages |
| Follow-up call not scheduled | Planner was qualified or had fewer than 2 inquiries | The follow-up only triggers after 2+ inquiries from an unqualified planner |
| `telnyx-edge: command not found` | Telnyx CLI not installed | Install via `npm install -g @telnyx/edge-cli` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your venue's custom-domain agent
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai) — Open-source AI agent examples and SDK
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation for AI agents

## Related Examples

- [ai-sales-assistant](../ai-sales-assistant) — AI-powered sales assistant for B2B outreach
- [event-ticketing-bot](../event-ticketing-bot) — SMS-based event ticketing and check-in
- [hotel-front-desk](../hotel-front-desk) — AI concierge for hotel guest services
- [appointment-scheduler](../appointment-scheduler) — Automated appointment booking via SMS and voice

## Resources

- [Telnyx Edge Documentation](https://docs.telnyx.com/edge) — Full developer docs for Edge Functions, Agents, and Stateful Actors
- [Telnyx API Reference](https://developers.telnyx.com/api) — Complete API reference for Messaging, Voice, AI, and Email
- [Telnyx Edge SDK](https://docs.telnyx.com/edge/sdk) — TypeScript SDK for `@telnyx/edge-runtime`
- [Telnyx Messaging Product Page](https://telnyx.com/sms) — Programmable SMS for two-way conversations
- [Telnyx Voice Product Page](https://telnyx.com/voice) — Programmable voice with Call Control
- [Telnyx AI Inference Product Page](https://telnyx.com/ai) — LLM-powered inference with zero-credential bindings
- [Telnyx Pricing](https://telnyx.com/pricing) — Pay-as-you-go pricing for all Telnyx products
