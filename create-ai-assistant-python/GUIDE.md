# Create a Telnyx AI Assistant

Create a new Telnyx AI Assistant with a system prompt, model selection, and tool configuration.

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

## API Endpoints

- **Create AI Assistant**: `POST /v2/ai/assistants` -- [API reference](https://developers.telnyx.com/api/ai/create-assistant)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (84 lines). Here's what each piece does.

### Starting the Workflow

**`create_assistant_endpoint()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    name = data.get("name")
    instructions = data.get("instructions")
    model = data.get("model", "meta-llama/Meta-Llama-3.1-70B-Instruct")
    enabled_features = data.get("enabled_features", ["messaging"])
    if not name or not instructions:
```

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/ai/assistants` | Create Assistant Endpoint |

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
curl -X POST http://localhost:5000/ai/assistants \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
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
docker build -t create-ai-assistant-python .
docker run --env-file .env -p 5000:5000 create-ai-assistant-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
