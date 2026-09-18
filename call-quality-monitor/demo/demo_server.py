"""Single-file demo launcher for the call-quality-monitor sample.

Serves a polished dashboard at http://localhost:5555/ that drives the real
quality-monitoring pipeline (webhook → verify → KV → SQL → threshold → SSE)
with Telnyx webhook deliveries simulated locally. No Telnyx credentials or
ngrok required.

Run from the call-quality-monitor/ directory:
    python demo/demo_server.py
"""

import base64
import json
import os
import random
import sys
import threading
import time
from datetime import datetime, timezone

# Put the project root on sys.path so `import app` works regardless of CWD.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Hermetic demo environment — set BEFORE importing the app so its module-level
# telnyx.Telnyx() construction and load_dotenv() succeed offline.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key_no_real_calls")
os.environ.setdefault("TELNYX_PUBLIC_KEY", "demo_dummy_key_no_real_calls")
os.environ.setdefault("DB_PATH", os.path.join(_PROJECT_ROOT, "demo_metrics.db"))
os.environ.setdefault("PORT", "5555")

# Clean any stale demo DB so each run starts fresh.
_demo_db = os.environ["DB_PATH"]
if os.path.exists(_demo_db):
    os.remove(_demo_db)

from flask import jsonify, request  # noqa: E402

# --- Import the real app (this wires all routes, KV, SQL, SSE) -------------
from app import (  # noqa: E402
    app,
    init_db,
    process_quality_metric,
    process_call_event,
    call_state,
)

# --- Ed25519 keypair: generated ONCE at module load -----------------------
# The public key is injected into telnyx_client so the app's webhook
# verification accepts our locally-signed webhook deliveries.
from nacl.signing import SigningKey  # noqa: E402

_signing_key = SigningKey.generate()
_public_key_b64 = base64.b64encode(bytes(_signing_key.verify_key)).decode("ascii")

from app import telnyx_client  # noqa: E402
telnyx_client.public_key = _public_key_b64

# Initialise the SQLite DB for the demo
init_db()

# ---------------------------------------------------------------------------
# Demo data — realistic call-quality scenarios
# ---------------------------------------------------------------------------
DEMO_CALLS = [
    {
        "call_leg_id": "call-leg-alpha-001",
        "call_session_id": "call-session-alpha-001",
        "from": "+15551234001",
        "to": "+15557654001",
        "source": "sip",
    },
    {
        "call_leg_id": "call-leg-bravo-002",
        "call_session_id": "call-session-bravo-002",
        "from": "+15551234002",
        "to": "+15557654002",
        "source": "webrtc",
    },
    {
        "call_leg_id": "call-leg-charlie-003",
        "call_session_id": "call-session-charlie-003",
        "from": "+15551234003",
        "to": "+15557654003",
        "source": "pstn",
    },
]

# Metric profiles: (label, mos_range, jitter_range, latency_range, packet_loss_range)
METRIC_PROFILES = [
    ("excellent", (4.2, 4.6), (2, 10), (20, 60), (0.0, 0.1)),
    ("good", (3.8, 4.1), (10, 25), (60, 120), (0.1, 0.3)),
    ("degraded", (3.0, 3.4), (30, 60), (120, 200), (0.5, 1.5)),
    ("poor", (2.0, 2.8), (60, 120), (200, 400), (1.5, 5.0)),
]


def _random_metric(call: dict, profile: tuple) -> dict:
    """Build a realistic quality-metric payload for a call."""
    label, mos_r, jit_r, lat_r, loss_r = profile
    return {
        "event_type": "call.quality",
        "call_leg_id": call["call_leg_id"],
        "call_session_id": call["call_session_id"],
        "from": call["from"],
        "to": call["to"],
        "source": call["source"],
        "mos": round(random.uniform(*mos_r), 2),
        "jitter": round(random.uniform(*jit_r), 1),
        "latency": round(random.uniform(*lat_r), 1),
        "packet_loss": round(random.uniform(*loss_r), 2),
    }


def _sign_webhook(payload: dict) -> tuple[bytes, dict]:
    """
    Sign a payload as a Telnyx webhook and return (body, headers) ready for POST.
    """
    body_dict = {"data": {"payload": payload, "event_type": payload.get("event_type", "call.quality")}}
    raw_body = json.dumps(body_dict).encode()
    timestamp = str(int(time.time()))
    signed = timestamp.encode() + b"|" + raw_body
    signature = _signing_key.sign(signed)
    sig_b64 = base64.b64encode(signature.signature).decode("ascii")
    headers = {
        "Content-Type": "application/json",
        "Telnyx-Signature-Ed25519": sig_b64,
        "Telnyx-Timestamp": timestamp,
    }
    return raw_body, headers


# ---------------------------------------------------------------------------
# Simulation engine — sends signed webhooks to the real /webhooks/call-quality
# ---------------------------------------------------------------------------
def _simulate_call_lifecycle(call: dict, num_metrics: int = 5):
    """Send call.initiated, then num_metrics quality reports, then call.completed."""
    # Call initiated
    initiated = {
        "event_type": "call.initiated",
        "call_leg_id": call["call_leg_id"],
        "call_session_id": call["call_session_id"],
        "from": call["from"],
        "to": call["to"],
    }
    raw, hdrs = _sign_webhook(initiated)
    _post_webhook(raw, hdrs)
    time.sleep(0.2)

    # Quality metrics — randomly pick a profile for each call
    profile = random.choice(METRIC_PROFILES)
    for i in range(num_metrics):
        metric = _random_metric(call, profile)
        raw, hdrs = _sign_webhook(metric)
        _post_webhook(raw, hdrs)
        time.sleep(0.5)

    # Call completed
    completed = {
        "event_type": "call.completed",
        "call_leg_id": call["call_leg_id"],
        "call_session_id": call["call_session_id"],
    }
    raw, hdrs = _sign_webhook(completed)
    _post_webhook(raw, hdrs)


def _post_webhook(raw_body: bytes, headers: dict):
    """POST a signed webhook to the app's /webhooks/call-quality route."""
    import requests
    port = os.environ.get("PORT", "5555")
    url = f"http://127.0.0.1:{port}/webhooks/call-quality"
    try:
        resp = requests.post(url, data=raw_body, headers=headers, timeout=5)
        if resp.status_code != 200:
            app.logger.warning("[demo] webhook POST %s -> %s: %s",
                               url, resp.status_code, resp.text)
    except Exception as exc:
        app.logger.warning("[demo] webhook POST failed: %s", exc)


# ---------------------------------------------------------------------------
# Demo routes
# ---------------------------------------------------------------------------
@app.route("/demo/start", methods=["POST"])
def demo_start():
    """Start a batch of simulated calls with quality metrics."""
    body = request.get_json(silent=True) or {}
    num_calls = body.get("calls", 3)
    metrics_per_call = body.get("metrics_per_call", 5)

    def run():
        for i in range(min(num_calls, len(DEMO_CALLS))):
            call = DEMO_CALLS[i]
            app.logger.info("[demo] simulating call %s", call["call_leg_id"])
            _simulate_call_lifecycle(call, metrics_per_call)
        app.logger.info("[demo] batch complete")

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "started", "calls": min(num_calls, len(DEMO_CALLS))})


@app.route("/demo/trigger-alert", methods=["POST"])
def demo_trigger_alert():
    """Force a degraded-quality call to trigger threshold alerts."""
    call = DEMO_CALLS[1]  # use bravo for the alert demo
    poor_profile = METRIC_PROFILES[3]  # "poor"

    def run():
        # Send call.initiated
        initiated = {
            "event_type": "call.initiated",
            "call_leg_id": call["call_leg_id"],
            "call_session_id": call["call_session_id"],
            "from": call["from"],
            "to": call["to"],
        }
        raw, hdrs = _sign_webhook(initiated)
        _post_webhook(raw, hdrs)
        time.sleep(0.2)

        # Send 3 poor metrics
        for _ in range(3):
            metric = _random_metric(call, poor_profile)
            raw, hdrs = _sign_webhook(metric)
            _post_webhook(raw, hdrs)
            time.sleep(0.5)

        # Send call.completed
        completed = {
            "event_type": "call.completed",
            "call_leg_id": call["call_leg_id"],
            "call_session_id": call["call_session_id"],
        }
        raw, hdrs = _sign_webhook(completed)
        _post_webhook(raw, hdrs)

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "alert_triggered", "call_id": call["call_leg_id"]})


@app.route("/demo/reset", methods=["POST"])
def demo_reset():
    """Clear all KV state and the demo SQLite DB."""
    call_state.clear()
    import sqlite3
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("DELETE FROM call_quality_metrics")
    conn.commit()
    conn.close()
    return jsonify({"status": "reset"})


# ---------------------------------------------------------------------------
# Dashboard enhancement — override the view function to inject demo buttons
# ---------------------------------------------------------------------------
# Flask matches the first registered route for "/", so adding a second
# @app.route("/") won't work. Instead we replace the view function directly.
from app import DASHBOARD_HTML  # noqa: E402

_DEMO_CONTROLS = """
  <div id="demo-controls" style="margin: 1rem 0; padding: 1rem; background: #f0f4ff; border-radius: 8px;">
    <h3 style="margin-top:0">Demo Controls</h3>
    <button onclick="fetch('/demo/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({calls:3,metrics_per_call:5})})">Start 3 Calls</button>
    <button onclick="fetch('/demo/trigger-alert',{method:'POST'})">Trigger Alert</button>
    <button onclick="fetch('/demo/reset',{method:'POST'}).then(()=>location.reload())">Reset Data</button>
    <p style="margin-bottom:0;font-size:0.85rem;color:#666;">Demo server running — no real Telnyx credentials needed.</p>
  </div>
</body>
</html>"""

_DEMO_HTML = DASHBOARD_HTML.replace("</body>\n</html>", _DEMO_CONTROLS)


def demo_dashboard():
    """Serve the dashboard with demo controls appended."""
    from flask import Response
    return Response(_DEMO_HTML, mimetype="text/html")


app.view_functions["dashboard"] = demo_dashboard


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import requests  # noqa: F401  — ensure requests is available for _post_webhook

    port = int(os.environ.get("PORT", "5555"))
    print(f"\n  Call Quality Monitor — demo server")
    print(f"  Dashboard:  http://localhost:{port}/")
    print(f"  SSE stream: http://localhost:{port}/events")
    print(f"  Health:     http://localhost:{port}/health\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
