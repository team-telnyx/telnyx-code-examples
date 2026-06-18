# List and Manage AI Assistants

List all Telnyx AI Assistants in your account with filtering and pagination.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ▼
     JSON API response
```

## Telnyx Products Used

- **AI Assistants** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **List AI Assistants**: `GET /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api/ai/list-assistants)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (53 lines). Here's what each piece does.

### Business Logic

- **`list_assistants()`** — Handles the list assistants logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/assistants` | List Assistants |

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

**Check results:**

```bash
curl http://localhost:5000/assistants | python3 -m json.tool
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
docker build -t list-ai-assistants-python .
docker run --env-file .env -p 5000:5000 list-ai-assistants-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
