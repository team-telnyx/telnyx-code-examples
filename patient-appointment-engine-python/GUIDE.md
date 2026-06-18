# Build a Patient Appointment Engine

AI answers calls, checks availability, books appointments, collects copay via Stripe, sends SMS confirmation. Staff reviews next-day schedule.

## How It Works

```
Inbound/Outbound Call
        │
        ▼
  Call Answered ──► TTS Greeting
        │
        ▼
  Gather Input ──► AI Inference
  (speech/DTMF)    (process + decide)
        │
        ▼
  Take Action ──► SMS Notification
  (speak/transfer)
        │
        ▼
  Call Ends ──► Log & Notify
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change
- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Gather (STT/DTMF)**: `POST /v2/calls/{id}/actions/gather_using_speak` — [API reference](https://developers.telnyx.com/api/call-control/gather)
- **Call Control: Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` — [API reference](https://developers.telnyx.com/api/call-control/speak)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.initiated` — New inbound or outbound call detected
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [Slack incoming webhook](https://api.slack.com/messaging/webhooks) (optional)
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/patient-appointment-engine-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (156 lines). Here's what each piece does.

### Starting the Workflow

**`create_copay()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        link = stripe.PaymentLink.create(
            line_items=[{"price_data": {"currency": "usd", "product_data": {"name": f"Copay - {data.get('provider', 'Visit')}"},
                "unit_amount": data.get("amount_cents", 2500)}, "quantity": 1}])
        send_sms(data["phone"], f"Valley Health Clinic: Please pay your ${data.get('amount_cents', 2500)/100:.2f} copay before your visit: {link.url}")
        return jsonify({"payment_link": link.url}), 200
    except Exception as e:
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

- `call.initiated` → call setup in progress
- `call.answered` → greet the caller with TTS
- `call.speak.ended` → start gathering input
- `call.gather.ended` → process the caller's response

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.
- **`notify_staff()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.

### Business Logic

- **`ai_respond()`** — Sends conversation context to Telnyx AI Inference and returns the model's response. Uses the OpenAI-compatible chat completions endpoint.
- **`list_appointments()`** — Handles the list appointments logic.
- **`approve_appointment()`** — Handles the approve appointment logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/appointments` | List Appointments |
| `POST` | `/appointments/<int:idx>/approve` | Approve Appointment |
| `POST` | `/appointments/<int:idx>/reject` | Reject Appointment |
| `POST` | `/copay/create` | Create Copay |
| `GET` | `/slots` | Get Slots |
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
curl -X POST http://localhost:5000/appointments/<int:idx>/approve \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "name": "Jane Smith",
    "date": "2026-07-15",
    "time": "14:00",
    "service": "Consultation"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/appointments | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Prompt engineering** — tune the AI prompts for your specific domain and tone
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t patient-appointment-engine-python .
docker run --env-file .env -p 5000:5000 patient-appointment-engine-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
