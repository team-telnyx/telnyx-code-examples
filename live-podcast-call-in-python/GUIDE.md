# Build a Live Podcast Call-In Show

Hosts on a conference call, listeners call in. AI screens callers via STT, queues approved ones, generates real-time fact-checks for the host, TTS announces topics.

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
- **Conferencing**
- **Media Streaming**

## API Endpoints

- **Create Call**: `POST /v2/calls` -- [ref](https://developers.telnyx.com/api/call-control/create-call)
- **Answer**: `POST /v2/calls/{id}/actions/answer` -- [ref](https://developers.telnyx.com/api/call-control/answer-call)
- **Gather (screen)**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [ref](https://developers.telnyx.com/api/call-control/gather)
- **Speak (TTS)**: `POST /v2/calls/{id}/actions/speak` -- [ref](https://developers.telnyx.com/api/call-control/speak)
- **Join Conference**: `POST /v2/calls/{id}/actions/join_conference` -- [ref](https://developers.telnyx.com/api/call-control/join-conference)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

- `call.initiated` -- New inbound caller
- `call.answered` -- Caller connected, begin screening
- `call.gather.ended` -- Caller stated topic, AI evaluates
- `call.hangup` -- Caller disconnected

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
cd telnyx-code-examples/live-podcast-call-in-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (314 lines). Here's what each piece does.

### Starting the Workflow

**`start_show()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json() or {}
    hosts = data.get("hosts", [])
    topic = data.get("topic", SHOW_TOPIC)
    if not hosts:
        return jsonify({"error": "Provide at least one host number"}), 400
    show_id = f"show-{uuid.uuid4().hex[:8]}"
    conf_name = f"live-{show_id}"
    shows[show_id] = {
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

### Helper Functions

- **`notify_slack()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.

### Business Logic

- **`telnyx_post()`** — Makes an API call and processes the response.
- **`inference()`** — Makes an API call and processes the response.
- **`admit_next_caller()`** — Handles the admit next caller logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/shows/start` | Start Show |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `POST` | `/shows/<show_id>/next-caller` | Admit Next Caller |
| `POST` | `/shows/<show_id>/fact-check` | Fact Check |
| `GET` | `/shows/<show_id>/queue` | View Queue |
| `GET` | `/shows` | List Shows |
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
curl -X POST http://localhost:5000/shows/start \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to our platform. We help businesses communicate better.",
    "voice": "female",
    "language": "en-US"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/shows/<show_id>/queue | python3 -m json.tool
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
docker build -t live-podcast-call-in-python .
docker run --env-file .env -p 5000:5000 live-podcast-call-in-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
