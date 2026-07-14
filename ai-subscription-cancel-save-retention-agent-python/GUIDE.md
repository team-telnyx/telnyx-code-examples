# AI Subscription Cancel-Save Retention Agent — Build Guide

A non-manipulative inbound voice agent that handles subscription cancellation
requests, classifies the reason with AI Inference, offers one eligible save
option, and records the outcome.

## What It Does

A customer calls in saying they want to cancel. The agent:

1. Verifies the customer by inbound caller ID
2. Asks why they want to cancel
3. Classifies the reason with Telnyx AI Inference
4. Detects angry customers or requests for a human and transfers
5. Offers one save option based on the reason
6. Records the outcome (`saved`, `cancelled`, `paused`, `transferred`, `needs_followup`)
7. Updates the customer record (active / paused / cancelled)
8. Sends an SMS confirmation when the outcome is final

The agent is non-manipulative. A direct cancellation request ends with a
graceful cancellation. The offer is presented once; a polite decline
cancels immediately.

## How It Works

```
  Inbound Phone Call
            │
            ▼
  ┌──────────────────────────┐
  │ Answer + verify caller   │ ── lookup customer by phone
  └────────────┬─────────────┘
               │
   ┌───────────┴────────────┐
   │ Customer on file?      │
   └───────────┬────────────┘
        no     │
        ▼      │ yes
   End call    │
   politely    │
        │      │
        │      ▼
        │  ┌─────────────────────────┐
        │  │ Ask: why cancel?        │
        │  └────────────┬────────────┘
        │               │
        │               ▼
        │  ┌─────────────────────────┐
        │  │ AI Inference: classify  │
        │  │ reason + sentiment      │
        │  └────────────┬────────────┘
        │               │
        │       ┌───────┼───────┬──────────┐
        │       ▼       ▼       ▼          ▼
        │    angry    wants   standard    direct
        │       │    human   reason     cancel
        │       │       │       │          │
        │       ▼       ▼       ▼          ▼
        │   transfer  transfer offer × 1  cancel
        │       │       │       │          │
        │       └───┬───┘       ▼          │
        │           │       ┌────────────┐ │
        │           │       │ Yes / No ? │ │
        │           │       └─────┬──────┘ │
        │           │         │        │   │
        │           │         ▼        ▼   │
        │           │     accept      decline │
        │           │         │        │   │
        │           │         ▼        ▼   │
        │           │   save policy   cancel  │
        │           │         │        │   │
        │           ▼         ▼        ▼   ▼
        │       ┌────────────────────────────┐
        │       │ Record outcome + customer  │
        │       │ status update + SMS confirm│
        │       └────────────────────────────┘
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change
- **AI Inference** — classifies the cancel reason and sentiment in a single prompt
- **Messaging** — SMS confirmation on outcome

## API Endpoints

- **Call Control: Answer** — `POST /v2/calls/{id}/actions/answer` — [reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak** — `POST /v2/calls/{id}/actions/speak` — [reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Gather** — `POST /v2/calls/{id}/actions/gather` — [reference](https://developers.telnyx.com/api/call-control/gather)
- **Call Control: Transfer** — `POST /v2/calls/{id}/actions/transfer` — [reference](https://developers.telnyx.com/api/call-control/transfer-call)
- **Messaging: Send** — `POST /v2/messages` — [reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference: Chat Completions** — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` — New inbound call — answer it
- `call.answered` — Call connected — verify customer, start the conversation
- `call.speak.ended` — TTS playback finished — start speech gather
- `call.gather.ended` — Caller speech transcribed — classify or accept offer
- `call.hangup` — Call ended — finalize case if still open

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys) — copy both the API key and the public key
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) pointing at your webhook URL
- A second number to use as `HUMAN_ESCALATION_NUMBER` (optional)
- [ngrok](https://ngrok.com) for exposing your local server

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-subscription-cancel-save-retention-agent-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. `HUMAN_ESCALATION_NUMBER` is optional — without it, transfers log as `transferred` but do not actually move the call.

## Step 2: Understand the Code

Everything lives in `app.py`. The interesting bits:

### `classify_reason(text, transcript)`

Single-prompt classifier that returns:

```json
{
  "reason": "too_expensive | not_using | missing_feature | support_issue | competitor_switch | temporary_pause | other",
  "sentiment": "calm | frustrated | angry | sad | neutral",
  "wants_human": false,
  "wants_pause": false,
  "summary": "..."
}
```

Falls back to a deterministic `other / neutral` if the LLM returns malformed JSON. Uses simple keyword pre-checks for hard urgency phrases (`lawyer`, `sue`, `fraud`, `chargeback`, `bbb`) and direct human requests (`human`, `agent`, `manager`).

### `OFFER_POLICY`

Static mapping from reason to one offer text and one default outcome. The agent presents the offer once, then accepts or cancels based on the caller's response.

### `detect_direct_cancel`, `detect_yes`, `detect_no`

Regex helpers for short-circuiting the flow. Direct cancellation is checked first so a caller who says "cancel now" never gets an offer.

### `start_case(phone)`

Verifies the customer by caller ID, refuses to start a new case if the customer is already cancelled or unknown.

### `finalize_case(case_id, outcome, ...)`

Records the outcome and updates the customer status (`active` / `paused` / `cancelled`). Idempotent on re-call.

### `handle_voice()`

State machine driven by Call Control webhooks:

1. `call.initiated` (inbound) → answer the call
2. `call.answered` → start a case (or refuse), greet the customer, ask why
3. `call.speak.ended` → start a speech gather
4. `call.gather.ended` (awaiting_reason) → classify, decide whether to offer or transfer
5. `call.gather.ended` (awaiting_offer_response) → accept, decline, or clarify once
6. `call.hangup` → finalize as `needs_followup` if open

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Telnyx Call Control webhook |
| `POST` | `/customers` | Seed a customer (idempotent on conflict) |
| `GET` | `/customers` | List seeded customers |
| `GET` | `/retention-cases` | List cases (filter by `status`, `outcome`) |
| `GET` | `/retention-cases/<case_id>` | Get one case with transcript |
| `POST` | `/retention-cases/<case_id>/complete` | Manually finalize a case |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## Step 4: Test It

**Seed a customer:**

```bash
curl -X POST http://localhost:5000/customers \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "CUST-001", "name": "Jordan", "phone": "+15551112233", "plan": "pro"}'
```

**Call the Telnyx number** from `+15551112233` and walk through:

- "I want to cancel my subscription."
- "It's too expensive."
- "Yes" (or "no").

**Health check:**

```bash
curl http://localhost:5000/health
```

**Inspect cases:**

```bash
curl http://localhost:5000/retention-cases | python3 -m json.tool
```

**Get a single case:**

```bash
curl http://localhost:5000/retention-cases/ret-1234abcd
```

**Manually close a case** (for back-office follow-up):

```bash
curl -X POST http://localhost:5000/retention-cases/ret-1234abcd/complete \
  -H "Content-Type: application/json" \
  -d '{"outcome": "saved", "accepted_offer": true, "notes": "Manual save after callback"}'
```

## Going to Production

This example uses in-memory storage and seeded customers. For production:

- **Database** — replace `customers` and `retention_cases` with your billing-system integration (Stripe, Recurly, Chargebee)
- **Real verification** — replace the caller-ID match with a one-time code flow
- **Consent recording** — add `record_channels: "dual"` to the answer action for compliance audits
- **Real offers** — wire offer acceptance into the billing system so a `saved` outcome applies the discount
- **Real pause** — wire `paused` into billing to defer the next invoice
- **Multi-language** — swap TTS voice and system prompt per customer's locale

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-subscription-cancel-save-retention-agent-python)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
