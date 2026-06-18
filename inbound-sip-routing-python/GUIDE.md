# Build a Flask application for managing inbound SIP routing with Telnyx

Application. Built with Telnyx Migration, Number Porting.

## How It Works

```
  API Request
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Number Porting
         ├──► DTMF Input
         │
         ▼
    Webhook callback
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Create SIP Connection**: `POST /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-connections/create-sip-connection)
- **List SIP Connections**: `GET /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-connections/list-sip-connections)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` — [API reference](https://developers.telnyx.com/api/sip-connections/get-sip-connection)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (166 lines). Here's what each piece does.

### Starting the Workflow

**`create_connection()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    name = data.get("name")
    sip_uri = data.get("sip_uri")
    username = data.get("username")
    password = data.get("password")
    if not name or not sip_uri:
```

### Business Logic

- **`list_connections()`** — Handles the list connections logic.
- **`get_connection()`** — Handles the get connection logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sip/connections` | List Connections |
| `GET` | `/sip/connections` | Create Connection |
| `GET` | `/sip/connections/<connection_id>` | Get Connection |

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
docker build -t inbound-sip-routing-python .
docker run --env-file .env -p 5000:5000 inbound-sip-routing-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
