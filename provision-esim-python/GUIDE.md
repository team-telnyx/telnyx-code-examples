# Build a Production-ready Flask application for eSIM provisioning via Telnyx

Application. Built with Telnyx IoT/SIM, Migration, Number Porting.

## How It Works

```
  ┌──────────────┐
  │ IoT Device Event │
  │ (SIM/sensor)  │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ Process      │ ── threshold check
  └──────┬───────┘
         │
         ▼
    JSON API response

  State: Database
```

## Telnyx Products Used

- **IoT/SIM** — cellular connectivity and device management
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Create SIM Card (eSIM)**: `POST /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/create-sim-card)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` — [API reference](https://developers.telnyx.com/api/sim-cards/get-sim-card)
- **List SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

## Webhook Events

Your app receives webhook events from Telnyx as things happen.

This app handles these webhook events:
- `sim_card.status.changed` -- SIM card status changed (active, suspended, deactivated)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (221 lines). Here's what each piece does.

### Starting the Workflow

**`create_app()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    app = Flask(__name__)
    app.config["JSON_SORT_KEYS"] = False
    # Initialize Telnyx client with the new SDK pattern
    app.telnyx_client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
    return app
app = create_app()
# ============================================================================
# eSIM Provisioning Models
```

### Handling Webhooks

Webhook handlers process events from Telnyx:

**`handle_sim_status_webhook()`** — Handles Telnyx webhook events. Routes each event type to the appropriate handler.

### Business Logic

- **`provision_esim()`** — Handles the provision esim logic.
- **`activate_esim()`** — Handles the activate esim logic.
- **`get_esim()`** — Handles the get esim logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/esim/profiles` | Provision Esim |
| `POST` | `/esim/profiles/<sim_card_id>/activate` | Activate Esim |
| `GET` | `/esim/profiles/<sim_card_id>` | Get Esim |
| `POST` | `/esim/profiles` | List Esims |
| `POST` | `/esim/webhooks/sim-status` | Telnyx webhook handler |
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
curl -X POST http://localhost:5000/esim/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "DEV-001",
    "event": "threshold_exceeded",
    "value": 95.2
  }'
```

**Check results:**

```bash
curl http://localhost:5000/esim/profiles/<sim_card_id> | python3 -m json.tool
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
docker build -t provision-esim-python .
docker run --env-file .env -p 5000:5000 provision-esim-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
