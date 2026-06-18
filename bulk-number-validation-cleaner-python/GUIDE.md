# Build a Bulk Number Validation & Cleaner

Bulk Number Validation & Cleaner — validate and clean phone number lists via Telnyx Number Lookup API.

## How It Works

```
API Request ──► Your App ──► Telnyx API
                   │
              Process Result
                   │
              Return Response
```

## Telnyx Products Used

- **Number Lookup** — phone number search, purchase, and configuration

## API Endpoints

- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup-number)
- **List Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/bulk-number-validation-cleaner-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (73 lines). Here's what each piece does.

### Business Logic

- **`validate_numbers()`** — Makes an API call and processes the response.
- **`validate_single()`** — Makes an API call and processes the response.
- **`list_jobs()`** — Handles the list jobs logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/validate` | Validate Numbers |
| `GET` | `/validate/single/<number>` | Validate Single |
| `GET` | `/jobs` | List Jobs |
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
curl -X POST http://localhost:5000/validate \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["+12125559999"],
    "message": "Special offer: 20% off this week",
    "campaign_name": "summer-promo"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/validate/single/<number> | python3 -m json.tool
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
docker build -t bulk-number-validation-cleaner-python .
docker run --env-file .env -p 5000:5000 bulk-number-validation-cleaner-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
