---
name: event-sponsorship-agent
title: "Event Sponsorship Agent — Telnyx Edge"
description: "A multilingual, multi-channel agent for event sponsorship activations with giveaway entry, product Q&A, demo booking, lead capture, and real-time hot-lead routing."
language: typescript
framework: edge
telnyx_products: ["Messaging", "Voice", "Email", "Inference", "KV", "SQLDB", "Custom Domains", "Rate Limiting", "Agents"]
---

# event-sponsorship-agent

A brand receives a custom-domain microsite for an event sponsorship activation. Attendees interact with an agent through text, voice calls, or in-browser chat to enter a giveaway, ask product questions, or book a demo.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global, low-latency platform that unifies messaging, voice, email, and AI inference behind a single programmable edge runtime. This sample demonstrates how a sponsorship activation can be deployed as a single Telnyx Edge function with custom domains, KV session state, SQLDB lead capture, real-time SMS hot-lead routing, multilingual agent conversations, and rate-limited attendee endpoints — all without managing servers or credentials.

## Telnyx API Endpoints Used

| Service | Endpoint / Method | Purpose |
|---|---|---|
| **Messaging** | `TELNYX.messages.send({to, from, text})` | SMS responses to attendees and hot-lead routing to sales |
| **Messaging (WhatsApp)** | `TELNYX.v2.messages.create({from, to, channel, text})` | WhatsApp follow-up messages |
| **Voice** | `TELNYX.calls.create(...)` | Inbound voice call handling via Call Control |
| **Inference** | `TELNYX.ai.openai.chat.createCompletion({model, messages})` | Language detection, product Q&A, contextual agent responses |
| **KV** | `SESSION_KV.get/put/delete` | Session state persistence per attendee |
| **SQLDB** | `LEADS_DB.exec/prepare` | Lead capture, upsert, and attribution reporting |
| **Rate Limiting** | `RATE_LIMIT_KV` (custom `SimpleRateLimiter`) | Per-attendee rate limiting on interaction endpoints |
| **Custom Domains** | Telnyx Edge microsite hosting | Branded domain (e.g. `telnyx-at-reinvent.com`) |
| **Agents** | `Agent<SponsorEnv, SessionState>` | Stateful actor handling all attendee interactions |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Branded Microsite                            │
│                    (custom domain, e.g. telnyx-at-reinvent.com)      │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │   Attendee   │   │   Attendee   │   │     Attendee         │   │
│  │     SMS      │   │   Voice Call │   │  In-Browser Chat     │   │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘   │
│         │                  │                      │               │
│         ▼                  ▼                      ▼               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Telnyx Edge Function (src/index.ts)           │   │
│  │                                                            │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │   │
│  │  │  Webhooks  │  │  Webhooks  │  │  REST API  │            │   │
│  │  │  /webhook/ │  │  /webhook/ │  │  /api/chat │            │   │
│  │  │    sms     │  │   voice    │  │  /api/     │            │   │
│  │  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘            │   │
│  │         │               │               │                  │   │
│  │         ▼               ▼               ▼                  │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │                 SponsorAgent (Agent)               │   │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │   │   │
│  │  │  │ RateLimit│  │ Language │  │  Inference      │  │   │   │
│  │  │  │  (KV)    │  │ Detect   │  │  (OpenAI)       │  │   │   │
│  │  │  └──────────┘  └──────────┘  └─────────────────┘  │   │   │
│  │  │  ┌────────────────────────────────────────────┐  │   │   │
│  │  │  │  processMessage() — giveaway / demo / Q&A  │  │   │   │
│  │  │  │  qualification flow (name, company, use     │  │   │   │
│  │  │  │  case, size, timeline)                      │  │   │   │
│  │  │  └────────────────────────────────────────────┘  │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │         │                                                   │   │
│  │         ├───────────────────────────────────────┐           │   │
│  │         │                                       │           │   │
│  │         ▼                                       ▼           │   │
│  │  ┌──────────────┐                    ┌──────────────────┐  │   │
│  │  │   SQLDB      │                    │     KV Store     │  │   │
│  │  │  LEADS_DB    │                    │  SESSION_KV      │  │   │
│  │  │  (leads)     │                    │  (sessions)      │  │   │
│  │  └──────┬───────┘                    └──────────────────┘  │   │
│  │         │                                                   │   │
│  │         ▼                                                   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Hot Lead Routing → TELNYX.messages.send()         │   │   │
│  │  │  → Sales Team SMS (real-time)                      │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │         │                                                   │   │
│  │         ▼                                                   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Post-Event Follow-Up (scheduled via this.schedule) │   │   │
│  │  │  → SMS / WhatsApp / Email / Voice (preferred channel)│  │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │         │                                                   │   │
│  │         ▼                                                   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Attribution Report (/api/report)                  │   │   │
│  │  │  → captured, qualified, converted leads by channel │   │   │
│  │  │    and use case                                    │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow:** Attendee interacts via SMS, voice, or chat → webhook routes to a per-attendee `SponsorAgent` actor → rate limiter checks KV → language detected via inference → agent processes message (giveaway entry, demo booking, product Q&A, or qualification flow) → lead upserted into SQLDB → if qualified + demo requested, hot lead SMS-routed to sales team → post-event follow-up scheduled via `this.schedule()` → attribution report queries SQLDB.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `EVENT_NAME` | `string` | `your_event_name_here` | **yes** | EVENT_NAME | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

Additional bindings configured in `telnyx.toml` (not env vars):

| Binding | Type | Description |
|---------|------|-------------|
| `SPONSOR_AGENT` | ActorNamespace | The `SponsorAgent` actor class |
| `SESSION_KV` | KvNamespace | Session state storage |
| `LEADS_DB` | SqlDatabase | Lead capture database |
| `RATE_LIMIT_KV` | KvNamespace | Rate limiting counters |
| `TELNYX` | Telnyx API binding | Zero-credential Telnyx API access |
| `AI_MODEL` | env var | OpenAI model name (default: `gpt-4o-mini`) |
| `DEMO_MODE` | env var | `"true"` for dry-run mode (default) |
| `SALES_TEAM_NUMBER` | env var | Phone number for hot-lead SMS routing |
| `FROM_NUMBER` | env var | Telnyx phone number for outbound SMS |
| `GIVEAWAY_PRIZE` | env var | Description of the giveaway prize |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/event-sponsorship-agent

# 2. Install dependencies
npm install

# 3. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# 4. Configure secrets
telnyx-edge secrets add TELNYX_API_KEY "<your_telnyx_api_key>"

# 5. Set environment variables (optional, for demo mode)
cp .env.example .env
# Edit .env with your values

# 6. Generate type bindings
telnyx-edge types

# 7. Run smoke test
npx tsx smoke_test.ts

# 8. Deploy
telnyx-edge ship
```

## API Reference

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/sms` | Inbound SMS webhook — creates/retrieves attendee session, processes message, sends response |
| `POST` | `/webhook/whatsapp` | Inbound WhatsApp webhook — same flow as SMS via WhatsApp channel |
| `POST` | `/webhook/voice` | Inbound voice webhook — queues call for agent handling |

### REST API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | In-browser chat message — processes text and returns agent response |
| `POST` | `/api/followup` | Schedule post-event follow-up on preferred channel |
| `GET` | `/api/report` | Generate attribution report (captured, qualified, converted leads) |
| `GET` | `/health` | Health check endpoint |
| `GET` | `/` | Serves the branded microsite HTML |

### Request/Response Shapes

**POST /webhook/sms**
```json
// Request
{
  "from": "+15551234567",
  "to": "+15559998888",
  "text": "I want to enter the giveaway"
}

// Response
{
  "success": true,
  "message": "🎉 You're entered in the giveaway! Prize: [GIVEAWAY_PRIZE]. A sales rep will contact you shortly."
}
```

**POST /api/chat**
```json
// Request
{
  "sessionId": "web_1234567890",
  "text": "What products do you offer?"
}

// Response
{
  "success": true,
  "message": "Telnyx offers global communications infrastructure including SMS, voice, and AI-powered APIs..."
}
```

**GET /api/report**
```json
// Response
{
  "totalCaptured": 150,
  "totalQualified": 85,
  "totalConverted": 42,
  "byChannel": { "sms": 90, "whatsapp": 30, "chat": 20, "voice": 10 },
  "byUseCase": { "API Integration": 50, "Customer Support": 35, "Marketing": 25 }
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Rate limit exceeded` | Too many requests from same attendee in 60s window | Wait 60 seconds and retry; adjust `maxRequests` in `SimpleRateLimiter` |
| `Missing from or text` | Webhook payload missing required fields | Verify Telnyx webhook configuration sends `from` and `text` fields |
| `Language detection failed` | Inference API error | Check `AI_MODEL` env var; fallback to English |
| `Lead not found for follow-up` | Phone number not in SQLDB | Ensure attendee completed at least one interaction before scheduling follow-up |
| `Demo mode active` | `DEMO_MODE=true` in environment | Set `DEMO_MODE=false` and configure real Telnyx credentials to send real messages |
| `Table leads already exists` | SQLDB table creation on every request | Harmless — `CREATE TABLE IF NOT EXISTS` is idempotent |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [telnyx-voice-agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-voice-agent) — Voice-only agent with Call Control
- [telnyx-sms-support-bot](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-sms-support-bot) — SMS support bot with KV session state
- [telnyx-whatsapp-commerce](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-whatsapp-commerce) — WhatsApp commerce with SQLDB order tracking
- [telnyx-edge-microsite](https://github.com/team-telnyx/telnyx-code-examples/tree/main/telnyx-edge-microsite) — Custom domain microsite hosting

## Resources

- [Telnyx Edge Documentation](https://docs.telnyx.com/edge)
- [Telnyx API Reference](https://developers.telnyx.com)
- [Telnyx SDK (TypeScript)](https://github.com/team-telnyx/telnyx-node)
- [Telnyx Messaging Product Page](https://telnyx.com/sms)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
