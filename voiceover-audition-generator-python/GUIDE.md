# Build a Voice-Over Audition Generator

Submit a script, hear it read by every available TTS voice. AI scores and ranks best-fit voices based on content, tone, and audience. SMS delivers top picks to decision-makers.

## How It Works

```
  Input (script/text)
        │
        ▼
  ┌─────────────────┐
  │  AI Inference    │ ── process / direct / rewrite
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  TTS Generation  │ ── render audio (multiple takes/voices)
  └────────┬────────┘
           │
           ▼
     SMS to customer
     Cloud Storage upload
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **SMS/MMS** — send and receive messages with delivery receipts
- **Cloud Storage** — S3-compatible object storage for recordings and media

## API Endpoints

- **TTS Generate (all voices)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **AI Inference (voice scoring)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **Send SMS**: `POST /v2/messages` -- [ref](https://developers.telnyx.com/api/messaging/send-message)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voiceover-audition-generator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (196 lines). Here's what each piece does.

### Starting the Workflow

**`create_audition()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    Generates audio for all voices, AI ranks best fit based on script content,
    optionally SMS top picks to decision-makers.
    data = request.get_json() or {}
    script = data.get("script", "")
    project = data.get("project", "Untitled")
    context = data.get("context", "")  # e.g., "luxury car commercial", "kids app tutorial"
    notify_phones = data.get("notify", [])
    if not script:
```

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.
- **`upload_to_storage()`** — Handles the upload to storage logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auditions/create` | Create Audition |
| `GET` | `/auditions/<audition_id>` | Get Audition |
| `GET` | `/auditions` | List Auditions |
| `GET` | `/voices` | List Voices |
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

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/auditions/create \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to our platform. We help businesses communicate better.",
    "voice": "female",
    "language": "en-US"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/auditions/<audition_id> | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Prompt engineering** — tune the AI prompts for your specific domain and tone
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t voiceover-audition-generator-python .
docker run --env-file .env -p 5000:5000 voiceover-audition-generator-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
