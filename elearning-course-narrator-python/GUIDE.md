# Build an E-Learning Course Narrator

Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest.

## How It Works

```
Inbound SMS
      │
      ▼
Parse Message ──► AI Inference
                  (understand intent)
      │
      ▼
Take Action ──► Reply SMS
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Cloud Storage** — S3-compatible object storage for recordings and media

## API Endpoints

- **AI Inference (course structure)**: `POST /v2/ai/chat/completions` -- [ref](https://developers.telnyx.com/api/inference/chat-completions)
- **TTS Generate (narration)**: `POST /v2/ai/generate` -- [ref](https://developers.telnyx.com/api/inference/generate)
- **Cloud Storage**: `PUT https://storage.telnyx.com/{bucket}/{key}` -- [docs](https://developers.telnyx.com/docs/cloud-storage)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/elearning-course-narrator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (208 lines). Here's what each piece does.

### Starting the Workflow

**`create_course()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    AI structures content into modules, adds quiz prompts and pacing,
    TTS narrates each module, stores audio + manifest in Cloud Storage.
    data = request.get_json() or {}
    title = data.get("title", "Untitled Course")
    content = data.get("content", "")
    voice = data.get("voice", DEFAULT_VOICE)
    include_quizzes = data.get("include_quizzes", True)
    if not content:
```

### Business Logic

- **`inference()`** — Makes an API call and processes the response.
- **`tts_generate()`** — Makes an API call and processes the response.
- **`upload_to_storage()`** — Handles the upload to storage logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/courses/create` | Create Course |
| `GET` | `/courses/<course_id>` | Get Course |
| `GET` | `/courses` | List Courses |
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
curl -X POST http://localhost:5000/courses/create \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/courses/<course_id> | python3 -m json.tool
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
docker build -t elearning-course-narrator-python .
docker run --env-file .env -p 5000:5000 elearning-course-narrator-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
