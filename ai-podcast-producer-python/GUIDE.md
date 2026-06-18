# Build an AI Podcast Producer

Record a multi-host podcast via conference call, transcribe each speaker with STT, generate show notes + chapters + social clips via AI Inference, and produce TTS intro/outro bumpers.

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
- **Gather (STT)**: `POST /v2/calls/{id}/actions/gather_using_speak` -- [ref](https://developers.telnyx.com/api/call-control/gather)
- **AI Inference**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)

## Webhook Events

Telnyx uses webhooks for call control — you don't poll for state. Each event tells you what happened, and your response tells Telnyx what to do next.

- `call.answered` -- Host joined conference
- `call.gather.ended` -- Speaker segment transcribed
- `conference.recording.saved` -- Recording URL available
- `call.hangup` -- Participant disconnected

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
cd telnyx-code-examples/ai-podcast-producer-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (326 lines). Here's what each piece does.

### Starting the Workflow

**`start_episode()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json() or {}
    title = data.get("title", f"Episode {datetime.utcnow().strftime('%Y-%m-%d')}")
    hosts = data.get("hosts", [])  # list of E.164 phone numbers
    if not hosts:
        return jsonify({"error": "Provide at least one host phone number"}), 400
    episode_id = f"ep-{uuid.uuid4().hex[:8]}"
    conf_name = f"podcast-{episode_id}"
    episodes[episode_id] = {
```

### Handling Webhooks

This is the core of the app — a state machine driven by Telnyx webhook events. Each event triggers the next step:

**`handle_voice_webhook()`** — The voice webhook handler — the core state machine. Each Telnyx event triggers the next action in the call flow.

### Helper Functions

- **`notify_slack()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.

### Business Logic

- **`telnyx_post()`** — Makes an API call and processes the response.
- **`telnyx_get()`** — Makes an API call and processes the response.
- **`inference()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/episodes/start` | Start Episode |
| `POST` | `/episodes/<episode_id>/stop` | Stop Episode |
| `POST` | `/webhooks/voice` | Telnyx webhook handler |
| `GET` | `/episodes` | List Episodes |
| `GET` | `/episodes/<episode_id>` | Get Episode |
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
curl -X POST http://localhost:5000/episodes/start \
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
curl http://localhost:5000/episodes | python3 -m json.tool
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
docker build -t ai-podcast-producer-python .
docker run --env-file .env -p 5000:5000 ai-podcast-producer-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
