# Build a Multi-Channel Appointment Confirmation

Multi-Channel Appointment Confirmation — confirm appointments via SMS, voice call, and WhatsApp. Tries SMS first, escalates to voice if no response.

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
    Voice response (TTS)
```

## Telnyx Products Used

- **SMS/MMS** — send and receive messages with delivery receipts
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)) ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):
- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.speak.ended` — TTS playback finished — app transitions to next action (gather, transfer, etc.)
- `message.received` — Inbound SMS/MMS received

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
cd telnyx-code-examples/multi-channel-appointment-confirmation-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (123 lines). Here's what each piece does.

### Starting the Workflow

**`create_appointment()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    aid = f"APT-{int(time.time())}"
    appointments[aid] = {"id": aid, "patient": data.get("name"), "phone": data.get("phone"), "date": data.get("date"),
        "time": data.get("time"), "provider": data.get("provider", "Dr. Smith"), "status": "pending", "channel_attempts": []}
    return jsonify({"appointment_id": aid}), 200
@app.route("/confirm/<aid>", methods=["POST"])
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_sms_reply()`** — Processes inbound SMS messages. Parses the customer's reply and routes to the appropriate business logic.

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`make_confirmation_call()`** — Makes an API call and processes the response.
- **`send_confirmation()`** — Handles the send confirmation logic.
- **`escalate_to_voice()`** — Handles the escalate to voice logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/appointments` | Create Appointment |
| `POST` | `/confirm/<aid>` | Send Confirmation |
| `POST` | `/escalate/<aid>` | Escalate To Voice |
| `POST` | `/webhooks/messaging` | Telnyx webhook handler |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/appointments/status` | Appointment Status |
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
curl -X POST http://localhost:5000/appointments \
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

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/appointments/status | python3 -m json.tool
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
docker build -t multi-channel-appointment-confirmation-python .
docker run --env-file .env -p 5000:5000 multi-channel-appointment-confirmation-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
