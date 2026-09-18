"""
Call Quality Monitor — real-time call quality monitoring dashboard.

Receives Telnyx Call Control webhooks containing MOS, jitter, latency and
packet-loss metrics, stores per-call state in an in-memory KV store, persists
every metric to SQLite for historical analytics, evaluates configurable
threshold alerts, and pushes live updates to a browser dashboard via
Server-Sent Events (SSE).

Run with real Telnyx credentials:
    python app.py

Run the demo (no credentials needed):
    python demo/demo_server.py
"""

import json
import os
import queue
import sqlite3
import threading
from datetime import datetime, timezone

import telnyx
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template_string, request

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Telnyx SDK v4 — constructed client, not module-level assignment.
# v2 used ``telnyx.api_key = ...``; v4 uses a constructed Telnyx client.
# ---------------------------------------------------------------------------
telnyx_client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DB_PATH = os.getenv("DB_PATH", "call_quality.db")
MOS_THRESHOLD = float(os.getenv("MOS_THRESHOLD", "3.5"))
JITTER_THRESHOLD = float(os.getenv("JITTER_THRESHOLD", "30"))
LATENCY_THRESHOLD = float(os.getenv("LATENCY_THRESHOLD", "150"))
PORT = int(os.getenv("PORT", "5000"))

# ---------------------------------------------------------------------------
# KV primitive — in-memory per-call state (production would use Telnyx KV)
# ---------------------------------------------------------------------------
call_state: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# SSE subscriber registry — each connected dashboard gets a queue
# ---------------------------------------------------------------------------
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()


def _broadcast_sse(event_type: str, data: dict) -> None:
    """Push an SSE event to every connected dashboard client."""
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    dead: list[queue.Queue] = []
    with _sse_lock:
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


# ---------------------------------------------------------------------------
# SQL primitive — SQLite for historical analytics
# ---------------------------------------------------------------------------
def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS call_quality_metrics (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id     TEXT    NOT NULL,
            timestamp   TEXT    NOT NULL,
            mos         REAL,
            jitter     REAL,
            latency     REAL,
            packet_loss REAL,
            source      TEXT,
            raw         TEXT,
            from_number TEXT,
            to_number   TEXT
        )
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_metrics_call_id ON call_quality_metrics (call_id)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON call_quality_metrics (timestamp)"
    )
    conn.commit()
    conn.close()


def store_metric(metric: dict) -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO call_quality_metrics
            (call_id, timestamp, mos, jitter, latency, packet_loss,
             source, raw, from_number, to_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            metric["call_id"],
            metric["timestamp"],
            metric.get("mos"),
            metric.get("jitter"),
            metric.get("latency"),
            metric.get("packet_loss"),
            metric.get("source", "unknown"),
            json.dumps(metric.get("raw", {})),
            metric.get("from_number"),
            metric.get("to_number"),
        ),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Threshold alerting
# ---------------------------------------------------------------------------
def check_thresholds(metric: dict) -> list[str]:
    alerts: list[str] = []
    if metric.get("mos") is not None and metric["mos"] < MOS_THRESHOLD:
        alerts.append(f"MOS {metric['mos']} below threshold {MOS_THRESHOLD}")
    if metric.get("jitter") is not None and metric["jitter"] > JITTER_THRESHOLD:
        alerts.append(f"Jitter {metric['jitter']}ms above threshold {JITTER_THRESHOLD}ms")
    if metric.get("latency") is not None and metric["latency"] > LATENCY_THRESHOLD:
        alerts.append(f"Latency {metric['latency']}ms above threshold {LATENCY_THRESHOLD}ms")
    return alerts


# ---------------------------------------------------------------------------
# Webhook payload processing
# ---------------------------------------------------------------------------
def process_quality_metric(payload: dict) -> None:
    """Process a call-quality metric from a verified webhook payload."""
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

    # KV update — per-call state
    if call_id not in call_state:
        call_state[call_id] = {"metrics": [], "alerts": []}
    call_state[call_id]["metrics"].append(metric)

    # SQL insert — historical analytics
    store_metric(metric)

    # Threshold check
    alerts = check_thresholds(metric)
    if alerts:
        call_state[call_id]["alerts"].extend(alerts)
        for alert in alerts:
            app.logger.warning("Alert for call %s: %s", call_id, alert)

    # SSE broadcast
    _broadcast_sse("quality_metric", {"data": metric, "alerts": alerts})


def process_call_event(payload: dict) -> None:
    """Track call lifecycle events (initiated, answered, completed)."""
    call_id = payload.get("call_leg_id") or payload.get("call_session_id")
    if not call_id:
        return
    event_type = payload.get("event_type", "")
    if call_id not in call_state:
        call_state[call_id] = {"metrics": [], "alerts": []}
    call_state[call_id]["event"] = event_type
    call_state[call_id]["timestamp"] = datetime.now(timezone.utc).isoformat()
    _broadcast_sse("call_event", {"call_id": call_id, "event": event_type})


def process_webhook_payload(payload: dict) -> None:
    """Route webhook payload to the appropriate handler."""
    event_type = payload.get("event_type", "")
    if "quality" in event_type.lower():
        process_quality_metric(payload)
    elif event_type in ("call.initiated", "call.answered", "call.completed"):
        process_call_event(payload)


# ---------------------------------------------------------------------------
# Webhook verification (Ed25519) via pynacl — works with SDK v4
# ---------------------------------------------------------------------------
def verify_webhook(raw_body: bytes, headers: dict) -> dict:
    """
    Verify a Telnyx webhook signature and return the payload.

    Uses the Ed25519 public key stored on ``telnyx_client.public_key``.
    Raises ``ValueError`` if verification fails.
    """
    import base64

    from nacl.exceptions import BadSignatureError
    from nacl.signing import VerifyKey

    public_key_b64 = telnyx_client.public_key
    if not public_key_b64:
        raise ValueError("TELNYX_PUBLIC_KEY is not set")

    signature_b64 = headers.get("Telnyx-Signature-Ed25519", "")
    timestamp = headers.get("Telnyx-Timestamp", "")
    if not signature_b64 or not timestamp:
        raise ValueError("Missing Telnyx signature headers")

    verify_key = VerifyKey(base64.b64decode(public_key_b64))
    signed_payload = timestamp.encode() + b"|" + raw_body

    try:
        verify_key.verify(signed_payload, base64.b64decode(signature_b64))
    except BadSignatureError:
        raise ValueError("Invalid Ed25519 signature")

    body = json.loads(raw_body)
    return body.get("data", {}).get("payload", body)


# ---------------------------------------------------------------------------
# Routes — webhook
# ---------------------------------------------------------------------------
@app.route("/webhooks/call-quality", methods=["POST"])
def call_quality_webhook():
    """Receive and verify Telnyx call-quality webhooks."""
    raw_body = request.get_data()
    try:
        payload = verify_webhook(raw_body, dict(request.headers))
    except ValueError as exc:
        app.logger.warning("Webhook rejected: %s", exc)
        return jsonify({"error": str(exc)}), 401

    process_webhook_payload(payload)
    return jsonify({"status": "ok"}), 200


# ---------------------------------------------------------------------------
# Routes — dashboard (SSE)
# ---------------------------------------------------------------------------
DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Call Quality Monitor</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin-bottom: .25rem; }
    .subtitle { color: #666; margin-top: 0; }
    #alerts { margin: 1rem 0; }
    .alert { background: #fee; border-left: 4px solid #c00; padding: .5rem 1rem; margin: .25rem 0; border-radius: 4px; }
    #updates { display: grid; gap: .5rem; }
    .metric { background: #f8f8f8; padding: .75rem 1rem; border-radius: 6px; font-family: monospace; font-size: 13px; }
    .metric .call-id { font-weight: bold; }
    .stat-row { display: flex; gap: 2rem; margin: 1rem 0; }
    .stat { background: #f0f4ff; padding: 1rem 1.5rem; border-radius: 8px; }
    .stat .value { font-size: 1.5rem; font-weight: bold; }
    .stat .label { color: #666; font-size: .85rem; }
  </style>
</head>
<body>
  <h1>Call Quality Monitor</h1>
  <p class="subtitle">Live MOS, jitter, latency and packet-loss metrics from Telnyx Call Control webhooks.</p>
  <div class="stat-row" id="stats">
    <div class="stat"><div class="value" id="stat-samples">0</div><div class="label">Samples received</div></div>
    <div class="stat"><div class="value" id="stat-alerts">0</div><div class="label">Threshold alerts</div></div>
    <div class="stat"><div class="value" id="stat-calls">0</div><div class="label">Active calls</div></div>
  </div>
  <div id="alerts"></div>
  <div id="updates"></div>
  <script>
    let samples = 0, alertCount = 0, calls = new Set();
    const evtSource = new EventSource('/events');
    evtSource.addEventListener('quality_metric', function(e) {
        samples++;
        const msg = JSON.parse(e.data);
        const m = msg.data;
        calls.add(m.call_id);
        document.getElementById('stat-samples').textContent = samples;
        document.getElementById('stat-calls').textContent = calls.size;
        const el = document.getElementById('updates');
        const div = document.createElement('div');
        div.className = 'metric';
        div.innerHTML = '<span class="call-id">' + m.call_id + '</span> '
            + 'MOS=' + m.mos + ' jitter=' + m.jitter + 'ms latency=' + m.latency + 'ms loss=' + m.packet_loss + '%';
        el.prepend(div);
        if (msg.alerts && msg.alerts.length) {
            alertCount += msg.alerts.length;
            document.getElementById('stat-alerts').textContent = alertCount;
            for (const a of msg.alerts) {
                const ae = document.createElement('div');
                ae.className = 'alert';
                ae.textContent = m.call_id + ': ' + a;
                document.getElementById('alerts').prepend(ae);
            }
        }
    });
    evtSource.addEventListener('call_event', function(e) {
        const msg = JSON.parse(e.data);
        const el = document.getElementById('updates');
        const div = document.createElement('div');
        div.className = 'metric';
        div.textContent = 'Event: ' + msg.event + ' — ' + msg.call_id;
        el.prepend(div);
    });
  </script>
</body>
</html>"""


@app.route("/")
def dashboard():
    return render_template_string(DASHBOARD_HTML)


@app.route("/events")
def sse_stream():
    """SSE endpoint — pushes live quality updates to connected dashboards."""
    q: queue.Queue = queue.Queue(maxsize=256)
    with _sse_lock:
        _sse_clients.append(q)

    def stream():
        try:
            # Send a comment to flush headers immediately
            yield ": connected\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(stream(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


# ---------------------------------------------------------------------------
# Routes — REST API
# ---------------------------------------------------------------------------
@app.route("/api/quality/<call_id>", methods=["GET"])
def get_call_quality(call_id):
    """Get all quality metrics for a specific call."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM call_quality_metrics WHERE call_id = ? ORDER BY timestamp",
        (call_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/quality", methods=["GET"])
def get_all_quality():
    """Get all quality metrics with optional filters."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    query = "SELECT * FROM call_quality_metrics WHERE 1=1"
    params: list = []

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

    cur.execute(query, params)
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/quality/stats", methods=["GET"])
def get_quality_stats():
    """Get aggregate statistics for historical analytics."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            COUNT(*)         AS total_samples,
            AVG(mos)         AS avg_mos,
            MIN(mos)         AS min_mos,
            MAX(mos)         AS max_mos,
            AVG(jitter)      AS avg_jitter,
            MAX(jitter)      AS max_jitter,
            AVG(latency)     AS avg_latency,
            MAX(latency)     AS max_latency,
            AVG(packet_loss) AS avg_packet_loss,
            MAX(packet_loss) AS max_packet_loss
        FROM call_quality_metrics
        """
    )
    s = cur.fetchone()
    conn.close()
    return jsonify({
        "total_samples": s[0],
        "avg_mos": s[1],
        "min_mos": s[2],
        "max_mos": s[3],
        "avg_jitter": s[4],
        "max_jitter": s[5],
        "avg_latency": s[6],
        "max_latency": s[7],
        "avg_packet_loss": s[8],
        "max_packet_loss": s[9],
    })


@app.route("/api/quality/alerts", methods=["GET"])
def get_alerts():
    """Get all threshold alerts from in-memory call state."""
    alerts: list[dict] = []
    for call_id, state in call_state.items():
        for alert in state.get("alerts", []):
            alerts.append({"call_id": call_id, "alert": alert})
    return jsonify(alerts)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(e):
    app.logger.exception("Internal server error")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
