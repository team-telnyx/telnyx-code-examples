---
name: venue-sales-concierge
title: "Venue Sales Concierge — AI Booking Agent for Hotels, Resorts & Event Venues"
description: "Telnyx-branded venue microsite + AI sales concierge on Edge Compute — per-planner Stateful Actors carry conversations across SMS and voice, live SQLDB availability, lead qualification, in-browser WebRTC voice, email brochures, and automated one-week follow-up calls."
language: nodejs
framework: telnyx-edge
telnyx_products: [Edge Compute, KV, SQL Database, Stateful Actors, Messaging, Voice, AI Inference, AI Assistants, Email]
---

# Venue Sales Concierge

A Telnyx-branded venue microsite + AI sales concierge deployed as a single Telnyx Edge Function — event planners browse the site, then text or talk to the concierge to check live availability, get pricing, request proposals, and book site visits. Per-planner Stateful Actors keep the conversation going across channels and across weeks, the venue team gets a live sales dashboard, and quiet planners get a personalized voice follow-up call one week later.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — voice, messaging, AI inference, storage, and compute on one programmable platform. This concierge runs entirely on it: the website, the SMS concierge, the voice agent, and the sales dashboard all read the **same KV namespace and SQL database**, so the site and every channel say exactly the same thing. Stateful Actors give the concierge durable per-planner memory that survives restarts and spans touchpoints; Telnyx AI Inference answers with zero credentials in code; and the follow-up call — the highest-converting touch in venue sales — is scheduled and placed by the platform itself.

## Telnyx API Endpoints Used

| Endpoint / Binding | Product | Usage |
|---|---|---|
| `env.TELNYX.ai.openai.chat.createCompletion()` | AI Inference | Grounded concierge replies + planner-detail extraction (zero-credential) |
| `POST /v2/messages` | Messaging | SMS replies to planner inquiries |
| `POST /v2/calls` + `/v2/calls/{id}/actions/*` | Voice | Outbound follow-up calls, answer/speak/gather on live calls |
| `POST /v2/ai/assistants` | AI Assistants | Provisions the browser voice agent with a webhook tool |
| `POST /v2/email_messages` | Email | Brochures to planners, confirmations, qualified-lead alerts |
| `StatefulActor` / `Agent` (`[[actors]]`) | Stateful Actors | One durable ConciergeAgent per planner — state + history survive restarts |
| `this.schedule(7d, "followUpCall", {id})` | Scheduling | Durable one-week follow-up timer per planner |
| `[storage.kv.VENUE_KV]` | KV | Venue content (galleries, capacity, menus, AV, pricing, FAQs) — single source of truth |
| `[storage.sqldb.AVAILABILITY_DB]` | SQL Database | Live availability, inquiries, qualified leads, site-visit conversions |
| `env.SECRETS` / `process.env.TELNYX_PUBLIC_KEY` | Secrets | Ed25519 webhook verification, zero credentials in code |

## Architecture

```
                      ┌────────────────────────────────────────────────────────┐
                      │       Edge Function (TypeScript, one deploy)           │
                      │       *.telnyxcompute.com  (custom domain capable)     │
                      │                                                        │
   Planner browser ──►│  GET /            venue microsite (KV)                 │
                      │  GET /voice       in-browser voice AI (WebRTC)         │
                      │  GET /ops         venue sales dashboard (SQLDB)        │
                      │  GET /api/*       venue data + live availability       │
                      │  POST /api/site-visit   book a tour → SQLDB + email    │
                      │  POST /api/setup-assistant  provision voice assistant  │
                      │  POST /tools/lookup  ← assistant webhook tool (signed) │
   Planner phone ────►│  POST /webhooks/sms   SMS concierge (Ed25519-verified) │
   (venue number) ───►│  POST /webhooks/voice  Call Control (Ed25519-verified) │
                      └──────────────┬─────────────────────────────────────────┘
                                     │
                 ┌───────────────────┼──────────────────────────────┐
                 ▼                   ▼                              ▼
     ┌───────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐
     │  Stateful Actors  │  │   Telnyx KV      │  │      Telnyx SQLDB         │
     │  ConciergeAgent   │  │   venue/data     │  │   availability (dates)    │
     │  one per planner  │  │   faqs, menus,   │  │   inquiries (logged)      │
     │  state + history  │  │   pricing, AV    │  │   site_visits (bookings)  │
     │  survive restarts │  │  single source   │  │  funnel: inquiry →        │
     └────────┬──────────┘  │  of truth        │  │  qualified → booked       │
              │             └──────────────────┘  └───────────────────────────┘
              ▼
     ┌────────────────────────────────────────────────────────────────┐
     │  AI Inference: grounded reply + detail extraction              │
     │  Messaging: SMS reply  ·  Email: brochure + lead alerts        │
     │  Voice: speak/gather on live calls + scheduled follow-up dial  │
     └────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. Planner opens the branded venue site (galleries, capacity charts, menus, AV specs, pricing, FAQs) — all rendered from KV.
2. Planner texts the venue number (or talks in-browser via WebRTC) → webhook hits `/webhooks/sms` or `/webhooks/voice` (Ed25519-verified).
3. The webhook routes to the planner's own `ConciergeAgent` StatefulActor — one actor per phone number, durable across days/weeks.
4. The actor pulls live availability from SQLDB, venue facts from KV, and generates a grounded reply with AI Inference.
5. Details (name, email, event type, guests, budget, dates) are extracted from the conversation; an inquiry row is written to SQLDB.
6. Planners with a real email + serious scale/budget are **qualified**: they get the brochure by email, the venue sales inbox gets a lead alert.
7. Unqualified-but-interested planners get a durable one-week follow-up timer (`this.schedule`), re-armed on every touchpoint.
8. After one quiet week the agent places a **personalized voice follow-up call** (Call Control) — "press 1 to book your site visit" books it into SQLDB and emails the confirmation.
9. The venue team watches it all live on `/ops`: inquiries → RFPs → booked, with conversion rate.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key (injected by the `[telnyx]` binding; also used by REST helpers) | [Mission Control → API Keys](https://portal.telnyx.com/) |
| `TELNYX_PUBLIC_KEY` | `string` | `your_ed25519_public_key_here` | **yes** | Org public key for Ed25519 webhook verification | `GET /v2/public_key` |
| `TELNYX_CONNECTION_ID` | `string` | `your_call_control_connection_id_here` | for follow-up calls | Call Control connection id for outbound follow-ups | Mission Control → Voice |
| `TELNYX_SMS_FROM` | `string` | `+1555XXXXXXXX` | **yes** | The venue's Telnyx number (SMS sender + voice ANI) | Mission Control → Numbers |
| `EMAIL_FROM` | `string` | `onboarding@mail.telnyx.com` | no | Sender address (Telnyx shared domain works out of the box) | default |
| `EMAIL_TO` | `string` | `sales@venue.example` | no | Venue sales inbox for qualified-lead alerts | your inbox |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx-hosted inference model (no BYOK needed) | default |
| `ASSISTANT_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Model for the browser voice assistant | default |
| `DEMO_MODE` | `string` | `true` | no | `true` simulates outbound SMS/email/calls; inference + KV + SQLDB always run for real | default |

> Agent / CLI access — provision the resources this example uses:
>
> ```bash
> # Secrets (org-scoped, injected at runtime)
> telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
> telnyx-edge secrets add TELNYX_CONNECTION_ID "$CONNECTION_ID"
>
> # KV namespace
> telnyx-edge storage kv create --name venue-sales-concierge-data
>
> # SQLDB instance (availability, inquiries, leads, conversions)
> # Mission Control → SQL Database → create instance → paste id into telnyx.toml
>
> # Phone number + messaging profile (SMS sender)
> telnyx number-orders create --phone-numbers["+1555XXXXXXX"] --connection-id ""
> telnyx messaging-profiles create --name "venue-sales-concierge" \
>   --webhook-url "https://<your-func>.telnyxcompute.com/webhooks/sms"
> telnyx messaging-phone-numbers update <number-id> --messaging-profile-id <profile-id>
> ```

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/venue-sales-concierge

# 2. Install dependencies
npm install

# 3. Create a .env file from the example
cp .env.example .env
# Edit .env — see the Environment Variables table above

# 4. Authenticate the Telnyx Edge CLI
npm install -g @telnyx/edge-cli
telnyx-edge auth api-key set your_telnyx_api_key_here

# 5. Type-check and run the test suite
npm run typecheck
npm test

# 6. Deploy to Telnyx Edge
telnyx-edge ship

# 7. Provision the browser voice assistant (one-time)
curl -X POST https://<your-function-url>/api/setup-assistant
```

<details><summary>Programmatic / CLI setup</summary>

Provision the Telnyx resources behind the env vars with the Telnyx CLI (or grab them from Mission Control):

```bash
# Buy a phone number for the venue (SMS + voice)
telnyx number-orders create --phone-numbers["+1555XXXXXXX"] --connection-id ""

# Messaging profile → point at this function's SMS webhook
telnyx messaging-profiles create --name "venue-sales-concierge" \
  --webhook-url "https://<your-func>.telnyxcompute.com/webhooks/sms"
telnyx messaging-phone-numbers update <number-id> --messaging-profile-id <profile-id>

# Call Control connection → point its webhook at /webhooks/voice (for the
# follow-up calls), then attach the venue number to it
telnyx connections create --name "venue-concierge-cc" \
  --webhook-url "https://<your-func>.telnyxcompute.com/webhooks/voice"

# Ed25519 public key for webhook verification
curl -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/public_key
telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"

# Custom domain (branded venue website): Mission Control → Edge Functions →
# your function → Domains → attach your venue domain (TLS provisioned for you)
```

</details>

## API Reference

### `GET /`

The branded venue microsite — galleries, capacity charts, catering menus, AV specs, pricing, FAQs, live availability checker, and site-visit booking form. Fully server-rendered from KV.

### `GET /voice`

In-browser voice concierge (WebRTC, anonymous login to the AI Assistant). No dialing, no credentials.

### `GET /ops`

The venue's branded bookings dashboard — inquiries → RFPs → site-visit bookings funnel, live availability for the next 14 days, recent inquiries, and booked site visits. Auto-refreshes every 15s.

### `GET /health`

Health probe. Returns `ok`.

### `GET /api/event`

Returns the venue data (same JSON the microsite renders from KV).

### `GET /api/availability?start=YYYY-MM-DD&end=YYYY-MM-DD`

Live availability from SQLDB.

**Response (200 OK):**
```json
{
  "start": "2026-09-15",
  "end": "2026-12-14",
  "summary": "58 of 91 dates between 2026-09-15 and 2026-12-14 are available. Earliest openings: 2026-09-16, 2026-09-17, ...",
  "days": [{ "date": "2026-09-16", "available": true, "note": "" }]
}
```

### `GET /api/leads`

Funnel + records for the dashboard.

**Response (200 OK):**
```json
{
  "stats": { "inquiries": 12, "qualified": 5, "booked": 3, "conversion_pct": 25 },
  "inquiries": [{ "id": "inq-...", "phone": "+1555...", "qualified": 1, "...": "..." }],
  "visits": [{ "id": "visit-...", "visit_date": "2026-09-24", "status": "booked" }]
}
```

### `POST /api/site-visit`

Book a site visit from the web form.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `phone_number` | `string` | yes | Planner phone (E.164) |
| `email` | `string` | yes | Planner email |
| `name` | `string` | no | Planner name |
| `visit_date` | `string` | no | Preferred date (`YYYY-MM-DD`) |

**Response (200 OK):**
```json
{ "ok": true, "visit": { "id": "visit-k1x2...", "visit_date": "2026-09-24", "email": "jane@example.com", "name": "Jane" } }
```

### `POST /api/demo/message`

Demo entry point — simulates an inbound planner SMS and runs the same actor pipeline end-to-end (inference real, outbound sends demo-logged). No signature required; test/demo only.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | `string` | yes | Planner phone (E.164) |
| `text` | `string` | yes | Message text |

### `POST /webhooks/sms`

Inbound SMS webhook (Telnyx messaging profile). Ed25519-verified, deduped on the message id, fast-acked, then processed by the planner's StatefulActor.

### `POST /webhooks/voice`

Call Control webhook (inbound venue calls + follow-up call events). Ed25519-verified; routes to the planner's actor which answers, speaks, gathers speech/DTMF, and books visits.

### `POST /tools/lookup`

Webhook tool for the voice assistant (Telnyx-signed). Returns live venue data + availability so the voice agent always agrees with the website.

### Scheduled Task: `followUpCall`

Durable one-week timer per planner (named task id — re-armed on every touchpoint). Skips if the planner replied, already booked, or is in demo mode; otherwise places a personalized outbound voice call.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `401 invalid webhook signature` on `/webhooks/*` | `TELNYX_PUBLIC_KEY` not set or wrong key | `curl -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/public_key`, then `telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"` |
| `500 TELNYX_PUBLIC_KEY secret not configured` | Secret missing in the Edge environment | Run `telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"` |
| `[DEMO] Would send SMS...` in logs | `DEMO_MODE` is not `false` | Set `DEMO_MODE=false` (`telnyx-edge env-var set DEMO_MODE false` or in `telnyx.toml`) to send real SMS/emails/calls |
| `No availability data` / empty calendar | SQLDB instance missing or schema not created | Create the SQLDB instance, paste its id into `telnyx.toml`; schema + 90-day seed are created on first `/api/availability` or `/ops` hit |
| Voice assistant says it can't find info | Assistant not provisioned | `curl -X POST https://<your-function-url>/api/setup-assistant` |
| Browser voice fails with `Login Incorrect` | Assistant missing `supports_unauthenticated_web_calls` | Re-run setup — `upsertAssistant()` sets it |
| Follow-up call never happens | No `TELNYX_CONNECTION_ID`, planner replied, already booked, or demo mode | Set the connection secret; the actor skips quiet planners who replied or who already booked |
| SMS replies not arriving | Messaging profile webhook mis-pointed or `from` number not on the profile | Point the profile at `/webhooks/sms` and attach the number (`telnyx messaging-phone-numbers update`) |
| `telnyx-edge: command not found` | Edge CLI not installed | `npm install -g @telnyx/edge-cli` |

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

- [edge-event-microsite](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-event-microsite/README.md) — Event microsite + AI concierge: one KV store powers the site, SMS/WhatsApp concierge, browser voice AI, and sponsor report
- [sms-support-agent-with-followup](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-support-agent-with-followup/README.md) — SMS support agent on Stateful Actors with a scheduled 24h follow-up
- [persistent-state-agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — Durable per-customer agent state across touchpoints
- [conference-agent-mediator](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-agent-mediator/README.md) — Multi-actor conference orchestration with Call Control

## Resources

- [Edge Functions docs](https://developers.telnyx.com/docs/edge/functions) — deploy, secrets, bindings, actors
- [Stateful Actors guide](https://developers.telnyx.com/docs/edge/stateful-actors) — durable per-entity state, tasks, alarms
- [AI Inference API reference](https://developers.telnyx.com/api-reference/ai) — chat completions, hosted models
- [Messaging API reference](https://developers.telnyx.com/api-reference/messaging) — send SMS, webhooks
- [Call Control API reference](https://developers.telnyx.com/api-reference/call-control) — dial, answer, speak, gather
- [Email API reference](https://developers.telnyx.com/api-reference/email) — send email messages
- [Telnyx SDKs](https://developers.telnyx.com/development/sdk) — client libraries for every language
- [Edge Compute product](https://telnyx.com/products/edge-functions) — zero-server compute at the edge
- [Telnyx Pricing](https://telnyx.com/pricing) — pay-as-you-go pricing for all products
