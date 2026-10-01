# Build a Podcast Highlight Clipper

Upload audio, STT + AI Inference identifies viral moments with virality scoring, TTS generates teaser intros for each clip, SMS distributes highlights to subscriber list.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ AI Inference      │ ── direction cues, rewrites
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ TTS Generation    │ ── render audio
  │ (multiple takes/  │
  │  voices/languages)│
  └────────┬─────────┘
           │
           ├──► SMS notification
           ├──► Slack alert
           └──► Download / stream
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **SMS/MMS** — send and receive messages with delivery receipts
- **Media Streaming**

## API Endpoints

- **STT Transcribe**: `POST /v2/ai/audio/transcriptions` -- [ref](https://developers.telnyx.com/api-reference/speech-to-text-commands/transcribe-audio)
- **AI Inference (highlights)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (teasers)**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [Slack incoming webhook](https://api.slack.com/messaging/webhooks) (optional)
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/podcast-highlight-clipper-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (209 lines). Here's what each piece does.

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.
- **`notify_slack()`** — Sends notifications through configured channels (SMS, Slack, email) based on event severity.

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`transcribe()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/clip` | Clip Highlights |
| `GET` | `/clip/<job_id>` | Get Job |
| `POST` | `/distribution` | Add To Distribution |
| `GET` | `/jobs` | List Jobs |
| `GET` | `/health` | Health check |

The trigger endpoint kicks off the workflow:

```python
def clip_highlights():
    """Upload audio and extract highlight clips.

    Pipeline: STT → AI finds viral moments → TTS teaser intros → SMS distribution.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload audio as 'audio'"}), 400

    title = request.form.get("title", "Recording")
    max_clips = int(request.form.get("max_clips", "5"))
    distribute = request.form.get("distribute", "false").lower() == "true"

```

Helper function that handles the core action:

```python
def send_sms(to, text):
    try:
        requests.post(f"{API}/messages", headers=HEADERS, json={
            "from": MAIN_NUMBER, "to": to, "text": text,
            "messaging_profile_id": MESSAGING_PROFILE_ID
        }, timeout=10)
        return True
    except Exception:
        return False

def notify_slack(msg):
    if SLACK_WEBHOOK:
        try:
```

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
curl -X POST http://localhost:5000/clip \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to our platform. We help businesses communicate better.",
    "voice": "female",
    "language": "en-US"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/clip/<job_id> | python3 -m json.tool
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

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/podcast-highlight-clipper-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
