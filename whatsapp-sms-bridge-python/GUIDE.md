# Build a WhatsApp-SMS Bridge

WhatsApp-SMS Bridge — receive messages on WhatsApp and forward them via SMS, and vice versa. Bidirectional bridge between two messaging channels.

## How It Works

```
Inbound SMS ──► Webhook ──► Your App
                                │
                           Process Message
                                │
                           Reply SMS
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
cd telnyx-code-examples/whatsapp-sms-bridge-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (80 lines). Here's what each piece does.

### Starting the Workflow

**`create_bridge()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    sms_user = data.get("sms_number")
    whatsapp_user = data.get("whatsapp_number")
    bridges[sms_user] = {"whatsapp": whatsapp_user, "direction": "sms_to_whatsapp"}
    bridges[whatsapp_user] = {"sms": sms_user, "direction": "whatsapp_to_sms"}
    return jsonify({"status": "bridged", "sms": sms_user, "whatsapp": whatsapp_user}), 200
@app.route("/webhooks/messaging", methods=["POST"])
```

### Helper Functions

- **`send_sms()`** — Sends an SMS via the Telnyx Messaging API. Wraps the `POST /v2/messages` call with error handling.

### Business Logic

- **`send_whatsapp()`** — Makes an API call and processes the response.
- **`handle_message()`** — Handles the handle message logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/bridge` | Create Bridge |
| `POST` | `/webhooks/messaging` | Telnyx webhook handler |
| `GET` | `/bridges` | List Bridges |
| `GET` | `/messages` | List Messages |
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
curl -X POST http://localhost:5000/bridge \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/bridges | python3 -m json.tool
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
docker build -t whatsapp-sms-bridge-python .
docker run --env-file .env -p 5000:5000 whatsapp-sms-bridge-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
