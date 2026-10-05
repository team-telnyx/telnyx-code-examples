# RCS Triage Receptionist — Developer Guide

This guide walks you through the `rcs-triage-receptionist` sample: a stateful Telnyx Edge actor that acts as a clinic's RCS front desk, presenting tappable rich-card triage options, classifying free-text intent via Telnyx Decision Models, and gracefully falling back to plain SMS for non-RCS devices.

---

## Prerequisites

- A Telnyx account with RCS enabled and an RCS Agent provisioned (`RCS_AGENT_ID`)
- A Telnyx Messaging Profile ID (`MESSAGING_PROFILE_ID`)
- The Telnyx Edge CLI installed and authenticated:
  ```bash
  telnyx-edge auth api-key set <your_api_key>
  ```
- Node.js 18+ and `npx tsx` for running the smoke test locally

---

## Environment Setup

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Fill in the following variables:

| Variable | Description |
|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key (stored as a secret) |
| `RCS_AGENT_ID` | The RCS Agent ID for your clinic |
| `MESSAGING_PROFILE_ID` | Your Telnyx Messaging Profile ID |
| `SMS_FALLBACK_FROM` | Phone number to use for SMS fallback (E.164 format) |
| `TRIAGE_EMERGENCY_NURSE` | Nurse line phone number for emergencies |
| `DECISION_TIMEOUT_MS` | Timeout for Decision Model calls (default: 8000) |

Secrets are configured via the Telnyx Edge CLI:

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_api_key_here"
telnyx-edge secrets add RCS_AGENT_ID "your_agent_id_here"
```

---

## Project Structure

```
rcs-triage-receptionist/
├── src/
│   └── index.ts          # Main Receptionist actor + webhook handler
├── smoke_test.ts         # Verifies module loads and class exists
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
└── .gitignore
```

---

## How It Works — Step by Step

### 1. Actor Birth on First Inbound Message

When a patient texts the clinic's RCS agent, Telnyx delivers a `message.received` webhook to the `/webhook/message` endpoint (see the default `fetch` handler at the bottom of `src/index.ts`).

The handler extracts the sender's phone number, strips non-digits, and calls:

```typescript
const actorStub = this.env.FRONTDESK.idFromName(phoneDigits);
await actorStub.handleInbound(payload);
```

This uses the **Agent SDK's `idFromName`** primitive to deterministically map a patient's phone number to a unique actor instance. If this is the first message from that number, the actor is born with `initialState()` — a fresh `ThreadState` with `stage: "greeting"`. If the actor was previously killed mid-triage, `idFromName` rehydrates it from durable storage, restoring the exact thread state. This satisfies the **restart-proof** acceptance criterion.

### 2. Greeting Card — Rich Card with Suggested Replies

On the first inbound message (or when the thread is in the `greeting` stage), the actor sends a **standalone rich card** defined as `GREETING_CARD`. This card has three suggested replies:

- **"Book appointment"** → `postback_data: "book_appt"`
- **"Refill prescription"** → `postback_data: "refill"`
- **"Talk to a nurse"** → `postback_data: "nurse"`

The card is sent via `POST /v2/messages/rcs` with the `agent_message.content_message.rich_card.standalone_card` structure. The `sendRichCard` method (in the `Receptionist` class) handles this, including the capabilities check and SMS fallback logic.

### 3. Tap Routing via `suggestion_response.postback_data`

When the patient taps a suggested reply, Telnyx sends another `message.received` webhook. The payload includes:

```json
{
  "suggestion_response": {
    "postback_data": "book_appt",
    "text": "Book appointment"
  }
}
```

The `handleInbound` method detects `suggestion_response` and calls `advanceFromPostback(postbackData)`. This method uses a `switch` statement to route based on the `postback_data` value:

- `"book_appt"` → advances to the `service` stage, sends `SERVICE_CARD`
- `"refill"` → completes the flow, sends a confirmation message
- `"nurse"` → connects to the nurse line
- `"service_general"`, `"service_dental"`, `"service_pediatrics"` → advances to the `date` stage
- `"date_mon_9am"`, `"date_tue_2pm"`, `"date_wed_11am"` → advances to `confirm` stage, persists booking

Each tap is recorded in `state.taps` for auditability.

### 4. Multi-Stage Booking Flow

The booking flow progresses through **four stages**:

1. **Greeting** → `GREETING_CARD` (3 suggested replies)
2. **Service** → `SERVICE_CARD` (3 service options)
3. **Date** → `DATE_CARD` (3 date/time slots)
4. **Confirm** → `CONFIRM_CARD` (confirm or restart)

State is held durably in the actor's `ThreadState` and also persisted to SQL via `persistThread()`. The `CARD_MAP` constant maps stage names to their card definitions, so the actor can re-send the correct card if needed.

### 5. Free-Text Classification via Decision Models

If the patient types free text instead of tapping a button, the `classifyFreeText` method calls the **Telnyx Decision Models API**:

```
POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone
```

With the model `telnyx/decision-flash` and three questions:

- **intent** (`choice`): classifies as `book`, `refill`, `nurse`, or `urgent`
- **urgency** (`score`): numeric urgency score
- **emergency** (`noul`): routes to nurse line if true

The verdict is logged in `state.taps` and the actor routes to the appropriate card. If the intent is `urgent` or `emergency` is true, the patient is immediately connected to the nurse line.

### 6. Capabilities Check + SMS Fallback

Before sending any rich card, `sendRichCard` calls `checkCapabilities(phone)`, which queries:

```
GET /v2/messaging/rcs/capabilities/{agent_id}/{phone_number}
```

If `supports_rich_cards` is `false` (non-RCS device), the send payload includes an `sms_fallback` object with a plain-text version of the message. This means **one API call serves both RCS and non-RCS devices** — the patient on a non-RCS phone receives a readable SMS instead of a broken rich card.

### 7. Booking Persistence to SQL

When the patient selects a date slot, `persistBooking` inserts a record into the `bookings` table:

```sql
INSERT INTO bookings (phone, provider, status, slot, at) VALUES (?, ?, ?, ?, ?)
```

The `threads` table is updated on every state change via `persistThread()`, using `ON CONFLICT(phone) DO UPDATE` for upsert semantics. Both tables are initialized in `initSchema()`.

### 8. Confirmation Card

After booking, the actor sends `CONFIRM_CARD` with two options: "Book another" (restarts the flow) or "Main menu" (returns to greeting).

---

## Demo Mode vs Live Mode

**Demo mode** is the default. The sample uses real Telnyx API endpoints but with placeholder configuration. To run in demo mode:

1. Set up your `.env` with test values
2. Deploy the actor:
   ```bash
   telnyx-edge ship
   ```
3. Send a test message to your RCS agent from a test device

**Live mode** requires real Telnyx credentials and a carrier-approved RCS agent. Switch by replacing placeholder values in `.env` with production values and re-deploying.

The capabilities check + SMS fallback path is always active — you can test both RCS and non-RCS flows by sending from different numbers.

---

## Running the Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `Receptionist` class loads, `initialState()` returns the correct shape, and the card definitions are valid.

---

## Next Steps

- [Telnyx RCS Messaging Docs](https://developers.telnyx.com/docs/messaging/messages/send-an-rcs-message) — Rich card structure, suggestions, and media
- [RCS Webhooks Guide](https://developers.telnyx.com/docs/messaging/messages/receiving-rcs-webhooks) — `message.received`, `suggestion_response`, and outbound status events
- [RCS Capabilities API](https://developers.telnyx.com/docs/messaging/messages/rcs-capabilities) — Checking device support for rich cards
- [RCS Agents API](https://developers.telnyx.com/api-reference/rcs-agents/create-an-rcs-agent) — Provisioning agents and test devices
- [Decision Models](https://developers.telnyx.com/docs/inference/decision-models) — `choice`, `score`, and `noul` question types
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — `idFromName`, durable state, and restart semantics
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql) — Durable storage with SQLite bindings
