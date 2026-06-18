# Migrate from Twilio to Telnyx

Migrate from Twilio — complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs.

## How It Works

```
  Twilio (source)
        │
        ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 1. Audit         │────►│ Inventory Report  │
  │    (numbers,     │     │ (numbers, configs,│
  │     configs)     │     │  webhooks, apps)  │
  └────────┬─────────┘     └───────────────────┘
           │
           ▼
  ┌──────────────────┐
  │ 2. Map Features  │ ── source capability → Telnyx equivalent
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐     ┌───────────────────┐
  │ 3. Provision     │────►│ Telnyx Platform   │
  │    on Telnyx     │     │ • Phone numbers   │
  └────────┬─────────┘     │ • SIP connections │
           │               │ • Messaging       │
           ▼               └───────────────────┘
  ┌──────────────────┐
  │ Migration Report │
  │ (success/fail    │
  │  per resource)   │
  └──────────────────┘
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **SMS/MMS** — send and receive messages with delivery receipts
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) webhook events:
- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction
- `call.hangup` -- Call ended, app cleans up session

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-twilio-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (119 lines). Here's what each piece does.

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`map_webhooks()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`audit_twilio()`** — Makes an API call and processes the response.
- **`migrate_messaging()`** — Makes an API call and processes the response.
- **`migrate_numbers()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/audit/twilio` | Audit Twilio |
| `POST` | `/migrate/messaging-profile` | Migrate Messaging |
| `POST` | `/migrate/numbers` | Migrate Numbers |
| `POST` | `/migrate/webhook-map` | Telnyx webhook handler |
| `GET` | `/migrate/code-changes` | Code Changes Guide |
| `GET` | `/migration-log` | Get Log |
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
- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/migrate/messaging-profile \
  -H "Content-Type: application/json" \
  -d '{
    "source": "twilio",
    "account_sid": "AC...",
    "auth_token": "<value>"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/audit/twilio | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t migrate-from-twilio-python .
docker run --env-file .env -p 5000:5000 migrate-from-twilio-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
