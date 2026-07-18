---
name: ai-subscription-cancel-save-retention-agent
title: "AI Subscription Cancel-Save Retention Agent"
description: "Create a Telnyx AI Assistant that handles subscription cancellation calls, offers one eligible save option, and routes cancel, pause, save, follow-up, or escalation outcomes."
language: python
framework: flask
telnyx_products: [AI Assistants, Voice]
integrations: []
channel: [voice]
---

# AI Subscription Cancel-Save Retention Agent

A Flask setup app that creates a managed Telnyx AI Assistant for subscription
cancel-save conversations and optionally attaches it to a Telnyx phone number.
It uses Telnyx AI Communications Infrastructure for the phone number,
telephony connection, speech pipeline, and managed assistant runtime.

The assistant uses a conversational workflow rather than a brittle IVR state
machine. Callers can speak naturally, go out of order, ask questions, accept or
decline offers, or ask for a human.

## What It Does

- Creates or updates a Telnyx AI Assistant with telephony enabled
- Uses Telnyx Ultra voice for a more natural phone demo
- Defines a subscription retention workflow in assistant instructions
- Personalizes one save offer based on cancellation reason
- Respects direct cancellation requests without repeated pressure
- Escalates angry callers, legal-risk phrases, fraud, chargebacks, or human requests
- Optionally assigns a Telnyx phone number to the assistant's telephony app

## Why Telnyx

Telnyx combines programmable phone numbers, voice connectivity, hosted AI
Assistants, and natural Telnyx Ultra voices in one platform. That lets this
sample provision a complete phone-based retention agent from code, then receive
real inbound calls without building a custom speech recognition, turn-taking,
or text-to-speech pipeline.

## Telnyx API Endpoints Used

- AI Assistants: Create — `POST /v2/ai/assistants` — [reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- AI Assistants: Update — `POST /v2/ai/assistants/{assistant_id}` — [reference](https://developers.telnyx.com/api-reference/assistants/update-an-assistant)
- AI Assistants: Get — `GET /v2/ai/assistants/{assistant_id}` — [reference](https://developers.telnyx.com/api-reference/assistants/get-an-assistant)
- Phone Numbers: List — `GET /v2/phone_numbers`
- Phone Numbers: Update — `PATCH /v2/phone_numbers/{id}`

## Architecture

```text
  developer runs flask setup app
             |
             v
  /assistant/provision
             |
             v
  create or update telnyx ai assistant
             |
             v
  assistant gets a default telephony app
             |
             v
  optional phone number assignment
             |
             v
  caller dials telnyx number
             |
             v
  managed ai assistant handles conversation
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | yes | Telnyx API v2 key |
| `ASSISTANT_NAME` | no | Name for the assistant |
| `AI_MODEL` | no | Assistant model, default `openai/gpt-4o` |
| `TTS_VOICE` | no | Telnyx voice id |
| `PHONE_NUMBER` | no | E.164 number to assign |
| `PHONE_NUMBER_ID` | no | Phone number id to assign |
| `HOST` | no | Flask bind host |
| `PORT` | no | Flask port |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-subscription-cancel-save-retention-agent-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

Server starts on `http://localhost:5000`.

## Provision The Assistant

Create or update the assistant:

```bash
curl -X POST http://localhost:5000/assistant/provision \
  -H "Content-Type: application/json" \
  -d '{}'
```

Create the assistant and assign a number in the same call:

```bash
curl -X POST http://localhost:5000/assistant/provision \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+15551234567"}'
```

You can also pass `phone_number_id` if you already know the Telnyx phone number
resource id.

## Demo Flow

1. Provision the assistant.
2. Assign a Telnyx phone number.
3. Open `/workflow` if you want to show the configured assistant behavior.
4. Call that number.
5. Speak naturally:

```text
i think i need to cancel. i am barely using this and it is getting expensive.
```

6. The assistant asks a natural follow-up or makes one save offer.
7. Accept, decline, ask for a human, or change your mind.

## Subscription Workflow

The assistant follows this policy:

| Reason | Offer |
|--------|-------|
| too expensive | 25 percent off for the next 3 months |
| not using | free onboarding call and one free month |
| missing feature | product feedback plus specialist follow-up |
| support issue | priority support callback |
| competitor switch | short comparison consultation |
| temporary pause | pause subscription for up to 60 days |
| other | specialist follow-up call |

The assistant makes one offer, then respects the caller's answer.

## Troubleshooting

- `TELNYX_API_KEY is required`: copy `.env.example` to `.env` and add a valid
  Telnyx API v2 key.
- `PHONE_NUMBER was not found`: pass the number in E.164 format, such as
  `+15551234567`, or pass `phone_number_id` directly.
- The number still reaches another app: run `/assistant/provision` with
  `phone_number` or `phone_number_id` again so the phone number points at the
  assistant's telephony app.
- The assistant voice sounds wrong: set `TTS_VOICE` to a Telnyx voice id. The
  sample defaults to a Telnyx Ultra voice.

## Going To Production

- Connect assistant tools to your billing system so accepted offers actually update invoices.
- Add a tool for cancellation confirmation and account state changes.
- Add CRM or ticketing tools for `needs_followup` outcomes.
- Add transfer configuration for live specialist escalation.
- Add dynamic variables such as `first_name`, `plan`, `monthly_price`, and `renewal_date`.

## Related Examples

- [Create AI Assistant Python](https://github.com/team-telnyx/telnyx-code-examples/tree/main/create-ai-assistant-python)
- [AI Assistant Phone Setup Python](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-assistant-phone-setup-python)
- [AI Assistant Multi Tool Python](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-assistant-multi-tool-python)

## Resources

- [AI Assistant quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Conversation workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows)
- [Dynamic variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
- [Telnyx Portal](https://portal.telnyx.com)
