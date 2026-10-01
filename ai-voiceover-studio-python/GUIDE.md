# Build an AI Voice-Over Studio

Upload a script, select voice/style/pacing, AI adds professional direction cues (pauses, emphasis, pacing), TTS renders the voice-over, stores output in Cloud Storage. Supports multiple takes and retakes.

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
           ├──► Cloud Storage
           └──► Cloud Storage (final assets)
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Cloud Storage** — S3-compatible object storage for recordings and media, accessed via boto3 against the Telnyx S3 endpoint with presigned URLs for playback

## API Endpoints

- **AI Inference (direction)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **Cloud Storage**: S3-compatible — boto3 `put_object` against `https://{region}.telnyxcloudstorage.com`, served via presigned GET URLs -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-voiceover-studio-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (239 lines). Here's what each piece does.

### Starting the Workflow

**`create_project()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    AI adds professional direction cues, TTS renders the voice-over,
    stores output in Cloud Storage.
    data = request.get_json() or {}
    script = data.get("script", "")
    title = data.get("title", "Untitled VO")
    voice_key = data.get("voice", "warm_narrator")
    style = data.get("style", "explainer")
    takes = int(data.get("takes", 1))
```

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.
- **`upload_to_storage()`** — Uploads audio bytes to Telnyx Cloud Storage (S3-compatible) via boto3 `put_object` and returns a presigned GET URL for playback.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/projects/create` | Create Project |
| `POST` | `/projects/<project_id>/retake` | Retake |
| `GET` | `/projects/<project_id>` | Get Project |
| `GET` | `/projects` | List Projects |
| `GET` | `/voices` | List Voices |
| `GET` | `/styles` | List Styles |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to our platform. We help businesses communicate better.",
    "voice": "female",
    "language": "en-US"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/projects/<project_id> | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Prompt engineering** — tune the AI prompts for your specific domain and tone
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voiceover-studio-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
