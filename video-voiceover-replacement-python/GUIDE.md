# Build a Video Voice-Over Replacement

Upload audio with existing voice-over. STT extracts the script, AI rewrites/improves it (5 modes: polish, professional, simplify, energize, shorten), TTS re-records with studio quality.

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
- **Media Streaming**

## API Endpoints

- **STT Transcribe**: `POST /v2/ai/transcribe` -- [ref](https://developers.telnyx.com/api/inference/transcribe)
- **AI Inference (rewrite)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate**: `POST /v2/text-to-speech/speech` -- [ref](https://developers.telnyx.com/api-reference/text-to-speech-commands/list-available-voices)
- **Cloud Storage (S3-compatible)**: `s3.put_object(...)` via boto3 against `https://{region}.telnyxcloudstorage.com` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-voiceover-replacement-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (214 lines). Here's what each piece does.

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`transcribe()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.
- **`upload_to_storage()`** — Stores the rendered audio in Telnyx Cloud Storage. Cloud Storage is S3-compatible, so this uses the AWS SDK (boto3) pointed at `https://{region}.telnyxcloudstorage.com` (the Telnyx API key is supplied as both the access key and the secret key), calls `s3.put_object(...)`, and returns a presigned GET URL valid for 1 hour — not a `storage.telnyx.com` REST URL.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/replace` | Replace Voiceover |
| `GET` | `/replace/<job_id>` | Get Job |
| `GET` | `/replace/<job_id>/compare` | Compare Scripts |
| `GET` | `/modes` | List Modes |
| `GET` | `/jobs` | List Jobs |
| `GET` | `/health` | Health check |

The trigger endpoint kicks off the workflow:

```python
def replace_voiceover():
    """Upload audio with existing voice-over, get back improved version.

    Pipeline: STT extract → AI rewrite/improve → TTS re-record.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload audio file as 'audio'"}), 400

    mode = request.form.get("mode", "professional")
    voice = request.form.get("voice", "nova")
    language = request.form.get("language", "en")
    title = request.form.get("title", "VO Replacement")
```

The main endpoint processes the request:

```python
def replace_voiceover():
    """Upload audio with existing voice-over, get back improved version.

    Pipeline: STT extract → AI rewrite/improve → TTS re-record.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload audio file as 'audio'"}), 400

    mode = request.form.get("mode", "professional")
    voice = request.form.get("voice", "nova")
```

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
curl -X POST http://localhost:5000/replace \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to our platform. We help businesses communicate better.",
    "voice": "female",
    "language": "en-US"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/replace/<job_id> | python3 -m json.tool
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

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-voiceover-replacement-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
