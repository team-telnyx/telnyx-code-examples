# Build a WireGuard Private Voice Network

WireGuard Private Voice Network — create WireGuard mesh network for private SIP trunking with encrypted voice traffic.

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
           ├──► Telnyx Global IP / WireGuard
           │
           ▼
     JSON API response
```

## Telnyx Products Used

- **Migration**
- **Networking**
- **Number Porting** — phone number search, purchase, and configuration

## API Endpoints

- **Create WireGuard Interface**: `POST /v2/wireguard_interfaces` — [API reference](https://developers.telnyx.com/api/networking/create-wireguard-interface)
- **List WireGuard Interfaces**: `GET /v2/wireguard_interfaces` — [API reference](https://developers.telnyx.com/api/networking/list-wireguard-interfaces)
- **Create Call**: `POST /v2/calls` — [API reference](https://developers.telnyx.com/api/call-control/create-call)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/wireguard-private-voice-network-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (95 lines). Here's what each piece does.

### Starting the Workflow

**`create_network()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/networks", headers=headers,
            json={"name": data.get("name", f"voice-net-{int(time.time())}")}, timeout=15)
        result = resp.json()
        net_id = result.get("data", {}).get("id")
        if net_id:
            networks[net_id] = result.get("data", {})
```

**`create_interface()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/wireguard_interfaces", headers=headers,
            json={"network_id": data.get("network_id"),
                "region_code": data.get("region", "ashburn-va")}, timeout=15)
        result = resp.json()
        iface = result.get("data", {})
        if iface.get("id"):
```

### Business Logic

- **`list_networks()`** — Makes an API call and processes the response.
- **`get_config()`** — Makes an API call and processes the response.
- **`topology()`** — Handles the topology logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/networks` | Create Network |
| `POST` | `/networks` | List Networks |
| `POST` | `/interfaces` | Create Interface |
| `POST` | `/peers` | Create Peer |
| `GET` | `/interfaces/<iface_id>/config` | Get Config |
| `GET` | `/topology` | Topology |
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
curl -X POST http://localhost:5000/networks \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/interfaces/<iface_id>/config | python3 -m json.tool
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
docker build -t wireguard-private-voice-network-python .
docker run --env-file .env -p 5000:5000 wireguard-private-voice-network-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
