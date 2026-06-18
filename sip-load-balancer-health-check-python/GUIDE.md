# Build a SIP Load Balancer Health Check

SIP Load Balancer Health Check — monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics.

## How It Works

```
API Request ──► Your App ──► Telnyx API
                   │
              Process Result
                   │
              Return Response
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **List SIP Connections**: `GET /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-connections/list-sip-connections)
- **Send Alert SMS**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-load-balancer-health-check-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (73 lines). Here's what each piece does.

### Business Logic

- **`health_check()`** — Health check endpoint for monitoring and load balancer probes.
- **`get_route()`** — Handles the get route logic.
- **`list_endpoints()`** — Handles the list endpoints logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/check` | Health Check |
| `GET` | `/route` | Get Route |
| `GET` | `/endpoints` | List Endpoints |
| `GET` | `/endpoints` | Add Endpoint |
| `GET` | `/log` | Get Log |
| `GET` | `/health` | Health check |

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
curl -X POST http://localhost:5000/check \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production SIP Trunk",
    "domain": "sip.example.com"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/route | python3 -m json.tool
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
docker build -t sip-load-balancer-health-check-python .
docker run --env-file .env -p 5000:5000 sip-load-balancer-health-check-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
