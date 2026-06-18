# Build an ISV Notification Engine

SaaS platform sends alerts via SMS/voice/WhatsApp based on customer preference and urgency. Multi-channel with fallback cascade and delivery tracking.

## How It Works

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► TTS (Text-to-Speech)
         ├──► Messaging API
         ├──► Number Porting
         │
         ▼
    SMS to customer
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.answered` — Call connected — app begins interaction

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/isv-notification-engine-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (122 lines). Here's what each piece does.

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

- `call.answered` → greet the caller with TTS

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.
- **`notify()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.
- **`bulk_notify()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.

### Business Logic

- **`send_whatsapp()`** — Makes an API call and processes the response.
- **`make_voice_call()`** — Makes an API call and processes the response.
- **`deliver()`** — Handles the deliver logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/notify` | Notify |
| `POST` | `/notify/bulk` | Bulk Notify |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/customers` | List Customers |
| `PUT` | `/customers/<cid>/preference` | Update Preference |
| `GET` | `/notifications` | List Notifications |
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

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/notify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "message": "Urgent: action required",
    "priority": "high"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/customers | python3 -m json.tool
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
docker build -t isv-notification-engine-python .
docker run --env-file .env -p 5000:5000 isv-notification-engine-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
