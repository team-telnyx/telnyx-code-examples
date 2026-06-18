# Build a Missions Workflow Orchestrator

Missions Workflow Orchestrator — create and manage multi-step mission workflows using the Telnyx Missions API.

## How It Works

```
Trigger Event
      │
      ├──► Voice Call ──► TTS ──► DTMF Input ──► Action
      │
      └──► SMS Fallback ──► Customer Reply ──► Action
```

## Telnyx Products Used

- **Migration**
- **Missions**
- **Number Porting** — phone number search, purchase, and configuration
- **SMS/MMS** — send and receive messages with delivery receipts
- **Verify** — phone verification with OTP delivery across channels
- **Voice** — programmatic call control with webhooks for every call state change

## API Endpoints

- **Create Number Order**: `POST /v2/number_orders` — [API reference](https://developers.telnyx.com/api/numbers/create-number-order)
- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)
- **Create Porting Order**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/missions-workflow-orchestrator-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (89 lines). Here's what each piece does.

### Starting the Workflow

**`create_mission()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/missions", headers=headers,
            json={"name": data.get("name"), "description": data.get("description"),
                "status": data.get("status", "draft"),
                "tasks": data.get("tasks", [])}, timeout=15)
        result = resp.json()
        local_missions.append(result)
```

### Business Logic

- **`list_missions()`** — Makes an API call and processes the response.
- **`get_mission()`** — Makes an API call and processes the response.
- **`add_task()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/missions` | Create Mission |
| `POST` | `/missions` | List Missions |
| `GET` | `/missions/<mission_id>` | Get Mission |
| `POST` | `/missions/<mission_id>/tasks` | Add Task |
| `POST` | `/missions/<mission_id>/run` | Run Mission |
| `GET` | `/missions/<mission_id>/runs` | List Runs |
| `GET` | `/templates` | Mission Templates |
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
- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/missions \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/missions/<mission_id> | python3 -m json.tool
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
docker build -t missions-workflow-orchestrator-python .
docker run --env-file .env -p 5000:5000 missions-workflow-orchestrator-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
