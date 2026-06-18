# Build a Billing Anomaly Detector

Billing Anomaly Detector — monitor usage and billing for anomalies, alert on cost spikes and unusual patterns.

## How It Works

```
Trigger Event
      │
      ├──► Voice Call ──► TTS ──► DTMF Input ──► Action
      │
      └──► SMS Fallback ──► Customer Reply ──► Action
```

## Telnyx Products Used

- **CDR**
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **SMS/MMS** — send and receive messages with delivery receipts

## API Endpoints

- **List CDRs**: `GET /v2/reports/cdrs` — [API reference](https://developers.telnyx.com/api/call-detail-records/list-cdrs)
- **List MDRs**: `GET /v2/reports/mdrs` — [API reference](https://developers.telnyx.com/api/messaging-detail-records/get-messaging-detail-records)

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
cd telnyx-code-examples/billing-anomaly-detector-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (79 lines). Here's what each piece does.

### Business Logic

- **`set_baselines()`** — Handles the set baselines logic.
- **`run_anomaly_check()`** — Makes an API call and processes the response.
- **`check_balance()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/config` | Set Baselines |
| `POST` | `/config` | Get Baselines |
| `POST` | `/check` | Run Anomaly Check |
| `GET` | `/balance` | Check Balance |
| `GET` | `/alerts` | List Alerts |
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
curl -X POST http://localhost:5000/config \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/balance | python3 -m json.tool
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
docker build -t billing-anomaly-detector-python .
docker run --env-file .env -p 5000:5000 billing-anomaly-detector-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
