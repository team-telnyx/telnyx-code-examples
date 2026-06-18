# Build a Porting Order Tracker Dashboard



## How It Works

```
API Request ──► Your App ──► Telnyx API
                   │
              Process Result
                   │
              Return Response
```

## API Endpoints

- **List Porting Orders**: `GET /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/list-porting-orders)
- **Retrieve Porting Order**: `GET /v2/porting_orders/{id}` — [API reference](https://developers.telnyx.com/api/porting/get-porting-order)

## Webhook Events

Your app receives webhook events from Telnyx as things happen.

This app handles these webhook events:
- `porting_order.status_changed` -- Porting order status updated (FOC date set, completed, rejected)
- `number_order.complete` -- Phone number order completed and ready to use

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/porting-order-tracker-dashboard-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (120 lines). Here's what each piece does.

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`check_sla_breach()`** — Handles the check sla breach logic.
- **`submit_order()`** — Makes an API call and processes the response.
- **`bulk_submit()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/porting/orders` | Submit Order |
| `POST` | `/porting/bulk` | Bulk Submit |
| `POST` | `/porting/orders` | List Orders |
| `POST` | `/webhooks/porting` | Telnyx webhook handler |
| `GET` | `/porting/sla-check` | Sla Check |
| `GET` | `/porting/dashboard` | Dashboard |
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
curl -X POST http://localhost:5000/porting/orders \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "order_id": "ORD-12345",
    "items": ["Widget Pro"],
    "total": 99.99
  }'
```

**Check results:**

```bash
curl http://localhost:5000/porting/sla-check | python3 -m json.tool
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
docker build -t porting-order-tracker-dashboard-python .
docker run --env-file .env -p 5000:5000 porting-order-tracker-dashboard-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
