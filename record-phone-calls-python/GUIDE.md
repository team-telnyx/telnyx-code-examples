# Build a Production-ready Flask application for call recording via Telnyx Voice API

Voice application. Built with Telnyx Migration, Number Porting, Voice.

## How It Works

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Call Recording
         ├──► Number Porting
         │
         ▼
    JSON API response

  State: Database
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.answered` — Call connected — app begins interaction
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
- `call.recording.saved` — Call recording saved — URL available for download/processing

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
cd telnyx-code-examples/record-phone-calls-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (257 lines). Here's what each piece does.

### Starting the Workflow

**`initiate_call_endpoint()`** — Handles the initiate call endpoint logic.

```python
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    to_number = data.get("to")
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    try:
        result = initiate_call_with_recording(to_number)
```

**`start_recording_endpoint()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    try:
        result = start_recording(call_control_id)
        return jsonify(result), 200
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_call_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`stop_recording_endpoint()`** — Handles the stop recording endpoint logic.
- **`hangup_endpoint()`** — Handles the hangup endpoint logic.
- **`get_call_status()`** — Handles the get call status logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/calls/initiate` | Initiate Call Endpoint |
| `POST` | `/calls/<call_control_id>/recording/start` | Start Recording Endpoint |
| `POST` | `/calls/<call_control_id>/recording/stop` | Stop Recording Endpoint |
| `POST` | `/calls/<call_control_id>/hangup` | Hangup Endpoint |
| `POST` | `/webhooks/call-events` | Telnyx webhook handler |
| `GET` | `/calls/<call_control_id>/status` | Get Call Status |

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
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/calls/<call_control_id>/status | python3 -m json.tool
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
docker build -t record-phone-calls-python .
docker run --env-file .env -p 5000:5000 record-phone-calls-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
