# Build an AI Sales Coach (Whisper)

AI coach listens to a live sales call and whispers real-time suggestions to the rep only. Customer never hears the AI. Generates post-call scorecard.

## How It Works

```
  Participants (N)
    │   │   │
    ▼   ▼   ▼
  ┌───────────────────────┐
  │  Telnyx Conference     │
  │  Bridge                │
  └───────────┬────────────┘
              │
              ▼
  ┌───────────────────────┐
  │  AI Inference          │
  │  (Escalation)  │
  └───────────┬────────────┘
              │
              ├──► Slack notification
              ├──► Email notification
              ├──► Webhook callback
              ▼
         Session Log

  State: In-memory state
```

## Telnyx Products Used

- **Voice** — programmatic call control with webhooks for every call state change
- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Conferencing**
- **Media Streaming**

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `call.answered` — Call connected — app begins interaction
- `call.gather.ended` — Caller input received (speech transcription or DTMF digits)
- `call.hangup` — Call ended — app cleans up session, triggers post-call processing
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
cd telnyx-code-examples/ai-sales-coach-whisper-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (238 lines). Here's what each piece does.

### Starting the Workflow

**`start_coaching()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json() or {}
    customer_phone = data.get("customer")
    rep_phone = data.get("rep")
    context = data.get("context", "")
    conf_name = f"coach-{int(time.time())}"
    session = {
        "conference": conf_name,
        "customer_phone": customer_phone,
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

- `call.answered` → greet the caller with TTS
- `call.speak.ended` → start gathering input
- `call.gather.ended` → process the caller's response
- `call.hangup` → clean up and log

### Helper Functions

- **`call_inference()`** — Sends conversation context to Telnyx AI Inference and returns the model's response. Uses the OpenAI-compatible chat completions endpoint.

### Business Logic

- **`telnyx_post()`** — Makes an API call and processes the response.
- **`list_sessions()`** — Handles the list sessions logic.
- **`get_session()`** — Handles the get session logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sessions/start` | Start Coaching |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `POST` | `/webhooks/media` | Telnyx webhook handler |
| `GET` | `/sessions` | List Sessions |
| `GET` | `/sessions/<name>` | Get Session |
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
curl -X POST http://localhost:5000/sessions/start \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "name": "Acme Corp",
    "source": "website",
    "interest": "enterprise plan"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/sessions | python3 -m json.tool
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
docker build -t ai-sales-coach-whisper-python .
docker run --env-file .env -p 5000:5000 ai-sales-coach-whisper-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
