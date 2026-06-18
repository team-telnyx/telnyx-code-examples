# Build a Production-ready Flask application for cloning AI Assistants via Telnyx

Application. Built with Telnyx AI Assistants, Migration, Number Porting.

## How It Works

```
API Request ──► Your App ──► Telnyx API
                   │
              Process Result
                   │
              Return Response
```

## Telnyx Products Used

- **AI Assistants** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Retrieve AI Assistant**: `GET /v2/ai/assistants/{id}` — [API reference](https://developers.telnyx.com/api/ai-assistants/get-assistant)
- **Create AI Assistant**: `POST /v2/ai/assistants` — [API reference](https://developers.telnyx.com/api/ai-assistants/create-assistant)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (131 lines). Here's what each piece does.

### Business Logic

- **`get_assistant()`** — Handles the get assistant logic.
- **`clone_assistant_endpoint()`** — Handles the clone assistant endpoint logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/assistants/<assistant_id>` | Get Assistant |
| `POST` | `/assistants/<assistant_id>/clone` | Clone Assistant Endpoint |

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
curl -X POST http://localhost:5000/assistants/<assistant_id>/clone \
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
docker build -t clone-ai-assistant-python .
docker run --env-file .env -p 5000:5000 clone-ai-assistant-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
