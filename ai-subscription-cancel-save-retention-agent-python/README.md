---
name: ai-subscription-cancel-save-retention-agent
title: "AI Subscription Cancel-Save Retention Agent"
description: "Inbound voice agent that handles subscription cancellation requests, classifies the reason with AI, offers one eligible save option, and records saved, cancelled, paused, transferred, or follow-up outcomes."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: []
channel: [voice, sms]
---

# AI Subscription Cancel-Save Retention Agent

A Flask app that handles inbound calls from customers who want to cancel their
subscription. The agent verifies the customer by caller ID, asks why they
want to cancel, classifies the reason with Telnyx AI Inference, offers one
eligible save option, and records the outcome.

The agent is non-manipulative. A direct "cancel now" or a polite refusal
ends with a graceful cancellation. Temporary situations route to a pause
offer. Angry customers or requests for a human transfer immediately.

## What It Does

- Answers inbound voice calls and looks up the customer by caller ID
- Asks the customer why they want to cancel
- Classifies the reason (`too_expensive`, `not_using`, `missing_feature`, `support_issue`, `competitor_switch`, `temporary_pause`, `other`) with AI Inference
- Detects urgent phrases (lawyer, sue, fraud, chargeback, BBB) and transfers to a human
- Offers one save option based on the reason (discount, onboarding call, roadmap note, support callback, comparison call, pause)
- Records the outcome (`saved`, `cancelled`, `paused`, `transferred`, `needs_followup`) and updates the customer record
- Handles ambiguous yes/no with a single clarifying prompt instead of looping
- Tracks call hangups as `needs_followup` so reps can call back

## Telnyx API Endpoints Used

- Call Control: Answer — `POST /v2/calls/{id}/actions/answer` — [reference](https://developers.telnyx.com/api/call-control/answer-call)
- Call Control: Speak — `POST /v2/calls/{id}/actions/speak` — [reference](https://developers.telnyx.com/api/call-control/speak)
- Call Control: Gather — `POST /v2/calls/{id}/actions/gather` — [reference](https://developers.telnyx.com/api/call-control/gather)
- Call Control: Transfer — `POST /v2/calls/{id}/actions/transfer` — [reference](https://developers.telnyx.com/api/call-control/transfer-call)
- Messaging: Send — `POST /v2/messages` — [reference](https://developers.telnyx.com/api/messaging/send-message)
- AI Inference: Chat Completions — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)

## Telnyx Webhook Events

- `call.initiated` — New inbound call — answer it
- `call.answered` — Call connected — verify the customer and greet
- `call.speak.ended` — TTS playback finished — start speech gather
- `call.gather.ended` — Caller speech transcribed — classify and respond
- `call.hangup` — Call ended — finalize case if still open

## Architecture

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
   Ask for     │
   phone #     │
   on file     │
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

  State: In-memory dict (customers, retention_cases, calls)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | string | `KEY0123456789ABCDEF` | yes | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | string | `-----BEGIN PUBLIC KEY-----...` | yes | Public key used to verify inbound webhook signatures | [Portal](https://portal.telnyx.com/api-keys) |
| `MAIN_NUMBER` | string | `+18005551234` | yes | Telnyx phone number (E.164) | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `CONNECTION_ID` | string | `1494404757140276705` | yes | Call Control application ID | [Portal](https://portal.telnyx.com/call-control/applications) |
| `AI_MODEL` | string | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Docs](https://developers.telnyx.com/docs/inference/models) |
| `TTS_VOICE` | string | `AWS.Polly.Joanna-Neural` | no | Telnyx Call Control voice | [Docs](https://developers.telnyx.com/docs/voice/call-control/commands/speak) |
| `TTS_LANGUAGE` | string | `en-US` | no | BCP-47 language tag for TTS | — |
| `HUMAN_ESCALATION_NUMBER` | string | `+18005559999` | no | Number to transfer angry or human-requesting callers to | [Portal](https://portal.telnyx.com/numbers/my-numbers) |
| `HOST` | string | `127.0.0.1` | no | Bind host | — |
| `PORT` | int | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-subscription-cancel-save-retention-agent-python
cp .env.example .env
# Edit .env with your Telnyx credentials
pip install -r requirements.txt
python app.py
```

Server starts on `http://localhost:5000`.

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

3. Verify inbound webhooks are signed — the app validates the Ed25519 signature against `TELNYX_PUBLIC_KEY` on every request.

## Demo Flow

1. Start the app.
2. Seed a customer:

   ```bash
   curl -X POST http://localhost:5000/customers \
     -H "Content-Type: application/json" \
     -d '{"customer_id": "CUST-001", "name": "Jordan", "phone": "+15551112233", "plan": "pro"}'
   ```

3. Call the Telnyx number from `+15551112233` (or change the phone in step 2 to match your real caller ID).
4. Say: "I want to cancel my subscription."
5. The agent asks why. Say: "It's too expensive."
6. The agent offers: "Based on what you said, here's one thing I can offer: 25% off for 3 months. Would that change your mind, or would you still like to cancel?"
7. Say yes or no.
8. Inspect the outcome:

   ```bash
   curl http://localhost:5000/retention-cases
   ```

## Cancellation Reasons and Default Offers

| Reason | Offer | Default outcome if accepted |
|--------|-------|------------------------------|
| `too_expensive` | 25% off for 3 months | `saved` |
| `not_using` | Free onboarding call + 1 free month | `saved` |
| `missing_feature` | Roadmap note + specialist follow-up | `needs_followup` |
| `support_issue` | Priority support callback | `needs_followup` |
| `competitor_switch` | 15-minute comparison consultation | `needs_followup` |
| `temporary_pause` | Pause for up to 60 days, no charge | `paused` |
| `other` | Specialist follow-up call | `needs_followup` |

## Retention Outcomes

| Outcome | Meaning |
|---------|---------|
| `saved` | Customer accepted the offer and stayed |
| `cancelled` | Customer cancelled (directly or after declining the offer) |
| `paused` | Customer accepted a pause offer |
| `transferred` | Customer was transferred to a human (angry or explicitly asked) |
| `needs_followup` | Open question or hangup; needs human follow-up |

## Edge Cases Handled

- Customer not found by caller ID — agent says so and ends the call
- Customer already cancelled — agent confirms and asks if anything else is needed
- Direct cancellation request ("cancel now") — agent cancels without offering
- Repeated "no" to the offer — agent cancels
- Ambiguous yes/no — agent asks once for confirmation, no infinite loop
- AI Inference returns malformed JSON — falls back to `other / neutral` and offers the default follow-up
- Angry customer or threat of legal action — immediate transfer to human escalation number
- Caller asks for a human — immediate transfer
- Hangup before resolution — case finalized as `needs_followup`
- Duplicate webhook delivery — event IDs are tracked for one hour and deduplicated
- SMS confirmation send fails — logged but does not block the call

## Going to Production

This example uses in-memory storage and seeded customers. For production:

- **Database** — replace the `customers` and `retention_cases` dicts with your billing-system integration (Stripe, Recurly, Chargebee)
- **Real customer verification** — replace the `lookup_customer` phone match with an authenticated lookup that asks for a one-time code from the customer's email or app
- **Consent recording** — add `record_channels: "dual"` to the answer action for compliance audits, with explicit consent at the start of the call
- **Real offers** — wire the offer text into your billing system so a `saved` outcome actually applies the discount
- **Pause real billing** — wire `paused` into your billing system to defer the next invoice
- **Multi-language** — swap the TTS voice and the system prompt per customer's locale

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 invalid signature` on webhook | `TELNYX_PUBLIC_KEY` does not match | Copy the public key exactly from [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| "I don't see your account on this number" | Caller ID didn't match a seeded customer | Seed the customer first with `POST /customers` |
| AI classification always returns `other` | `AI_MODEL` not available on your account | List models: `curl -H "Authorization: Bearer $TELNYX_API_KEY" https://api.telnyx.com/v2/ai/models`. Common fallbacks: `openai/gpt-4o`, `Qwen/Qwen3-235B-A22B` |
| Customer stuck in loop | Old version with yes/no regex bug | Update to current `app.py` (yes/no are word-boundary regex matches, one clarification only) |
| Transfer fails silently | `HUMAN_ESCALATION_NUMBER` not set | Add it to `.env`. Without it, the case is still marked `transferred` for the record |

## Related Examples

- [AI Customer Winback Caller](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-winback-caller-python/README.md) — outbound variant
- [AI Customer Churn Predictor](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-churn-predictor-python/README.md) — pre-emptive churn scoring
- [AI Tech Support Voice Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-tech-support-voice-agent-python/README.md) — pattern reference
- [AI Receptionist with Booking Tools](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-receptionist-with-booking-tools-python/README.md) — function-calling pattern reference

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI inference, and IoT on one private, global network. Co-located voice and inference means the agent's STT, TTS, and LLM calls stay on the same private backbone for sub-second round trips even during a cancel-save conversation that depends on every turn landing fast.
