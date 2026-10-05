---
name: rcs-triage-receptionist
title: "RCS Triage Receptionist — Healthcare Flagship"
description: "A stateful Telnyx Edge actor that acts as a clinic's RCS front desk, serving rich triage cards with tappable suggested replies and falling back to plain SMS for non-RCS devices."
language: typescript
framework: edge
telnyx_products: [RCS Messaging, Telnyx Decision Models, Stateful Actors, Edge Compute, SMS Fallback]
---

# rcs-triage-receptionist

A stateful Telnyx Edge actor that acts as a clinic's RCS front desk, serving rich triage cards with tappable suggested replies and falling back to plain SMS for non-RCS devices.

## The Story

Riverside Clinic fields dozens of patient messages every morning — appointment requests, prescription refills, and urgent concerns that can't wait. A missed triage or a dropped conversation isn't just a lost booking; it's a patient left without care, a compliance risk, and a reputation eroded in a single text thread. The clinic needs a front desk that never sleeps, never forgets where a conversation left off, and never fails to escalate when someone needs a nurse.

The actor IS the clinic's RCS receptionist. It is born the moment a patient texts the clinic's RCS agent — `env.FRONTDESK.idFromName(patientPhoneDigits)` materializes a durable actor instance keyed to that phone number. It greets the patient with a rich card of tappable suggestions ("Book appointment", "Refill", "Talk to a nurse"), reads each `suggestion_response.postback_data` to advance the triage stage (service → date → confirm), classifies free-text messages through a Telnyx Decision Model, and persists every booking to SQL. If the platform reboots mid-triage, the actor is reborn on the next inbound message with its full thread state restored — the patient sees the exact same card, no duplicate booking, no lost intent. Durability is the point, not the API calls.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx is **AI Communications Infrastructure** — the platform that lets developers build communication experiences with the same reliability primitives that power the internet itself. Unlike generic SMS gateways, Telnyx provides RCS rich cards with programmatic `postback_data` routing, stateful actors with durable storage that survive platform reboots, and Decision Models that classify free-text intent without a separate ML pipeline. This sample composes all three into a single, restart-proof triage flow that degrades gracefully from RCS to SMS — the kind of infrastructure-grade reliability that healthcare operators demand.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `https://api.telnyx.com/v2/messages/rcs` | POST | Send RCS rich cards with `standalone_card` and `suggestions[]`; includes `sms_fallback` for non-RCS recipients |
| `https://api.telnyx.com/v2/messaging/rcs/capabilities/{agent_id}/{phone_number}` | GET | Query whether a recipient device supports rich cards (`supports_rich_cards`) |
| `https://api.telnyx.com/v2/messages/rcs/deeplinks/{agent_id}` | GET | Generate an RCS deeplink so patients can open the clinic thread from the website |
| `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | POST | Telnyx Decision Model (`telnyx/decision-flash`): `choice` intent, `score` urgency, `noul` emergency routing |
| `https://api.telnyx.com/vrcs/agents` | POST | Create an RCS Agent (MULTI_USE use case) |
| `https://api.telnyx.com/v2/rcs/agents/{id}/test_devices` | POST | Register a test device for carrier-approval-free RCS testing |
| Webhook: `message.received` | Inbound | Carries `suggestion_response.postback_data` (tappable buttons) or `text` (free-text) |
| Webhook: `message.sent` / `message.finalized` / `message.read` | Outbound | RCS message lifecycle status on the agent's webhook URL |

## Architecture

```
Patient Messages App
       │
   RCS │ (or SMS fallback)
       ▼
Telnyx RCS Agent
       │
   webhook (message.received)
       ▼
┌─────────────────────────────────────────────────────────┐
│  Receptionist Actor (StatefulActor)                      │
│  env.FRONTDESK.idFromName(patientPhoneDigits)            │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Greeting    │→ │ Service Card │→ │ Date Card    │   │
│  │ Card        │  │              │  │              │   │
│  └─────────────┘  └──────────────┘  └──────────────┘   │
│        │               │                  │             │
│        │ postback_data │ postback_data    │ postback    │
│        ▼               ▼                  ▼             │
│  ┌──────────────────────────────────────────────┐       │
│  │  Decision Model (telnyx/decision-flash)       │       │
│  │  choice: book|refill|nurse|urgent             │       │
│  │  score: urgency (0-1)                         │       │
│  │  noul: emergency → nurse line                 │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │  SQL Storage (THREADS_DB)                     │       │
│  │  threads(phone, stage, intent, slot, taps)    │       │
│  │  bookings(phone, provider, status, slot, at)  │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │  Capabilities Check                          │       │
│  │  GET /v2/messaging/rcs/capabilities/{agent}  │       │
│  │  supports_rich_cards → rich card             │       │
│  │  !supports_rich_cards → sms_fallback         │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
       │
       │ outbound (POST /v2/messages/rcs)
       ▼
Telnyx RCS Agent ──► Patient Messages App
```

**Data flow:** Patient taps a suggested reply → Telnyx sends `message.received` webhook → Receptionist actor restores thread state from durable storage → reads `suggestion_response.postback_data` → advances stage → checks capabilities → sends next rich card (or SMS fallback) → persists state to SQL. If the actor is killed mid-triage, the next inbound message re-births it via `idFromName` and resumes at the last card.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `RCS_AGENT_ID` | `string` | `your_rcs_agent_id_here` | **yes** | RCS_AGENT_ID | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `MESSAGING_PROFILE_ID` | `string` | `your_messaging_profile_id_here` | **yes** | Telnyx messaging profile ID for RCS message routing | Telnyx Portal → Messaging → Profiles |
| `SMS_FALLBACK_FROM` | `string` | `+1555XXXXXXXX` | **yes** | Phone number used as the `from` field in SMS fallback messages | Telnyx Portal → Numbers |
| `TRIAGE_EMERGENCY_NURSE` | `string` | `+1555XXXXXXXX` | **yes** | Nurse line phone number for emergency routing via Decision Model `noul` | Clinic operations |
| `DECISION_TIMEOUT_MS` | `string` | `8000` | no | Timeout in milliseconds for Decision Model API calls | Default: 8000 |
| `WEBHOOK_PATH` | `string` | `/webhook/message` | no | Inbound webhook path for `message.received` events | Default: `/webhook/message` |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/rcs-triage-receptionist

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your Telnyx API key, RCS agent ID, messaging profile ID,
# SMS fallback number, and emergency nurse line number

# 4. Set secrets via telnyx-edge CLI
telnyx-edge auth api-key set <your_telnyx_api_key>
telnyx-edge secrets add TELNYX_API_KEY "<your_telnyx_api_key>"
telnyx-edge secrets add RCS_AGENT_ID "<your_rcs_agent_id>"

# 5. Generate type definitions from telnyx.toml bindings
telnyx-edge types

# 6. Run the smoke test to verify the module loads
npx tsx smoke_test.ts

# 7. Deploy (or run locally with telnyx-edge)
telnyx-edge ship
```

## API Reference

### `POST /webhook/message`

Inbound webhook endpoint for Telnyx RCS `message.received` events.

**Request body** (Telnyx webhook envelope):

```json
{
  "data": {
    "payload": {
      "from": "+15551234567",
      "suggestion_response": {
        "postback_data": "book_appt",
        "text": "Book appointment"
      },
      "text": "I need to schedule a checkup"
    }
  }
}
```

- `payload.from` — The patient's phone number (E.164 format).
- `payload.suggestion_response.postback_data` — Programmatic routing key from a tapped suggested reply (e.g., `book_appt`, `service_general`, `date_mon_9am`).
- `payload.suggestion_response.text` — User-visible label of the tapped suggestion.
- `payload.text` — Free-text message from the patient (present when no suggestion was tapped).

**Response:**

```json
{ "received": true }
```

### `GET /health`

Health check endpoint.

**Response:**

```json
{ "status": "ok" }
```

### Actor RPC: `handleInbound(payload)`

Called internally by the webhook handler. Restores or creates thread state for the patient, processes the inbound payload (postback or free-text), and sends the next card.

### Internal Methods

| Method | Description |
|---|---|
| `advanceFromPostback(postbackData)` | Routes a tapped suggestion to the next triage stage and sends the corresponding rich card |
| `classifyFreeText(text)` | Calls the Telnyx Decision Model to classify intent, urgency, and emergency status |
| `callDecisionModel(freeText, stage)` | Raw `fetch` to `POST /v2/ai/typesafe/v1/systemone` with `telnyx/decision-flash` model |
| `checkCapabilities(phone)` | Queries `GET /v2/messaging/rcs/capabilities/{agent_id}/{phone}` for `supports_rich_cards` |
| `sendRichCard(card, fallbackText?)` | Sends an RCS rich card via `POST /v2/messages/rcs`; includes `sms_fallback` if capabilities check fails |
| `persistThread()` | Upserts thread state into the `threads` SQL table |
| `persistBooking(state)` | Inserts a booking record into the `bookings` SQL table |

### SQL Schema

```sql
CREATE TABLE IF NOT EXISTS threads (
  phone TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  intent TEXT,
  slot TEXT,
  last_card TEXT,
  taps TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  slot TEXT NOT NULL,
  at INTEGER NOT NULL
);
```

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `RCS_AGENT_ID secret not configured` | The `RCS_AGENT_ID` secret was not set via `telnyx-edge secrets add` | Run `telnyx-edge secrets add RCS_AGENT_ID "<your_agent_id>"` |
| `TELNYX_API_KEY secret not configured` | The API key secret was not set | Run `telnyx-edge secrets add TELNYX_API_KEY "<your_key>"` |
| `RCS send failed: 403` | The API key lacks RCS permissions or the agent ID is invalid | Verify the API key has RCS scope in the Telnyx Portal; confirm the agent ID exists |
| `Decision model error: 408` | The Decision Model API call timed out | Increase `DECISION_TIMEOUT_MS` in `.env`; check network connectivity to `api.telnyx.com` |
| `supports_rich_cards: false` for all numbers | The RCS agent is not yet carrier-approved | Use `POST /v2/rcs/agents/{id}/test_devices` to register a test device for pre-approval testing |
| Actor not re-born on restart | `idFromName` is not being called with the correct phone digits | Verify the webhook handler extracts digits from `payload.from` via `replace(/\D/g, "")` |
| Duplicate bookings | `persistBooking` is called multiple times for the same slot | The actor's durable state prevents re-entry; ensure the `confirm` stage only persists once per thread |
| `THREADS_DB` binding not found | The SQL database binding is not declared in `telnyx.toml` | Add `[storage.sqldb.THREADS_DB] id = "<db-uuid>"` to `telnyx.toml` and run `telnyx-edge types` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md) — Register your organization for Telnyx Edge Compute and Stateful Actors
- [Team Telnyx AI](https://github.com/team-telnyx/ai) — Open-source AI tooling and Decision Models for Telnyx Edge
- [llms.txt](https://telnyx.com/llms.txt) — Machine-readable documentation index for Telnyx APIs and SDKs

## Related Examples

- `sms-triage-bot` — Plain SMS keyword-based triage (DEV-803/DEV-815) — no rich cards, no postbacks
- `sms-keyword-intake` — SMS keyword routing for appointment booking (DEV-1193) — SMS-only, no RCS
- `rcs-rich-card-catalog` — RCS carousel cards for product browsing — no actor state, no triage flow
- `voice-triage-ivr` — Call Control IVR for healthcare triage — voice channel, no messaging

## Resources

- [Send an RCS Message — Telnyx Developer Docs](https://developers.telnyx.com/docs/messaging/messages/send-an-rcs-message)
- [Receiving RCS Webhooks — Telnyx Developer Docs](https://developers.telnyx.com/docs/messaging/messages/receiving-rcs-webhooks)
- [RCS Capabilities API — Telnyx Developer Docs](https://developers.telnyx.com/docs/messaging/messages/rcs-capabilities)
- [Create an RCS Agent — Telnyx API Reference](https://developers.telnyx.com/api-reference/rcs-agents/create-an-rcs-agent)
- [Telnyx Decision Models — Telnyx Developer Docs](https://developers.telnyx.com/docs/inference/decision-models)
- [Stateful Actors — Telnyx Edge Compute](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK SQL — Telnyx Developer Docs](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Edge Runtime SDK (`@telnyx/edge-runtime`)](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Telnyx Pricing](https://telnyx.com/pricing)
