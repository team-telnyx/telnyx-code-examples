# Migrate from Vapi to Telnyx

Migrate from Vapi — import Vapi voice agents to Telnyx AI Assistants with voice, prompt, and tool configuration mapping.

## How It Works

```
  ElevenLabs (source)
        │
        ▼
  ┌─────────────┐
  │ Audit       │ ── inventory numbers, configs, profiles
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Map & Plan  │ ── match source features to Telnyx equivalents
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     ┌─────────────────┐
  │ Provision   │────►│ Telnyx Platform  │
  │ on Telnyx   │     │ (numbers, SIP,   │
  └──────┬──────┘     │  messaging)      │
         │            └─────────────────┘
         ▼
  Migration Report
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Create AI Assistant**: `POST /v2/ai/assistants` — [API reference](https://developers.telnyx.com/api/ai-assistants/create-assistant)
- **Chat Completions**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-vapi-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (87 lines). Here's what each piece does.

### Business Logic

- **`audit_vapi()`** — Makes an API call and processes the response.
- **`migrate_agent()`** — Makes an API call and processes the response.
- **`voice_mapping()`** — Handles the voice mapping logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/audit/vapi` | Audit Vapi |
| `POST` | `/migrate/agent` | Migrate Agent |
| `GET` | `/mapping/voices` | Voice Mapping |
| `GET` | `/mapping/models` | Model Mapping |
| `GET` | `/migration-log` | Get Log |
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

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/migrate/agent \
  -H "Content-Type: application/json" \
  -d '{
    "source": "twilio",
    "account_sid": "AC...",
    "auth_token": "..."
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/audit/vapi | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t migrate-from-vapi-python .
docker run --env-file .env -p 5000:5000 migrate-from-vapi-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
