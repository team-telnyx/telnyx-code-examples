# Build a Messaging Campaign A/B Test Optimizer

Messaging Campaign A/B Test Optimizer — test SMS copy variants, AI picks winners, auto-scales.

## How It Works

```
  Inbound SMS
        │
        ▼
  ┌──────────────────┐
  │  Parse Message    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │  AI Inference     │
  │  • Routing         │
  │  • Campaign logic  │
  └────────┬─────────┘
           │
           ├──► SMS to customer
```

## Telnyx Products Used

- **SMS/MMS** — send and receive messages with delivery receipts
- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Webhook Events

Telnyx delivers inbound messages and status updates via webhooks to your server.

This app handles these webhook events ([Messaging docs](https://developers.telnyx.com/docs/api/v2/messaging)):
- `message.received` — Inbound SMS/MMS received

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/messaging-campaign-ab-test-optimizer-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (76 lines). Here's what each piece does.

### Starting the Workflow

**`create_campaign()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    cid = f"CAMP-{int(time.time())}"
    campaigns[cid] = {"name": data.get("name", ""), "variants": [{"text": v, "sent": 0, "replies": 0, "conversions": 0} for v in data.get("variants", [])],
        "contacts": data.get("contacts", []), "status": "created"}
    return jsonify({"campaign_id": cid}), 200
@app.route("/campaigns/<cid>/send", methods=["POST"])
```

### Helper Functions

- **`call_inference()`** — Sends conversation context to Telnyx AI Inference and returns the model's response. Uses the OpenAI-compatible chat completions endpoint.
- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`send_campaign()`** — Handles the send campaign logic.
- **`analyze_campaign()`** — Sends conversation context to Telnyx AI Inference and returns the model's response. Uses the OpenAI-compatible chat completions endpoint.
- **`handle_reply()`** — Handles the handle reply logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/campaigns` | Create Campaign |
| `POST` | `/campaigns/<cid>/send` | Send Campaign |
| `GET` | `/campaigns/<cid>/analyze` | Analyze Campaign |
| `POST` | `/webhooks/messaging` | Telnyx webhook handler |
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

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["+12125559999"],
    "message": "Special offer: 20% off this week",
    "campaign_name": "summer-promo"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/campaigns/<cid>/analyze | python3 -m json.tool
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
docker build -t messaging-campaign-ab-test-optimizer-python .
docker run --env-file .env -p 5000:5000 messaging-campaign-ab-test-optimizer-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
