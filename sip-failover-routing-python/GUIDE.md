# Build a Production-ready SIP failover routing system with Flask and Telnyx

Voice application. Built with Telnyx Migration, Number Porting.

## How It Works

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ▼
     Webhook callback
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **List Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Webhook Events

Your app receives webhook events from Telnyx as things happen.

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) webhook events:
- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction
- `call.hangup` -- Call ended, app cleans up session

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (297 lines). Here's what each piece does.

### Starting the Workflow

**`create_connection()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    name = data.get("name")
    if not name:
        return jsonify({"error": "Missing required field: 'name'"}), 400
    try:
        connection = create_sip_connection(name, None, None)
```

### Business Logic

- **`list_connections()`** — Handles the list connections logic.
- **`get_connection()`** — Handles the get connection logic.
- **`check_health()`** — Health check endpoint for monitoring and load balancer probes.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sip/connections` | List Connections |
| `GET` | `/sip/connections` | Create Connection |
| `GET` | `/sip/connections/<connection_id>` | Get Connection |
| `GET` | `/sip/health` | Health check |
| `GET` | `/sip/failover-status` | Failover Status |
| `POST` | `/webhooks/call` | Telnyx webhook handler |
| `POST` | `/sip/assign-number` | Assign Number |

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
curl -X POST http://localhost:5000/sip/assign-number \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production SIP Trunk",
    "domain": "sip.example.com"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/sip/connections | python3 -m json.tool
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
docker build -t sip-failover-routing-python .
docker run --env-file .env -p 5000:5000 sip-failover-routing-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
