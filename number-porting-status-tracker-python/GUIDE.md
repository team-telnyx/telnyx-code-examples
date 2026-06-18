# Build a Number Porting Status Tracker

Number Porting Status Tracker — track porting orders with status webhooks and SMS alerts.

## How It Works

```
  Source Platform
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

- **SMS/MMS** — send and receive messages with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Porting Orders**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)

## Webhook Events

Telnyx delivers inbound messages and status updates via webhooks to your server.

This app handles these webhook events:
- `porting_order.status_changed` -- Porting order status updated (FOC date set, completed, rejected)
- `number_order.complete` -- Phone number order completed and ready to use

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
cd telnyx-code-examples/number-porting-status-tracker-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (66 lines). Here's what each piece does.

### Starting the Workflow

**`create_port()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post("https://api.telnyx.com/v2/porting_orders", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=data, timeout=15)
        if resp.ok:
            order = resp.json().get("data", {})
            port_orders[order.get("id")] = {"status": "submitted", "numbers": data.get("phone_numbers", []), "updates": []}
            return jsonify(order), 200
```

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_porting_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`list_ports()`** — Makes an API call and processes the response.
- **`get_port()`** — Handles the get port logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ports/list` | List Ports |
| `POST` | `/ports/create` | Create Port |
| `POST` | `/webhooks/porting` | Telnyx webhook handler |
| `GET` | `/ports/<order_id>` | Get Port |
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
curl -X POST http://localhost:5000/ports/create \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+12125551234"],
    "carrier": "Current Carrier"
  }'
```

Or text your Telnyx number to trigger the SMS workflow.

**Check results:**

```bash
curl http://localhost:5000/ports/list | python3 -m json.tool
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
docker build -t number-porting-status-tracker-python .
docker run --env-file .env -p 5000:5000 number-porting-status-tracker-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Telnyx Portal](https://portal.telnyx.com)
