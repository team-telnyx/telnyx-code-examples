# Build a Porting LOA Automation

Porting LOA Automation — automate Letter of Authorization generation and porting order submission.

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

- **Migration**
- **Missions**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Create Porting Order**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)
- **List Porting Orders**: `GET /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/list-porting-orders)
- **Upload LOA**: `POST /v2/porting_orders/{id}/loa` — [API reference](https://developers.telnyx.com/api/porting/upload-loa)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/porting-loa-automation-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (103 lines). Here's what each piece does.

### Business Logic

- **`generate_loa()`** — Handles the generate loa logic.
- **`submit_and_port()`** — Makes an API call and processes the response.
- **`check_portability()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/loa/generate` | Generate Loa |
| `POST` | `/loa/submit-and-port` | Submit And Port |
| `POST` | `/loa/check-portability` | Check Portability |
| `GET` | `/loa` | List Loas |
| `GET` | `/pipeline` | Pipeline Status |
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
curl -X POST http://localhost:5000/loa/generate \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+12125551234"],
    "carrier": "Current Carrier"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/loa | python3 -m json.tool
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
docker build -t porting-loa-automation-python .
docker run --env-file .env -p 5000:5000 porting-loa-automation-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
