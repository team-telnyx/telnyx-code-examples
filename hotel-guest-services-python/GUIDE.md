# Hotel Guest Services Line — Build Guide

A complete walkthrough of how the hotel concierge voice and SMS agent works,
from the first webhook event to the SMS that confirms fulfilment.

## What It Does

The Grand Hotel exposes one phone number for guest service. A guest can:

- Call and order room service, request housekeeping, ask the concierge, or report a maintenance issue
- Text the same number with the same kinds of requests

The app uses Telnyx Voice call control plus Telnyx AI Inference to greet the
guest, capture their room number, classify their request, log it, alert staff
on Slack, and confirm by SMS.

## How It Works

```
  Inbound Phone Call or SMS
            │
            ▼
  ┌────────────────────────┐
  │ Telnyx Voice / SMS     │
  │ webhook → Flask        │
  └──────────┬─────────────┘
             │
   ┌─────────┴─────────┐
   │ Caller known?     │
   │ (caller ID match) │
   └─────────┬─────────┘
             │ no
             ▼
   ┌─────────────────┐         ┌──────────────┐
   │ Ask for room #  │ ──────► │ Extract room │
   └─────────┬───────┘         │ from speech  │
             │                 └──────┬───────┘
             │                        │
             ▼                        ▼
   ┌────────────────────────────────────────┐
   │ AI Inference — categorize request     │
   │ department, urgency, summary, details │
   └────────────────┬───────────────────────┘
                    │
        ┌───────────┼────────────┬───────────┐
        ▼           ▼            ▼           ▼
   Room svc   Housekeeping  Concierge   Maintenance
        │           │            │           │
        └───────────┴─────┬──────┴───────────┘
                          │
                ┌─────────┴──────────┐
                ▼                    ▼
        Slack staff alert     SMS confirmation
                ▼
        Staff marks complete via API
                ▼
        Guest receives SMS

  State: In-memory dict (ROOMS, service_requests, calls)
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change
- **AI Inference** — OpenAI-compatible chat completions used to classify each request
- **Messaging** — SMS confirmations to the guest and the staff Slack fallback

## API Endpoints

- **Call Control: Answer** — `POST /v2/calls/{id}/actions/answer` — [reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak** — `POST /v2/calls/{id}/actions/speak` — [reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Gather** — `POST /v2/calls/{id}/actions/gather` — [reference](https://developers.telnyx.com/api/call-control/gather)
- **Messaging: Send** — `POST /v2/messages` — [reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference: Chat Completions** — `POST /v2/ai/chat/completions` — [reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):

- `call.initiated` — New inbound call — answer it
- `call.answered` — Call connected — speak a greeting (with guest name when caller ID matches)
- `call.speak.ended` — TTS playback finished — start speech gather
- `call.gather.ended` — Caller speech transcribed — process the request
- `call.hangup` — Call ended — drop the session

It also handles `message.received` for inbound SMS.

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys) — copy both the API key and the public key
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with both voice and SMS enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) pointing at your webhook URL
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) pointing at your webhook URL
- [Slack incoming webhook](https://api.slack.com/messaging/webhooks) (optional but recommended)
- [ngrok](https://ngrok.com) for exposing your local server

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hotel-guest-services-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. The `STAFF_SLACK_WEBHOOK` is optional — leave it blank to skip Slack alerts.

## Step 2: Understand the Code

Everything lives in `app.py`. The interesting bits:

### Room lookup and capture

`room_from_caller(phone)` matches the inbound caller ID against the `ROOMS` dict. `extract_room_number(text)` regex-extracts a room number from the caller's first utterance when their caller ID is unknown. Rooms 101 and 205 are seeded for the demo.

### `ai_categorize(text)`

Sends the request to Telnyx AI Inference with a system prompt that constrains the response to JSON with `department`, `urgency`, `summary`, and `details` fields. Falls back to `concierge / normal` if the model returns malformed JSON.

### `detect_urgency(text)`

Hardcoded phrase list (`fire`, `flood`, `leak`, `locked out`, `gas`, `medical`, `911`) overrides the LLM classification when matched. Urgent requests still get a department-aware Slack alert, just with a `:rotating_light:` prefix.

### `record_request(...)`

Appends to `service_requests`, sends the guest an SMS, and posts a Slack alert (if configured). Idempotent because the webhook handlers dedupe on event ID.

### `handle_voice()`

State machine driven by Call Control webhooks:

1. `call.initiated` (inbound) → answer the call
2. `call.answered` → speak a greeting (with guest name when caller ID matches)
3. `call.speak.ended` → start a speech gather
4. `call.gather.ended` → if no room yet, ask for it; otherwise classify, log, and confirm by voice
5. `call.hangup` → drop the session

### `handle_sms()`

Single-step: extract the sender phone, look up the room, classify, log, reply by SMS.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Telnyx Call Control webhook |
| `POST` | `/webhooks/sms` | Telnyx Messaging webhook |
| `GET` | `/requests` | List requests (filter by `department`, `status`) |
| `POST` | `/requests/<int:idx>/complete` | Mark complete, SMS the guest |
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
- **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Voice flow:** call the Telnyx number from a phone with caller ID `+15559001234` (room 101) or `+15559005678` (room 205). For an unknown number, say "Room 205 please" when prompted.

**SMS flow:** text the Telnyx number from `+15559001234` or `+15559005678`.

**Inspect requests:**

```bash
curl http://localhost:5000/requests | python3 -m json.tool
```

**Complete a request:**

```bash
curl -X POST http://localhost:5000/requests/0/complete
```

## Going to Production

This example uses in-memory storage and a hardcoded room list. For production:

- **Database** — replace `ROOMS` and `service_requests` with your PMS database (Opera, Mews, Cloudbeds)
- **Redis** — persist calls and processed-event IDs across restarts with a TTL
- **Queue** — Celery or RQ for Slack and SMS side effects so webhook responses stay under Telnyx's timeout
- **Call recording** — set `record_channels: "dual"` on the answer action for QA
- **Real paging** — map urgent requests to PagerDuty or Opsgenie, not just Slack
- **Localization** — swap the system prompt and TTS voice per property language
- **Auth** — add API key validation on the local endpoints before exposing them beyond localhost

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://github.com/team-telnyx/telnyx-code-examples/tree/main/hotel-guest-services-python)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
