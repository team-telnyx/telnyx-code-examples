```python
"""
Call Quality Monitor - Real-time call quality monitoring dashboard.

Receives Call Control webhooks containing MOS, jitter, and latency metrics,
stores per-call state in KV, persists metrics to SQL, triggers threshold
alerts, and pushes live updates to a WebSocket dashboard.
"""

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template_string
from flask_socketio import SocketIO, emit
import telnyx

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")

# WebSocket (live dashboard updates)
socketio = SocketIO(app, cors_allowed_origins="*")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.environ.get("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.environ.get("TELNYX_PUBLIC_KEY", "")
TELNYX_APP_ID = os.environ.get("TELNYX_APP_ID", "")

# Quality thresholds
MOS_THRESHOLD = float(os.environ.get("MOS_THRESHOLD", "3.5"))
JITTER_THRESHOLD = float(os.environ.get("JITTER_THRESHOLD_MS", "30"))
LATENCY_THRESHOLD = float(os.environ.get("LATENCY_THRESHOLD_MS", "150"))

# SQLite database path (SQL primitive)
DB_PATH = os.environ.get("DB_PATH", "metrics.db")

# In-process KV store (simulates KV primitive for demo; production uses
# Telnyx KV / external KV store)
_KV_STORE = {}
_KV_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# KV primitive helpers
# ---------------------------------------------------------------------------
def kv_get(key):
    with _KV_LOCK:
        return _KV_STORE.get(key)


def kv_set(key, value):
    with _KV_LOCK:
        _KV_STORE[key] = value


def kv_delete(key):
    with _KV_LOCK:
        _KV_STORE.pop(key, None)


# ---------------------------------------------------------------------------
# SQL primitive helpers
# ---------------------------------------------------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id TEXT NOT NULL,
            mos REAL,
            jitter REAL,
            latency REAL,
            timestamp TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def insert_metric(call_id, mos, jitter, latency):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO metrics (call_id, mos, jitter, latency, timestamp) VALUES (?, ?, ?, ?, ?)",
        (call_id, mos, jitter, latency, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


def get_metrics_history(call_id=None, limit=100):
    conn = sqlite3.connect(DB_PATH)
    if call_id:
        rows = conn.execute(
            "SELECT call_id, mos, jitter, latency, timestamp FROM metrics WHERE call_id = ? ORDER BY timestamp DESC LIMIT ?",
            (call_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT call_id, mos, jitter, latency, timestamp FROM metrics ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [
        {
            "call_id": r[0],
            "mos": r[1],
            "jitter": r[2],
            "latency": r[3],
            "timestamp": r[4],
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Telnyx SDK initialization
# ---------------------------------------------------------------------------
if TELNYX_API_KEY:
    telnyx.api_key = TELNYX_API_KEY


# ---------------------------------------------------------------------------
# Webhook verification + Call Control handler
# ---------------------------------------------------------------------------
@app.route("/webhooks/call-quality", methods=["POST"])
def call_quality_webhook():
    """
    Telnyx Call Control webhook handler.

    Receives call status events containing MOS, jitter, and latency metrics.
    Verifies the Ed25519 signature, updates KV per-call state, inserts into
    SQL, checks thresholds, and pushes alerts via WebSocket.
    """
    raw_body = request.get_data(as_text=True)

    # Verify Telnyx Ed25519 signature
    try:
        client = telnyx.WebhookClient()
        event = client.unwrap(raw_body, request.headers)
    except Exception:
        app.logger.exception("Webhook signature verification failed")
        return jsonify({"error": "Invalid signature"}), 401

    payload = event.data.payload if hasattr(event, "data") and hasattr(event.data, "payload") else {}

    call_id = payload.get("call_id") or payload.get("id")
    if not call_id:
        app.logger.warning("Webhook received without call_id")
        return jsonify({"error": "Missing call_id"}), 400

    # Extract quality metrics from payload
    mos = payload.get("mos")
    jitter = payload.get("jitter")
    latency = payload.get("latency")

    # If metrics are nested under a "quality" or "metrics" key, extract them
    if mos is None:
        quality = payload.get("quality", {})
        if isinstance(quality, dict):
            mos = quality.get("mos", mos)
            jitter = quality.get("jitter", jitter)
            latency = quality.get("latency", latency)

    # Build quality state for KV
    quality_state = {
        "call_id": call_id,
        "mos": mos,
        "jitter": jitter,
        "latency": latency,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": getattr(event, "event_type", "call.status"),
    }

    # KV update per-call quality
    kv_set(f"call:{call_id}:quality", json.dumps(quality_state))

    # SQL insert metrics
    if mos is not None or jitter is not None or latency is not None:
        insert_metric(call_id, mos, jitter, latency)

    # Threshold alerting
    alerts = []
    if mos is not None and mos < MOS_THRESHOLD:
        alerts.append(f"MOS {mos} below threshold {MOS_THRESHOLD}")
    if jitter is not None and jitter > JITTER_THRESHOLD:
        alerts.append(f"Jitter {jitter}ms above threshold {JITTER_THRESHOLD}ms")
    if latency is not None and latency > LATENCY_THRESHOLD:
        alerts.append(f"Latency {latency}ms above threshold {LATENCY_THRESHOLD}ms")

    if alerts:
        alert_payload = {
            "call_id": call_id,
            "alerts": alerts,
            "mos": mos,
            "jitter": jitter,
            "latency": latency,
            "timestamp": quality_state["timestamp"],
        }
        # WebSocket push to dashboard
        socketio.emit("quality_alert", alert_payload, broadcast=True)

    # WebSocket push live update
    socketio.emit("quality_update", quality_state, broadcast=True)

    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Dashboard route
# ---------------------------------------------------------------------------
DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head><title>Call Quality Monitor</title></head>
<body>
<h1>Call Quality Monitor</h1>
<div id="alerts"></div>
<div id="updates"></div>
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<script>
const socket = io();
socket.on('quality_update', function(data) {
    const el = document.getElementById('updates');
    el.innerHTML += '<p>' + JSON.stringify(data) + '</p>';
});
socket.on('quality_alert', function(data) {
    const el = document.getElementById('alerts');
    el.innerHTML += '<p style="color:red;">ALERT: ' + JSON.stringify(data) + '</p>';
});
</script>
</body>
</html>
"""


@app.route("/")
def dashboard():
    return render_template_string(DASHBOARD_HTML)


# ---------------------------------------------------------------------------
# Historical analytics API
# ---------------------------------------------------------------------------
@app.route("/api/metrics", methods=["GET"])
def api_metrics():
    call_id = request.args.get("call_id")
    limit = int(request.args.get("limit", 100))
    history = get_metrics_history(call_id, limit)
    return jsonify(history)


@app.route("/api/quality/<call_id>", methods=["GET"])
def api_call_quality(call_id):
    state = kv_get(f"call:{call_id}:quality")
    if state is None:
        return jsonify({"error": "Call not found"}), 404
    return jsonify(json.loads(state))


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
```
