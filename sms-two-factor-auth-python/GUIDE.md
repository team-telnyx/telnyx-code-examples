# Build a Production-ready OTP 2FA system with Flask and Telnyx SMS

SMS application. Built with Telnyx Cloud Storage, Migration, Number Porting, SMS/MMS.

## How It Works

```
Inbound SMS ──► Webhook ──► Your App
                                │
                           Process Message
                                │
                           Reply SMS
```

## Telnyx Products Used

- **Cloud Storage** — S3-compatible object storage for recordings and media
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **SMS/MMS** — send and receive messages with delivery receipts
- **Verify** — phone verification with OTP delivery across channels

## API Endpoints

- **Send Message (OTP)**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

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
cd telnyx-code-examples/sms-two-factor-auth-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (201 lines). Here's what each piece does.

### Business Logic

- **`request_otp()`** — Handles the request otp logic.
- **`verify_otp_endpoint()`** — Handles the verify otp endpoint logic.
- **`otp_status()`** — Handles the otp status logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/request-otp` | Request Otp |
| `POST` | `/auth/verify-otp` | Verify Otp Endpoint |
| `GET` | `/auth/otp-status` | Otp Status |

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
curl -X POST http://localhost:5000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "channel": "sms"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/auth/otp-status | python3 -m json.tool
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
docker build -t sms-two-factor-auth-python .
docker run --env-file .env -p 5000:5000 sms-two-factor-auth-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
