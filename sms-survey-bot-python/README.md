---
name: sms-survey-bot
title: "SMS Survey Bot"
description: "Run multi-question SMS surveys over the Telnyx Messaging API. Sends questions, validates inbound replies via signed webhooks, tracks per-participant progress, and exposes results."
language: python
framework: flask
telnyx_products: [Messaging]
channel: [sms]
---

# SMS Survey Bot

Run multi-question SMS surveys over the Telnyx Messaging API. Sends questions, validates inbound replies via signed webhooks, tracks per-participant progress, and exposes results.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** — number reputation, 10DLC registration, and deliverability monitoring are included.
- **Signed webhooks** — every inbound event is Ed25519-signed so you can reject spoofed traffic before processing.
- **Developer-first** — typed SDKs for Python, Node.js, Go, and Ruby with a consistent webhook event model.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — sends each survey question, validation prompts, and the completion message. [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound message webhook** (`message.received`): Telnyx delivers each participant reply to `/webhook/sms`. [Webhook reference](https://developers.telnyx.com/api-reference/inbound-message-webhook)

| Direction | Endpoint / Event | Purpose |
|-----------|------------------|---------|
| Outbound | `POST /v2/messages` | Send survey questions and the completion message |
| Inbound | `message.received` webhook | Receive participant replies |

## Architecture

```
  POST /survey/start ──┐
                       ▼
              ┌──────────────────┐
              │  Flask app        │
              │  (survey state)   │──► POST /v2/messages ──► participant
              └────────┬─────────┘
                       ▲
   participant reply ──┘
   (message.received) ──► POST /webhook/sms (signature verified)
                       │
                       └──► advance question / complete / reject
```

The Flask app holds per-participant survey state in memory (swap for a database in
production). It sends questions outbound via the Messaging API and receives replies
on a single signed webhook, advancing each participant through the question set.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key, used to send messages | [Portal → API Keys](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `e5b5c...` | **yes** | Public key used to verify inbound webhook signatures | [Portal → Account → Public Key](https://portal.telnyx.com) |
| `TELNYX_PHONE_NUMBER` | `string` | `+15551234567` | **yes** | SMS-enabled Telnyx number the survey sends from (E.164) | [Portal → Numbers](https://portal.telnyx.com/numbers/my-numbers) |
| `FLASK_DEBUG` | `string` | `false` | no | Enable Flask debug mode | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure it in the [Telnyx Portal](https://portal.telnyx.com):

   - **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhook/sms`

3. Copy your **Public Key** from the Portal account page into `TELNYX_PUBLIC_KEY`. Inbound webhooks are rejected with `401` if the signature does not verify.

## API Reference

### `POST /survey/start`

Start a survey for a participant. Sends them the first question.

```bash
curl -X POST http://localhost:5000/survey/start \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

**Response:**

```json
{
  "participant": "+12125551234",
  "message_id": "msg-f5d7a7e0-1234-5678",
  "question_number": 1,
  "total_questions": 3,
  "status": "survey_started"
}
```

### `POST /webhook/sms`

Telnyx delivers inbound `message.received` events here. The signature is verified
before the body is parsed. A reply of `START` begins a new survey; any other reply
advances the participant's active survey. This endpoint is called by Telnyx, not by you.

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+12125551234" },
      "text": "5"
    }
  }
}
```

**Response:**

```json
{
  "status": "question_sent",
  "message_id": "msg-aaaa-bbbb",
  "question_number": 2,
  "total_questions": 3
}
```

### `GET /survey/results`

Return progress and recorded answers for all participants.

```bash
curl http://localhost:5000/survey/results
```

**Response:**

```json
{
  "total_participants": 1,
  "results": [
    {
      "participant": "+12125551234",
      "status": "in_progress",
      "responses_count": 1,
      "responses": [
        { "question_id": 1, "question_text": "How satisfied...", "response": "5" }
      ]
    }
  ]
}
```

### `GET /survey/participant/<participant>`

Return progress and answers for a single participant (URL-encode the `+`).

```bash
curl http://localhost:5000/survey/participant/%2B12125551234
```

**Response:**

```json
{
  "participant": "+12125551234",
  "status": "completed",
  "responses_count": 3,
  "responses": [
    { "question_id": 1, "question_text": "How satisfied...", "response": "5" },
    { "question_id": 2, "question_text": "Would you recommend...", "response": "Y" },
    { "question_id": 3, "question_text": "How likely...", "response": "4" }
  ]
}
```

## Troubleshooting

- **401 `invalid signature` on `/webhook/sms`**: `TELNYX_PUBLIC_KEY` is missing or wrong. Copy the Public Key from the Telnyx Portal account page into `.env` and restart. The key must match the account that owns the Messaging Profile.
- **Webhook never fires**: Confirm the Messaging Profile's inbound webhook URL points at `/webhook/sms` on your public (ngrok) URL and that the receiving number is assigned to that profile.
- **401 `Invalid API key`**: `TELNYX_API_KEY` is wrong or revoked. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Survey state lost after restart**: State lives in the in-memory `survey_responses` dict. Replace it with a database (PostgreSQL, Redis) for production.
- **Valid reply rejected as invalid**: Replies are matched exactly against `valid_responses` in `SURVEY_QUESTIONS`. Check case (`Y`/`y`) and that whitespace is stripped.
- **429 Rate limit exceeded**: Space out survey starts and add backoff between sends when running large batches.

## Related Examples

- [send-sms-python](../send-sms-python/) — send a single SMS message.
- [ai-compliance-quiz-phone-python](../ai-compliance-quiz-phone-python/) — interactive quiz over voice with signed webhooks.

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send a Message — API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Inbound Message Webhook reference](https://developers.telnyx.com/api-reference/inbound-message-webhook)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)
