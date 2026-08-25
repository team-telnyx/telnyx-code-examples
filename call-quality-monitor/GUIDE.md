# Call Quality Monitor — Developer Guide

This guide walks through the `call-quality-monitor` example, a Flask application that ingests Telnyx call quality webhooks, stores metrics for historical analysis, tracks per-call state, and provides a live dashboard via WebSocket. By the end, you'll understand how each component works and how to extend it for your own real-time call monitoring needs.

## Prerequisites

Before running this example, you'll need:

- **Python 3.9+** installed on your machine
- **A Telnyx account** with a Messaging or Voice API key
- **A Telnyx phone number** (or a test connection) that generates call quality events
- **A webhook endpoint** configured in your Telnyx Portal (or use a tool like `ngrok` for local development)

## Environment Setup

1. **Clone the repository** and navigate to the sample:

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/call-quality-monitor
   ```

2. **Create your environment file** from the template:

   ```bash
   cp .env.example .env
   ```

3. **Edit `.env`** and fill in your credentials:

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
   ```

   The remaining variables are optional and have sensible defaults:

   | Variable | Default | Description |
   |----------|---------|-------------|
   | `MOS_THRESHOLD` | `3.5` | Minimum Mean Opinion Score before alerting |
   | `JITTER_THRESHOLD` | `30` | Maximum jitter (ms) before alerting |
   | `LATENCY_THRESHOLD` | `150` | Maximum latency (ms) before alerting |
   | `DB_PATH` | `call_quality.db` | SQLite database file location |
   | `PORT` | `5000` | Port for the Flask server |

4. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

5. **Run the app**:

   ```bash
   python app.py
   ```

   You should see output like:

   ```
   * Running on http://0.0.0.0:5000
   ```

6. **Expose your local server** (for webhook delivery):

   ```bash
   ngrok http 5000
   ```

   Copy the `https://` URL from ngrok and use it as your webhook endpoint in the Telnyx Portal (e.g., `https://your-ngrok-url.ngrok.io/webhooks/call-quality`).

---

## How It Works

This example is built around three core data layers:

1. **In-memory KV store** — Tracks per-call state (metrics, alerts, lifecycle events) for real-time access.
2. **SQLite database** — Persists every quality metric for historical analytics and querying.
3. **WebSocket broadcast** — Pushes live updates to connected dashboard clients.

Let's walk through each piece of the code.

---

## Step 1: Configuration and Initialization

The app starts by loading environment variables and configuring the Telnyx SDK:

```python
load_dotenv()
app = Flask(__name__)
telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.pub_key = os.getenv("TELNYX_PUBLIC_KEY")
```

- `TELNYX_API_KEY` authenticates outbound API calls (though this sample doesn't make any — it's included for completeness).
- `TELNYX_PUBLIC_KEY` is used to verify inbound webhook signatures.

The app also reads threshold values from the environment. These are used later in the alerting logic:

```python
MOS_THRESHOLD = float(os.getenv("MOS_THRESHOLD", "3.5"))
JITTER_THRESHOLD = float(os.getenv("JITTER_THRESHOLD", "30"))
LATENCY_THRESHOLD = float(os.getenv("LATENCY_THRESHOLD", "150"))
```

### Telnyx Primitives Used

- **Webhooks** — Telnyx sends real-time events (call quality metrics, call lifecycle) to your endpoint via HTTP POST.
- **Ed25519 Signature Verification** — The `telnyx.webhooks.unwrap` method verifies that incoming requests genuinely come from Telnyx, preventing spoofing.

---

## Step 2: Database Initialization

The `init_db()` function creates the SQLite schema if it doesn't exist:

```python
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_quality_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_control_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            mos REAL,
            jitter REAL,
            latency REAL,
            packet_loss REAL,
            codec TEXT,
            direction TEXT,
            from_number TEXT,
            to_number TEXT
        )
    """)
```

It also creates indexes on `call_control_id` and `timestamp` to speed up queries — important since this table will grow quickly in production.

**Why SQLite?** For a demo or single-instance deployment, SQLite gives you a zero-config relational store. In production, you'd swap this for PostgreSQL or another managed database.

---

## Step 3: Webhook Ingestion

The main entry point for incoming data is the `/webhooks/call-quality` route:

```python
@app.route("/webhooks/call-quality", methods=["POST"])
def call_quality_webhook():
    try:
        event = telnyx.webhooks.unwrap(request.data, request.headers)
    except Exception as e:
        app.logger.exception("Failed to verify webhook signature")
        return jsonify({"error": "Invalid signature"}), 400

    payload = event.data.payload
    process_webhook_payload(payload)
    return jsonify({"status": "ok"}), 200
```

**Key points:**

1. **Signature verification** — `telnyx.webhooks.unwrap` validates the Ed25519 signature using your public key. If verification fails, we return a `400` and log the error. Never skip this step in production.
2. **Payload extraction** — The verified event contains `data.payload`, which holds the actual event data.
3. **Routing** — The payload is passed to `process_webhook_payload`, which decides whether it's a quality metric or a call lifecycle event.

### Telnyx Webhook Event Types

Telnyx sends many event types. This sample handles two categories:

- **Quality metrics** — Events containing MOS, jitter, latency, packet loss, etc.
- **Call lifecycle** — `call.initiated`, `call.answered`, `call.completed` — used to track call state.

The routing logic:

```python
def process_webhook_payload(payload):
    event_type = payload.get("event_type", "")
    if "quality" in event_type.lower() or "call.quality" in event_type:
        process_quality_metric(payload)
    elif event_type in ("call.initiated", "call.answered", "call.completed"):
        process_call_event(payload)
```

---

## Step 4: Processing Quality Metrics

The `process_quality_metric` function is the heart of the sample. It:

1. **Extracts the call ID** from the payload (either `call_leg_id` or `call_session_id`).
2. **Normalizes the metric** into a consistent shape.
3. **Stores it in the KV store** for per-call state.
4. **Persists it to SQLite** for historical analytics.
5. **Checks thresholds** and logs alerts.
6. **Broadcasts** the metric to WebSocket clients.

```python
def process_quality_metric(payload):
    call_id = payload.get("call_leg_id") or payload.get("call_session_id")
    if not call_id:
        app.logger.warning("No call ID in quality payload")
        return

    metric = {
        "call_id": call_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mos": payload.get("mos"),
        "jitter": payload.get("jitter"),
        "latency": payload.get("latency"),
        "packet_loss": payload.get("packet_loss"),
        "source": payload.get("source", "unknown"),
        "raw": payload,
        "from_number": payload.get("from"),
        "to_number": payload.get("to"),
    }
```

### Per-Call State Tracking (KV Store)

The `call_state` dictionary acts as an in-memory key-value store:

```python
if call_id not in call_state:
    call_state[call_id] = {"metrics": [], "alerts": []}
call_state[call_id]["metrics"].append(metric)
```

This gives you O(1) access to all metrics and alerts for a specific call — useful for a live dashboard that needs to show "what's happening right now" without hitting the database.

### Historical Analytics (SQL)

The same metric is written to SQLite:

```python
def store_metric(metric):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO call_quality_metrics
        (call_id, timestamp, mos, jitter, latency, packet_loss, source, raw, from_number, to_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (...))
    conn.commit()
    conn.close()
```

This gives you the ability to run aggregate queries (averages, min/max, trends) over any time range.

### Threshold Alerting

The `check_thresholds` function compares each metric against your configured thresholds:

```python
def check_thresholds(metric):
    alerts = []
    if metric.get("mos") is not None and metric["mos"] < MOS_THRESHOLD:
        alerts.append(f"MOS {metric['mos']} below threshold {MOS_THRESHOLD}")
    if metric.get("jitter") is not None and metric["jitter"] > JITTER_THRESHOLD:
        alerts.append(f"Jitter {metric['jitter']}ms above threshold {JITTER_THRESHOLD}ms")
    if metric.get("latency") is not None and metric["latency"] > LATENCY_THRESHOLD:
        alerts.append(f"Latency {metric['latency']}ms above threshold {LATENCY_THRESHOLD}ms")
    return alerts
```

Alerts are:
- Logged via `app.logger.warning`
- Stored in the per-call KV state
- Included in the WebSocket broadcast so dashboards can surface them immediately

---

## Step 5: Call Lifecycle Tracking

The `process_call_event` function tracks when calls start, get answered, and end:

```python
def process_call_event(payload):
    call_id = payload.get("call_leg_id") or payload.get("call_session_id")
    if not call_id:
        return
    event_type = payload.get("event_type")
    if call_id not in call_state:
        call_state[call_id] = {"metrics": [], "alerts": []}
    call_state[call_id]["event"] = event_type
    call_state[call_id]["timestamp"] = datetime.now(timezone.utc).isoformat()
    broadcast_ws({"type": "call_event", "call_id": call_id, "event": event_type})
```

This is useful for:
- Knowing whether a call is still active when a quality metric arrives.
- Building a "live calls" view on your dashboard.
- Correlating quality issues with call lifecycle (e.g., "did quality degrade right before the call dropped?").

---

## Step 6: Historical Analytics API

The sample exposes three REST endpoints for querying stored metrics:

### `GET /api/quality/<call_id>`

Returns all metrics for a specific call, ordered by timestamp:

```python
@app.route("/api/quality/<call_id>", methods=["GET"])
def get_call_quality(call_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM call_quality_metrics WHERE call_id = ? ORDER BY timestamp",
        (call_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])
```

### `GET /api/quality`

Returns all metrics with optional filters (`call_id`, `start`, `end`, `limit`):

```python
call_id = request.args.get("call_id")
if call_id:
    query += " AND call_id = ?"
    params.append(call_id)

start = request.args.get("start")
if start:
    query += " AND timestamp >= ?"
    params.append(start)

end = request.args.get("end")
if end:
    query += " AND timestamp <= ?"
    params.append(end)

query += " ORDER BY timestamp DESC LIMIT ?"
params.append(int(request.args.get("limit", "100")))
```

### `GET /api/quality/stats`

Returns aggregate statistics across all stored metrics:

```python
cursor.execute("""
    SELECT
        COUNT(*) as total_samples,
        AVG(mos) as avg_mos,
        MIN(mos) as min_mos,
        MAX(mos) as max_mos,
        AVG(jitter) as avg_jitter,
        MAX(jitter) as max_jitter,
        AVG(latency) as avg_latency,
        MAX(latency) as max_latency,
        AVG(packet_loss) as avg_packet_loss,
        MAX(packet_loss) as max_packet_loss
    FROM call_quality_metrics
""")
```

This is your "health of the network" view — average MOS, worst jitter, etc.

### `GET /api/quality/alerts`

Returns all alerts from the in-memory KV store:

```python
@app.route("/api/quality/alerts", methods=["GET"])
def get_alerts():
    alerts = []
    for call_id, state in call_state.items():
        for alert in state.get("alerts", []):
            alerts.append({"call_id": call_id, "alert": alert})
    return jsonify(alerts)
```

---

## Step 7: Live WebSocket Dashboard

The `/ws` endpoint provides a WebSocket connection for real-time updates:

```python
@app.route("/ws")
def websocket_endpoint():
    if request.environ.get("wsgi.websocket"):
        ws = request.environ["wsgi.websocket"]
        from queue import Queue

        client_queue = Queue()
        ws_clients.add(client_queue)
        try:
            while True:
                message = client_queue.get()
                ws.send(message)
        except Exception:
            ws_clients.discard(client_queue)
        return ""
    return jsonify({"error": "WebSocket connection required"}), 400
```

**How it works:**

- Each connected client gets a `Queue` object added to the `ws_clients` set.
- The `broadcast_ws` function puts messages onto every client's queue:

  ```python
  def broadcast_ws(message):
      payload = json.dumps(message)
      dead = []
      for client in ws_clients:
          try:
              client.put_nowait(payload)
          except Exception:
              dead.append(client)
      for client in dead:
          ws_clients.discard(client)
  ```

- The WebSocket handler blocks on `client_queue.get()`, waiting for new messages, then sends them to the browser.

**Note:** This implementation uses a simple queue-based approach. For production, consider using a proper WebSocket library like `Flask-Sock` or `websockets` with an async server (e.g., `uvicorn` + `fastapi`).

---

## Step 8: Health Check and Error Handling

The app includes a `/health` endpoint for load balancers and monitoring:

```python
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})
```

And global error handlers that return generic messages (never leaking internals):

```python
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    app.logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500
```

---

## Putting It All Together

Here's the data flow when everything is running:

1. **Telnyx sends a webhook** → `POST /webhooks/call-quality`
2. **Signature verified** → `telnyx.webhooks.unwrap`
3. **Payload routed** → quality metric or call event
4. **Metric processed**:
   - Stored in KV (`call_state`)
   - Persisted to SQLite
   - Checked against thresholds
   - Broadcast to WebSocket clients
5. **Dashboard queries**:
   - `GET /api/quality/<call_id>` — per-call detail
   - `GET /api/quality/stats` — aggregate health
   - `GET /api/quality/alerts` — active alerts
   - WebSocket `/ws` — live updates

---

## Next Steps

Now that you understand how the sample works, here are some ways to extend it:

- **Add a frontend dashboard** — Build a simple HTML/JS page that connects to `/ws` and renders live metrics using Chart.js or D3.
- **Persist alerts** — Currently alerts live only in memory. Add an `alerts` table to SQLite so you can query historical alerts.
- **Add call control actions** — Use the Telnyx API to automatically hang up or reroute calls that fall below quality thresholds.
- **Scale the database** — Swap SQLite for PostgreSQL or TimescaleDB for time-series analytics.
- **Add authentication** — Protect the API endpoints with API keys or OAuth.

### Related Documentation

- [Telnyx Call Quality Webhooks](https://developers.telnyx.com/docs/voice/call-quality)
- [Telnyx Webhook Security](https://developers.telnyx.com/docs/voice/webhooks)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Flask WebSocket Support](https://flask-sock.readthedocs.io/)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook returns `400 Invalid signature` | Ensure `TELNYX_PUBLIC_KEY` is set correctly in `.env` |
| No metrics appearing | Check your Telnyx dashboard webhook configuration — make sure the URL is correct and events are enabled |
| WebSocket not connecting | Ensure you're using a WebSocket-capable client (e.g., browser `WebSocket` API) and the server supports `wsgi.websocket` |
| Database locked errors | SQLite can only handle one writer at a time. For production, switch to PostgreSQL |

---

Happy building! If you have questions, reach out to the Telnyx team or check the [developer docs](https://developers.telnyx.com).
