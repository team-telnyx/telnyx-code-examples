# Build a Smart Number Geo-Assignment

Smart Number Geo-Assignment — automatically purchase and assign local numbers based on caller geography to maximize answer rates.

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
     JSON API response

  State: Redis cache
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Numbers** — phone number search, purchase, and configuration

## API Endpoints

- **Search Available Numbers**: `GET /v2/available_phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **Create Number Order**: `POST /v2/number_orders` — [API reference](https://developers.telnyx.com/api/numbers/create-number-order)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/smart-number-geo-assignment-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (78 lines). Here's what each piece does.

### Business Logic

- **`search_local_number()`** — Makes an API call and processes the response.
- **`purchase_number()`** — Makes an API call and processes the response.
- **`assign_number()`** — Handles the assign number logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/assign` | Assign Number |
| `POST` | `/lookup-and-assign` | Lookup And Assign |
| `GET` | `/inventory` | Inventory |
| `GET` | `/assignments` | List Assignments |
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
curl -X POST http://localhost:5000/assign \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+12125551234"],
    "carrier": "Current Carrier"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/inventory | python3 -m json.tool
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
docker build -t smart-number-geo-assignment-python .
docker run --env-file .env -p 5000:5000 smart-number-geo-assignment-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
