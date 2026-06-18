# Build a SMS Poll Voting System — text-to-vote polling with real-time results

SMS application. Built with Telnyx Migration, Number Porting, SMS/MMS.

## How It Works

```
  Inbound SMS
        │
        ▼
  ┌──────────────────┐
  │  Messaging API    │
  └────────┬─────────┘
           │
           ├──► Routing
           │
           ▼
     SMS to customer
     Email notification
```

## Telnyx Products Used

- **SMS/MMS** — send and receive messages with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

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
cd telnyx-code-examples/sms-poll-voting-system-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (75 lines). Here's what each piece does.

### Starting the Workflow

**`create_poll()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    pid = f"POLL-{int(time.time())}"
    options = data.get("options", [])
    polls[pid] = {"question": data.get("question"), "options": {str(i+1): {"text": opt, "votes": 0} for i, opt in enumerate(options)}, "voters": set(), "status": "active"}
    return jsonify({"poll_id": pid, "instructions": f"Text {', '.join(str(i+1) for i in range(len(options)))} to {POLL_NUMBER}"}), 200
@app.route("/polls/<pid>/broadcast", methods=["POST"])
```

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`broadcast_poll()`** — Handles the broadcast poll logic.
- **`handle_vote()`** — Handles the handle vote logic.
- **`results()`** — Handles the results logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/polls` | Create Poll |
| `POST` | `/polls/<pid>/broadcast` | Broadcast Poll |
| `POST` | `/webhooks/messaging` | Telnyx webhook handler |
| `GET` | `/polls/<pid>/results` | Results |
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
curl -X POST http://localhost:5000/polls \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/polls/<pid>/results | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t sms-poll-voting-system-python .
docker run --env-file .env -p 5000:5000 sms-poll-voting-system-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
