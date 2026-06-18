# Build a Number Warmup & Reputation Builder

Number Warmup & Reputation Builder — gradually ramp SMS volume on new numbers to build carrier reputation and avoid spam flags.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Messaging API    │
  └────────┬─────────┘
           │
           ├──► Scheduling
           ├──► Routing
           │
           ▼
     JSON API response
```

## Telnyx Products Used

- **SMS/MMS** — send and receive messages with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

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
cd telnyx-code-examples/number-warmup-reputation-builder-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (93 lines). Here's what each piece does.

### Starting the Workflow

**`start_warmup()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    number = data.get("number")
    warmup_numbers[number] = {"started": time.time(), "day": 0, "total_sent": 0, "today_sent": 0, "status": "warming",
        "errors": 0, "last_sent": 0}
    return jsonify({"status": "started", "number": number, "schedule": WARMUP_SCHEDULE}), 200
@app.route("/warmup/send", methods=["POST"])
```

### Business Logic

- **`send_warmup()`** — Makes an API call and processes the response.
- **`warmup_status()`** — Handles the warmup status logic.
- **`reset_daily()`** — Handles the reset daily logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/warmup/start` | Start Warmup |
| `POST` | `/warmup/send` | Send Warmup |
| `GET` | `/warmup/status` | Warmup Status |
| `POST` | `/warmup/reset-daily` | Reset Daily |
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
curl -X POST http://localhost:5000/warmup/start \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+12125551234"],
    "carrier": "Current Carrier"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/warmup/status | python3 -m json.tool
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
docker build -t number-warmup-reputation-builder-python .
docker run --env-file .env -p 5000:5000 number-warmup-reputation-builder-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
