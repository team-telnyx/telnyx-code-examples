# Build an AI-Powered IVR Replacement

AI-Powered IVR Replacement — natural language routing with A/B testing and structured insights.

## How It Works

```
  Inbound Phone Call
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Call Transfer
         ├──► Call Recording
         ├──► Number Porting
         │
         ▼
    Email notification
```

## Telnyx Products Used

- **AI Assistants** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` — [API reference](https://developers.telnyx.com/api/call-control/answer-call)

## Webhook Events

Your app receives webhook events from Telnyx as things happen.

This app handles these webhook events ([Call Control docs](https://developers.telnyx.com/docs/api/v2/call-control)):
- `ai.assistant.insights` — AI Assistant generated insights from conversation
- `call.initiated` — New inbound or outbound call detected

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-powered-ivr-replacement-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (163 lines). Here's what each piece does.

### Starting the Workflow

**`create_assistant_with_ab_test()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    This demonstrates the version testing capability:
    - Version A: Formal, professional tone
    - Version B: Casual, friendly tone
    - Traffic split 50/50 for testing
    Call this once during setup — the assistant handles routing automatically.
    # Create the base assistant
    assistant_config = {
        "name": "AI IVR Agent",
```

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_assistant_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`setup_assistant()`** — Handles the setup assistant logic.
- **`get_analytics()`** — Handles the get analytics logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/assistant` | Telnyx webhook handler |
| `POST` | `/setup` | Setup Assistant |
| `GET` | `/analytics` | Get Analytics |
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
curl -X POST http://localhost:5000/setup \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/analytics | python3 -m json.tool
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
docker build -t ai-powered-ivr-replacement-python .
docker run --env-file .env -p 5000:5000 ai-powered-ivr-replacement-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
