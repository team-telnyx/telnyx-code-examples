#!/usr/bin/env python3
"""Number Porting Status Tracker — track porting orders with status webhooks and SMS alerts."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
ALERT_NUMBER = os.getenv("ALERT_NUMBER")
port_orders = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(port_orders)


@app.route("/ports/list", methods=["GET"])
def list_ports():
    try:
        resp = requests.get("https://api.telnyx.com/v2/porting_orders", headers={"Authorization": f"Bearer {TELNYX_API_KEY}"})
        if resp.ok:
            return jsonify(resp.json()), 200
    except Exception as e:
        app.logger.exception("Failed to fetch porting orders")
        return jsonify({"error": "Failed to fetch porting orders"}), 500
    return jsonify({"error": "Failed to fetch"}), 500

@app.route("/ports/create", methods=["POST"])
def create_port():
    data = request.get_json()
    try:
        resp = requests.post("https://api.telnyx.com/v2/porting_orders", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=data, timeout=15)
        if resp.ok:
            order = resp.json().get("data", {})
            port_orders[order.get("id")] = {"status": "submitted", "numbers": data.get("phone_numbers", []), "updates": []}
            return jsonify(order), 200
        return jsonify({"error": resp.text}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create porting order")
        return jsonify({"error": "Failed to create porting order"}), 500

@app.route("/webhooks/porting", methods=["POST"])
def handle_porting_webhook():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    event_type = data.get("event_type", "")
    order_id = data.get("id", "")
    new_status = data.get("status", "")
    if order_id in port_orders:
        port_orders[order_id]["status"] = new_status
        port_orders[order_id]["updates"].append({"status": new_status, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
    status_emoji = {"porting_completed": "completed", "porting_failed": "failed", "foc_date_confirmed": "FOC date set"}
    if ALERT_NUMBER and new_status in status_emoji:
        try:
            requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                json={"from": ALERT_NUMBER, "to": ALERT_NUMBER, "text": f"Port {order_id}: {status_emoji[new_status]}"}, timeout=10)
        except Exception:
            pass
    return jsonify({"status": "ok"}), 200

@app.route("/ports/<order_id>", methods=["GET"])
def get_port(order_id):
    order = port_orders.get(order_id)
    if not order: return jsonify({"error": "Not found"}), 404
    return jsonify(order), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "tracked_ports": len(port_orders)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
