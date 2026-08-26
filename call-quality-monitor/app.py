import os
import json
import time
import threading
import sqlite3
from datetime import datetime, timezone
from collections import defaultdict

from flask import Flask, request, jsonify, Response
from dotenv import load_dotenv
import telnyx

load_dotenv()

app = Flask(__name__)

telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.pub_key = os.getenv("TELNYX_PUBLIC_KEY")

# In-memory KV store for per-call state
call_state = {}

# WebSocket clients for live dashboard
ws_clients = set()
ws_lock = threading.Lock()

# Thresholds
MOS_THRESHOLD = float(os.getenv("MOS_THRESHOLD", "3.5"))
JITTER_THRESHOLD = float(os.getenv("JITTER_THRESHOLD", "30"))
LATENCY_THRESHOLD = float(os.getenv("LATENCY_THRESHOLD", "150"))

DB_PATH = os.getenv("DB_PATH", "call_quality.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
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
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_call_quality_call_id
        ON call_quality_metrics (call_control_id)
        """
    )
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_call_quality_timestamp
        ON call_quality_metrics (timestamp)
        """
    )
    conn.commit()
    conn.close()


def store_metric(metric):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO call_quality_metrics
        (call_id, timestamp, mos, jitter, latency, packet_loss, source, raw, from_number, to_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            metric.get("call_id"),
            metric.get("timestamp"),
            metric.get("mos"),
            metric.get("jitter"),
            metric.get("latency"),
            metric.get("packet_loss"),
            metric.get("source"),
            json.dumps(metric.get("raw", {})),
            metric.get("from_number"),
            metric.get("to_number"),
        ),
    )
    conn.commit()
    conn.close()


def broadcast_ws(message):
    """Broadcast a message to all WebSocket subscribers."""
    payload = json.dumps(message)
    dead = []
    for client in ws_clients:
        try:
            client.put_nowait(payload)
        except Exception:
            dead.append(client)
    for client in dead:
        ws_clients.discard(client)


def check_thresholds(metric):
    """Check metric against thresholds and log alerts."""
    alerts = []
    if metric.get("mos") is not None and metric["mos"] < MOS_THRESHOLD:
        alerts.append(f"MOS {metric['mos']} below threshold {MOS_THRESHOLD}")
    if metric.get("jitter") is not None and metric["jitter"] > JITTER_THRESHOLD:
        alerts.append(f"Jitter {metric['jitter']}ms above threshold {JITTER_THRESHOLD}ms")
    if metric.get("latency") is not None and metric["latency"] > LATENCY_THRESHOLD:
        alerts.append(f"Latency {metric['latency']}ms above threshold {LATENCY_THRESHOLD}ms")
    return alerts


def process_quality_metric(payload):
    """Process a call quality metric from a webhook."""
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

    # Store in KV for per-call state
    if call_id not in call_state:
        call_state[call_id] = {"metrics": [], "alerts": []}
    call_state[call_id]["metrics"].append(metric)

    # Store in SQL
    store_metrics(metric)

    # Check thresholds
    alerts = check_thresholds(metric)
    if alerts:
        call_state[call_id]["alerts"].extend(alerts)
        for alert in alerts:
            app.logger.warning(f"Alert for call {call_id}: {alert}")

    # Broadcast to WebSocket clients
    broadcast_ws({"type": "quality_metric", "data": metric, "alerts": alerts})


@app.route("/webhooks/call-quality", methods=["POST"])
def call_quality_webhook():
    """Handle Telnyx call quality webhook."""
    try:
        event = telnyx.webhooks.unwrap(request.data, request.headers)
    except Exception as e:
        app.logger.exception("Failed to verify webhook signature")
        return jsonify({"error": "Invalid signature"}), 400

    payload = event.data.payload
    process_webhook_payload(payload)
    return jsonify({"status": "ok"}), 200


def process_webhook_payload(payload):
    """Route webhook payload to appropriate handler."""
    event_type = payload.get("event_type", "")
    if "quality" in event_type.lower() or "call.quality" in event_type:
        process_quality_metric(payload)
    elif event_type in ("call.initiated", "call.answered", "call.completed"):
        process_call_event(payload)


def process_call_event(payload):
    """Track call lifecycle events."""
    call_id = payload.get("call_leg_id") or payload.get("call_session_id")
    if not call_id:
        return
    event_type = payload.get("event_type")
    if call_id not in call_state:
        call_state[call_id] = {"metrics": [], "alerts": []}
    call_state[call_id]["event"] = event_type
    call_state[call_id]["timestamp"] = datetime.now(timezone.utc).isoformat()
    broadcast_ws({"type": "call_event", "call_id": call_id, "event": event_type})


@app.route("/api/quality/<call_id>", methods=["GET"])
def get_call_quality(call_id):
    """Get quality metrics for a specific call."""
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


@app.route("/api/quality", methods=["GET"])
def get_all_quality():
    """Get all quality metrics with optional filters."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = "SELECT * FROM call_quality_metrics WHERE 1=1"
    params = []

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

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.route("/api/quality/stats", methods=["GET"])
def get_quality_stats():
    """Get aggregate statistics for historical analytics."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        """
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
        """
    )
    stats = cursor.fetchone()
    conn.close()

    return jsonify(
        {
            "total_samples": stats[0],
            "avg_mos": stats[1],
            "min_mos": stats[2],
            "max_mos": stats[3],
            "avg_jitter": stats[4],
            "max_jitter": stats[5],
            "avg_latency": stats[6],
            "max_latency": stats[7],
            "avg_packet_loss": stats[8],
            "max_packet_loss": stats[9],
        }
    )


@app.route("/api/quality/alerts", methods=["GET"])
def get_alerts():
    """Get all alerts from call state."""
    alerts = []
    for call_id, state in call_state.items():
        for alert in state.get("alerts", []):
            alerts.append({"call_id": call_id, "alert": alert})
    return jsonify(alerts)


@app.route("/ws")
def websocket_endpoint():
    """WebSocket endpoint for live dashboard."""
    if request.environ.get("wsgi.websocket"):
        ws = request.environ["wsgi.websocket"]
        # Simple queue-based approach for demo
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


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(e):
    app.logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
