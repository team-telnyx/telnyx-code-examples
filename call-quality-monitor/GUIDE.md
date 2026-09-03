# Call Quality Monitor — Developer Guide

A step-by-step walkthrough of the **Call Quality Monitor** sample. This guide explains how the Flask application receives Telnyx Call Control webhooks, tracks per-call quality state in KV, persists metrics to SQL, triggers threshold alerts, and pushes live updates to a WebSocket dashboard.

---

## Prerequisites

Before you begin, ensure you have:

- **Python 3.9+** installed locally
- A **Telnyx account** with an API key (sign up at [telnyx.com](https://telnyx.com))
- A **Telnyx phone number** and **Call Control Application** configured in the Telnyx Portal
- **ngrok** (or similar tunneling tool) for receiving webhooks locally — install via `npm install -g ngrok` or download from [ngrok.com](https://ngrok.com)
- Basic familiarity with Flask, SQLite, and WebSockets

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-quality-monitor
```

### 2. Create and activate a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and set the following:

| Variable | Description | Default |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key | *(required)* |
| `TELNYX_PUBLIC_KEY` | Your Telnyx public key (for webhook verification) | *(required)* |
| `TELNYX_APP_ID` | Your Telnyx Call Control Application ID | *(optional)* |
| `FLASK_SECRET_KEY` | Secret key for Flask session signing | `dev-secret-key` |
| `MOS_THRESHOLD` | MOS score below which an alert is triggered | `3.5` |
| `JITTER_THRESHOLD_MS` | Jitter (ms) above which an alert is triggered | `30` |
| `LATENCY_THRESHOLD_MS` | Latency (ms) above which an alert is triggered | `150` |
| `DB_PATH` | Path to the SQLite database file | `metrics.db` |
| `PORT` | Port the Flask app listens on | `5000` |

> **Security note:** Never commit your `.env` file. It is listed in `.gitignore`.

---

## Running the Application

### Start the server

```bash
python app.py
```

The app will:
1. Initialize the SQLite database (`init_db()`)
2. Start the Flask + Flask-SocketIO server on `0.0.0.0:5000`

### Expose your local server to the internet

Telnyx needs to send webhooks to a publicly reachable URL. Use ngrok:

```bash
ngrok http 5000
```

Copy the `https://*.ngrok.io` URL — you'll use it to configure your Telnyx webhook endpoint.

### Configure the Telnyx webhook URL

In the [Telnyx Portal](https://portal.telnyx.com), navigate to your Call Control Application and set the **Webhook URL** to:

```
https://<your-ngrok-subdomain>.ngrok.io/webhooks/call-quality
```

Also set the **Webhook Secret** (used for Ed25519 signature verification). This value should match `TELNYX_PUBLIC_KEY` in your `.env` file.

---

## How It Works — Code Walkthrough

The application is structured into several logical sections. Let's walk through each.

### 1. Imports and Flask App Initialization

The app imports Flask, Flask-SocketIO, the Telnyx SDK, and standard library modules. It loads environment variables via `dotenv` and initializes:

- A Flask app with a secret key
- A `SocketIO` instance for WebSocket communication (with CORS allowed from all origins for demo purposes)
- The Telnyx SDK with the API key

### 2. Configuration

Environment variables are read for:
- Telnyx credentials (`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_APP_ID`)
- Quality thresholds (`MOS_THRESHOLD`, `JITTER_THRESHOLD_MS`, `LATENCY_THRESHOLD_MS`)
- Database path (`DB_PATH`)
- Server port (`PORT`)

### 3. KV Primitive (In-Memory Store)

The app uses an in-process dictionary (`_KV_STORE`) protected by a threading lock to simulate the Telnyx KV primitive. Three helper functions provide the KV interface:

- `kv_get(key)` — retrieves a value by key
- `kv_set(key, value)` — stores a value
- `kv_delete(key)` — removes a key

> **Production note:** In a real deployment, replace `_KV_STORE` with the Telnyx KV store or an external KV provider (e.g., Redis). The interface remains the same.

### 4. SQL Primitive (SQLite)

The app uses SQLite as the SQL primitive for historical analytics. Key functions:

- `init_db()` — creates the `metrics` table if it doesn't exist, with columns: `call_id`, `mos`, `jitter`, `latency`, `timestamp`
- `insert_metric(call_id, mos, jitter, latency)` — inserts a new metric row
- `get_metrics_history(call_id=None, limit=100)` — retrieves recent metrics, optionally filtered by `call_id`

> **Production note:** For production, use a managed PostgreSQL or MySQL database. The SQL interface remains the same.

### 5. Webhook Handler — `/webhooks/call-quality`

This is the core endpoint. When Telnyx sends a Call Control webhook:

#### a. Signature Verification

The raw request body and headers are passed to `telnyx.WebhookClient().unwrap()`, which verifies the Ed25519 signature. If verification fails, a `401 Unauthorized` is returned.

#### b. Payload Extraction

The event payload is extracted from `event.data.payload`. The handler looks for:
- `call_id` — identifies the call
- `mos`, `jitter`, `latency` — quality metrics (may be top-level or nested under a `quality` key)

#### c. KV Update (Per-Call State)

A `quality_state` dictionary is built and stored in KV under the key `call:${call_id}:quality`. This allows quick lookup of the latest quality state for any call.

#### d. SQL Insert (Historical Metrics)

If any of `mos`, `jitter`, or `latency` are present, a row is inserted into the `metrics` table for historical analytics.

#### e. Threshold Alerting

Each metric is compared against its threshold:
- **MOS** below `MOS_THRESHOLD` → alert
- **Jitter** above `JITTER_THRESHOLD_MS` → alert
- **Latency** above `LATENCY_THRESHOLD_MS` → alert

If any alerts are triggered, a `quality_alert` event is emitted via WebSocket to all connected dashboard clients.

#### f. WebSocket Push (Live Update)

Regardless of alerts, a `quality_update` event is emitted via WebSocket with the full quality state. This keeps the dashboard live and in sync.

### 6. Dashboard Route — `/`

Serves a simple HTML page with embedded JavaScript that:
- Connects to the Socket.IO server
- Listens for `quality_update` events and appends them to the updates section
- Listens for `quality_alert` events and appends them (in red) to the alerts section

### 7. Historical Analytics API — `/api/metrics`

A GET endpoint that returns historical metrics from the SQL database. Supports optional query parameters:
- `call_id` — filter by specific call
- `limit` — maximum number of records (default 100)

### 8. Per-Call Quality API — `/api/quality/<call_id>`

A GET endpoint that retrieves the latest per-call quality state from KV. Returns `404` if the call is not found.

### 9. Health Check — `/health`

A simple endpoint returning `{"status": "ok"}` for load balancer health checks.

---

## Demo Mode vs Live Mode

### Demo Mode (Default)

By default, the application runs in **demo mode**:

- The KV store is an in-process dictionary (no external KV dependency)
- The SQL database is a local SQLite file (`metrics.db`)
- No real Telnyx API calls are made — the app only receives and processes webhooks
- The WebSocket dashboard is accessible at `http://localhost:5000/`

This mode is safe for local development and testing. No charges are incurred.

### Live Mode

To run in **live mode** (production-like):

1. Set `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` to real Telnyx credentials
2. Replace the in-memory KV store with the Telnyx KV store or Redis
3. Replace SQLite with a managed PostgreSQL/MySQL database
4. Deploy behind HTTPS (required for WebSocket Secure)
5. Configure the Telnyx webhook URL to point to your production endpoint

> **Important:** In live mode, ensure your webhook endpoint is publicly accessible and uses HTTPS. Telnyx will reject non-HTTPS webhook URLs in production.

---

## Testing the Application

### 1. Start the server

```bash
python app.py
```

### 2. Open the dashboard

Navigate to `http://localhost:5000/` in your browser. You should see the "Call Quality Monitor" dashboard.

### 3. Simulate a webhook

Use `curl` or a tool like Postman to send a test webhook:

```bash
curl -X POST http://localhost:5000/webhooks/call-quality \
  -H "Content-Type: application/json" \
  -H "X-Telnyx-Signature: <valid_signature>" \
  -d '{
    "data": {
      "payload": {
        "call_id": "test-call-123",
        "mos": 2.8,
        "jitter": 45,
        "latency": 200
      }
    },
    "event_type": "call.status"
  }'
```

> **Note:** In demo mode, signature verification may fail since the signature is not valid. To test without signature verification, temporarily comment out the `unwrap` call or use a tool like [webhook.site](https://webhook.site) to capture and replay real Telnyx webhooks.

### 4. Run the smoke test

```bash
python smoke_test.py
```

This verifies that the application module loads without errors.

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────┐
│  Telnyx     │     │  Flask App           │     │  SQLite  │
│  Call Ctrl  │────▶│  /webhooks/          │────▶│  metrics │
│  Webhook    │     │  call-quality        │     │  table   │
└─────────────┘     └──────────┬───────────┘     └──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  KV Store           │
                    │  call:{id}:quality  │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  WebSocket          │
                    │  (Socket.IO)        │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Dashboard          │
                    │  (Browser)          │
                    └─────────────────────┘
```

**Data flow:**

1. Telnyx sends a Call Control webhook to `/webhooks/call-quality`
2. The app verifies the Ed25519 signature
3. Quality metrics are extracted from the payload
4. Per-call state is updated in KV (`call:{id}:quality`)
5. Metrics are persisted to SQL (`metrics` table)
6. Thresholds are checked — alerts are emitted via WebSocket if exceeded
7. A live update is pushed to all connected dashboard clients via WebSocket

---

## Next Steps

- **Telnyx Call Control API**: [docs.telnyx.com](https://docs.telnyx.com) — Learn about call status webhooks, call recording, and advanced call flows
- **Telnyx KV Store**: [docs.telnyx.com/kv](https://docs.telnyx.com/kv) — Replace the in-memory KV with the real Telnyx KV primitive
- **Telnyx Webhook Signing**: [docs.telnyx.com/webhooks](https://docs.telnyx.com/webhooks) — Understand Ed25519 signature verification
- **Telnyx Edge SDK**: [docs.telnyx.com/edge](https://docs.telnyx.com/edge) — For deploying serverless functions that process webhooks
- **Flask-SocketIO Documentation**: [flask-socketio.readthedocs.io](https://flask-socketio.readthedocs.io) — Advanced WebSocket patterns
- **SQLite Documentation**: [sqlite.org/docs](https://www.sqlite.org/docs.html) — For local development; consider PostgreSQL for production

### Related Examples

- `call-recording` — Record calls and store audio files
- `ivr-menu` — Build an interactive voice response system
- `sms-chatbot` — Build an SMS chatbot with conversation state
- `voice-broadcast` — Send voice messages to multiple recipients

### Resources

- [Telnyx Developer Portal](https://developers.telnyx.com)
- [Telnyx Community Slack](https://join.slack.com/t/telnyx-community/shared_invite)
- [Telnyx Status Page](https://status.telnyx.com)
- [Telnyx Blog](https://telnyx.com/blog)
