# Event Sponsorship Agent — Developer Guide

This guide walks you through the `event-sponsorship-agent` sample — a single Telnyx Edge function that powers a branded microsite for event sponsorship activations. Attendees can text, call, or chat with an AI agent to enter a giveaway, ask product questions, or book a demo.

---

## Prerequisites

- A [Telnyx Account](https://portal.telnyx.com/) with access to Telnyx Edge
- Node.js 18+
- The `telnyx-edge` CLI installed and authenticated:

```bash
npm install -g @telnyx/edge-cli
telnyx-edge auth api-key set <your_api_key>
```

---

## Project Structure

```
event-sponsorship-agent/
├── src/
│   └── index.ts          # Main agent + fetch handler
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
├── .gitignore
└── smoke_test.ts
```

---

## Environment Setup

### 1. Clone and install

```bash
cd event-sponsorship-agent
npm install
```

### 2. Configure `telnyx.toml`

The `telnyx.toml` file declares all bindings: the agent namespace, KV stores, SQL database, secrets, and the Telnyx API binding.

```toml
name = "event-sponsorship-agent"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "SPONSOR_AGENT"
type    = "SponsorAgent"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.kv.SESSION_KV]
id = "<session-kv-namespace-uuid>"

[storage.kv.RATE_LIMIT_KV]
id = "<rate-limit-kv-namespace-uuid>"

[storage.sqldb.LEADS_DB]
id = "<leads-sqldb-uuid>"

[env_vars]
AI_MODEL = "gpt-4o-mini"
DEMO_MODE = "true"
SALES_TEAM_NUMBER = "+1555XXXXXXXX"
FROM_NUMBER = "+1555XXXXXXXX"
EVENT_NAME = "Re:Invent 2025"
GIVEAWAY_PRIZE = "Sony Headphones"
```

> Replace placeholder UUIDs with real namespace IDs from the Telnyx Portal.

### 3. Set environment variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

| Variable             | Description                                      |
|----------------------|--------------------------------------------------|
| `TELNYX_API_KEY`     | Your Telnyx API key (set via CLI, not `.env`)    |
| `AI_MODEL`           | OpenAI model for inference (default: `gpt-4o-mini`) |
| `DEMO_MODE`          | `"true"` for demo (no real SMS/calls), `"false"` for live |
| `SALES_TEAM_NUMBER`  | Phone number to receive hot-lead SMS alerts      |
| `FROM_NUMBER`        | Telnyx phone number used as sender               |
| `EVENT_NAME`         | Name of the event (shown in agent responses)     |
| `GIVEAWAY_PRIZE`     | Prize description for giveaway entries           |

---

## How It Works

### 1. The `SponsorAgent` Class

The `SponsorAgent` class extends `Agent<SponsorEnv, SessionState>` from `@telnyx/edge-runtime`. It manages per-attendee session state and handles all interaction types (SMS, WhatsApp, voice, chat).

**Session state** (`SessionState` interface) tracks:
- `phone` — attendee's phone number
- `channel` — `sms`, `whatsapp`, `chat`, or `voice`
- `step` — current qualification step (`welcome`, `ask_name`, `ask_company`, etc.)
- `language` — detected ISO 639-1 code
- `collected` — key-value store of collected answers
- `giveawayEntry` / `demoRequested` — flow flags

### 2. Inbound Webhooks

The `fetch` handler at the bottom of `src/index.ts` routes HTTP requests to the appropriate actor method:

| Route              | Method | Handler                  | Description                          |
|--------------------|--------|--------------------------|--------------------------------------|
| `/webhook/sms`     | POST   | `handleInboundMessage`   | Inbound SMS webhook                  |
| `/webhook/whatsapp`| POST   | `handleInboundMessage`   | Inbound WhatsApp webhook             |
| `/webhook/voice`   | POST   | `handleInboundCall`      | Inbound voice call webhook           |
| `/api/chat`        | POST   | `handleChatMessage`      | In-browser chat REST endpoint        |
| `/api/followup`    | POST   | `scheduleFollowUp`       | Schedule a post-event follow-up      |
| `/api/report`      | GET    | `generateAttributionReport` | Generate lead attribution report  |
| `/health`          | GET    | —                        | Health check                         |
| `/`                | GET    | —                        | Serves the branded microsite HTML    |

Each webhook routes to a per-attendee actor instance using `e.SPONSOR_AGENT.idFromName(from)`, ensuring session state is isolated per phone number.

### 3. Rate Limiting

The `SimpleRateLimiter` class (defined near the top of `src/index.ts`) uses KV to enforce per-identifier request limits:

- SMS/WhatsApp: 10 requests per 60 seconds
- Voice: 5 requests per 60 seconds
- Chat: 20 requests per 60 seconds

It uses a sliding-window counter stored in `RATE_LIMIT_KV` with TTL-based expiration.

### 4. Language Detection

When a message arrives, `detectLanguage()` calls the Telnyx AI binding (`this.env.TELNYX.ai.openai.chat.createCompletion`) with a system prompt asking for an ISO 639-1 code. The detected language is stored in session state and used for all subsequent responses.

### 5. Message Processing Flow

The `processMessage()` method handles the conversation logic:

1. **Giveaway entry** — If the message contains "giveaway", "enter", or "prize", the attendee is entered and a confirmation is sent.
2. **Demo booking** — If the message contains "demo", "book", or "schedule", the demo flow starts.
3. **Product questions** — If the message contains "product", "what", or "how", `answerProductQuestion()` generates an AI response.
4. **Qualification flow** — If the attendee hasn't provided their name, company, use case, company size, or timeline, the agent asks the next question in sequence.
5. **Fallback** — Otherwise, `generateAgentResponse()` uses the full conversation context to generate a contextual AI response.

### 6. Lead Capture in SQLDB

The `saveLead()` method upserts lead data into the `LEADS_DB` SQL database. The table schema includes:

```sql
CREATE TABLE leads (
  phone TEXT PRIMARY KEY,
  name TEXT, email TEXT, company TEXT,
  useCase TEXT, companySize TEXT, timeline TEXT,
  channel TEXT, qualified BOOLEAN, giveawayEntry BOOLEAN,
  createdAt TEXT, updatedAt TEXT
)
```

A lead is marked `qualified` when they've provided use case, company size, and timeline.

### 7. Hot Lead Routing

When a lead is both qualified and has requested a demo, `routeHotLeadToSales()` sends an SMS alert to the sales team via `this.env.TELNYX.messages.send()`.

### 8. Post-Event Follow-Up

The `scheduleFollowUp()` method uses `this.schedule()` to queue a delayed task. After the delay, `sendFollowUp()` is called, which retrieves the lead from SQLDB and sends a follow-up message via the lead's preferred channel (SMS, WhatsApp, email, or voice).

### 9. Attribution Report

The `generateAttributionReport()` method queries all leads from SQLDB and returns:

- `totalCaptured` — total leads
- `totalQualified` — leads with all qualification fields
- `totalConverted` — leads who entered the giveaway
- `byChannel` — breakdown by interaction channel
- `byUseCase` — breakdown by use case

### 10. In-Browser Chat

The microsite HTML (served at `/`) includes a chat interface that POSTs to `/api/chat`. The `handleChatMessage()` method processes the message through the same `processMessage()` flow and returns the agent's response as JSON.

A WebSocket handler (`webSocket()`) is also available for real-time chat connections.

---

## Demo Mode vs Live Mode

The agent runs in **demo mode** by default (`DEMO_MODE=true`). In demo mode:

- No real SMS or WhatsApp messages are sent — actions are logged to console
- No real voice calls are placed — calls are logged
- No real emails are sent — emails are logged
- Hot lead routing to sales is logged but not sent

To switch to **live mode**, set `DEMO_MODE=false` in your environment. In live mode, all Telnyx API calls (SMS, WhatsApp, voice) are executed for real.

> **Warning:** Live mode sends real SMS messages and places real voice calls. Ensure your `FROM_NUMBER` and `SALES_TEAM_NUMBER` are correctly configured.

---

## Running the Sample

### Local development

```bash
# Generate TypeScript types from telnyx.toml
telnyx-edge types

# Run smoke test
npx tsx smoke_test.ts

# Deploy to Telnyx Edge
telnyx-edge ship
```

### Smoke test

The `smoke_test.ts` file verifies that the module loads without errors and that all exported types and classes are accessible.

---

## Telnyx Primitives Used

| Primitive       | Usage in this sample                                      |
|-----------------|-----------------------------------------------------------|
| **Functions**   | Single function deployment via `telnyx-edge ship`         |
| **Custom domains** | Branded microsite served at `/` on a custom domain     |
| **KV**          | Session state (`SESSION_KV`) and rate limiting (`RATE_LIMIT_KV`) |
| **SQLDB**       | Lead capture and attribution reporting (`LEADS_DB`)       |
| **Messaging**   | SMS and WhatsApp interactions via `TELNYX.messages.send` and `TELNYX.v2.messages.create` |
| **Voice**       | Inbound voice call handling via webhook routing           |
| **Email**       | Post-event email follow-up (demo mode logs, live mode uses Telnyx Email API) |
| **Inference**   | Language detection, product Q&A, and contextual responses via `TELNYX.ai.openai.chat.createCompletion` |
| **Rate Limiting** | `SimpleRateLimiter` class using KV with sliding window |

---

## Next Steps

- [Telnyx Edge Documentation](https://docs.telnyx.com/edge) — Deploy, manage, and monitor your Edge functions
- [Telnyx API Reference](https://docs.telnyx.com/api) — Full API documentation for SMS, Voice, WhatsApp, and more
- [Telnyx SDK for TypeScript](https://docs.telnyx.com/sdk) — Client libraries and examples
- [Telnyx Community](https://community.telnyx.com/) — Ask questions and share projects
- [Telnyx GitHub Examples](https://github.com/team-telnyx/telnyx-code-examples) — More code samples and tutorials
