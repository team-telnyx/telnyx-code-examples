#!/usr/bin/env python3
"""Porting Order Tracker Dashboard â submit, track, and manage porting orders with SLA monitoring, timeline visualization, and bulk operations."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
ALERT_WEBHOOK = os.getenv("ALERT_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
local_orders = []
status_updates = []
PORTING_SLA = {"submitted_to_foc": 3, "foc_to_activation": 5, "total_days": 10}
STATUS_FLOW = ["draft", "submitted", "exception", "foc_received", "firm_order_confirmed", "scheduled", "in_progress", "completed", "cancelled"]

def check_sla_breach(order):
    if not order.get("submitted_at"): return None
    submitted = time.mktime(time.strptime(order["submitted_at"][:19], "%Y-%m-%dT%H:%M:%S"))
    elapsed = (time.time() - submitted) / 86400
    status = order.get("status", "submitted")
    if status in ("submitted", "exception") and elapsed > PORTING_SLA["submitted_to_foc"]:
        return {"breach": "foc_sla", "days": round(elapsed, 1), "sla": PORTING_SLA["submitted_to_foc"]}
    if status in ("foc_received", "scheduled") and elapsed > PORTING_SLA["total_days"]:
        return {"breach": "total_sla", "days": round(elapsed, 1), "sla": PORTING_SLA["total_days"]}
    return None

@app.route("/porting/orders", methods=["POST"])
def submit_order():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/porting_orders", headers=headers,
            json={"phone_numbers": data.get("phone_numbers", []),
                "authorized_person": data.get("authorized_person"),
                "current_provider": data.get("current_provider"),
                "billing_phone_number": data.get("billing_phone_number"),
                "customer_reference": data.get("reference", "")})
        result = resp.json()
        order = {"id": result.get("data", {}).get("id"), "numbers": data.get("phone_numbers"),
            "count": len(data.get("phone_numbers", [])), "provider": data.get("current_provider"),
            "status": "submitted", "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "timeline": [{"status": "submitted", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}]}
        local_orders.append(order)
        return jsonify({"order": order, "api": result}), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to submit porting order")
        return jsonify({"error": "could not submit porting order"}), 500

@app.route("/porting/bulk", methods=["POST"])
def bulk_submit():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    results = []
    for batch in data.get("batches", []):
        try:
            resp = requests.post(f"{API}/porting_orders", headers=headers,
                json={"phone_numbers": batch.get("phone_numbers", []),
                    "authorized_person": batch.get("authorized_person"),
                    "current_provider": batch.get("current_provider"),
                    "billing_phone_number": batch.get("billing_phone_number")}, timeout=15)
            oid = resp.json().get("data", {}).get("id")
            local_orders.append({"id": oid, "numbers": batch.get("phone_numbers"),
                "status": "submitted", "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "timeline": [{"status": "submitted", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}]})
            results.append({"status": "ok", "order_id": oid})
        except Exception as e:
            app.logger.exception("Failed to submit porting order batch")
            results.append({"status": "error", "error": "could not submit porting order batch"})
    return jsonify({"submitted": sum(1 for r in results if r["status"] == "ok"), "results": results}), 200

@app.route("/porting/orders", methods=["GET"])
def list_orders():
    try:
        resp = requests.get(f"{API}/porting_orders", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list porting orders")
        return jsonify({"error": "could not list porting orders", "local": local_orders}), 500

@app.route("/webhooks/porting", methods=["POST"])
def handle_webhook():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    update = {"event": data.get("event_type"), "order_id": data.get("porting_order_id"),
        "status": data.get("status"), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    status_updates.append(update)
    for order in local_orders:
        if order["id"] == data.get("porting_order_id"):
            order["status"] = data.get("status", order["status"])
            order.setdefault("timeline", []).append({"status": order["status"], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
    if data.get("status") == "exception" and ALERT_WEBHOOK:
        try: requests.post(ALERT_WEBHOOK, json={"text": f"Port exception: {data.get('porting_order_id')}"}, timeout=5)
        except Exception: pass
    return jsonify({"status": "received"}), 200

@app.route("/porting/sla-check", methods=["GET"])
def sla_check():
    breaches = []
    for order in local_orders:
        b = check_sla_breach(order)
        if b:
            b["order_id"] = order["id"]
            breaches.append(b)
    return jsonify({"breaches": breaches, "sla_config": PORTING_SLA}), 200

@app.route("/porting/dashboard", methods=["GET"])
def dashboard():
    by_status = {}
    by_provider = {}
    for order in local_orders:
        s = order.get("status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1
        p = order.get("provider", "unknown")
        by_provider[p] = by_provider.get(p, 0) + 1
    return jsonify({"total_orders": len(local_orders), "by_status": by_status,
        "by_provider": by_provider, "sla_breaches": sum(1 for o in local_orders if check_sla_breach(o)),
        "recent_updates": status_updates[-10:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "orders": len(local_orders)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
