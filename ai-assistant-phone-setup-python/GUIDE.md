# Build an AI Assistant Phone Setup

AI Assistant Phone Setup — create and configure a managed Telnyx AI Assistant and wire it to a phone number.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference (LLM)
           ├──► Telnyx Number Porting
           │
           ▼
     Webhook callback
```

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-assistant-phone-setup-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (95 lines). Here's what each piece does.

### Starting the Workflow

**`create_assistant()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/ai/assistants", headers=headers,
            json={"name": data.get("name", "My Assistant"),
                "instructions": data.get("instructions", "You are a helpful assistant. Be friendly and concise."),
                "model": data.get("model", "meta-llama/Llama-3.3-70B-Instruct"),
                "voice": {"provider": data.get("voice_provider", "telnyx"),
                    "settings": {"voice_id": data.get("voice_id", "en-US-Neural2-F"),
```

### Business Logic

- **`list_assistants()`** — Makes an API call and processes the response.
- **`get_assistant()`** — Makes an API call and processes the response.
- **`update_assistant()`** — Handles the update assistant logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/assistants` | Create Assistant |
| `POST` | `/assistants` | List Assistants |
| `GET` | `/assistants/<assistant_id>` | Get Assistant |
| `GET` | `/assistants/<assistant_id>` | Update Assistant |
| `POST` | `/assistants/<assistant_id>/wire` | Wire To Number |
| `POST` | `/assistants/<assistant_id>/test` | Test Assistant |
| `GET` | `/models` | List Models |
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
curl -X POST http://localhost:5000/assistants \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/assistants/<assistant_id> | python3 -m json.tool
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
docker build -t ai-assistant-phone-setup-python .
docker run --env-file .env -p 5000:5000 ai-assistant-phone-setup-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
