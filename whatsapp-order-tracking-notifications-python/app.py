#!/usr/bin/env python3
"""WhatsApp Order Tracking Notifications — proactive shipping updates and AI-powered order inquiries."""

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
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

orders = {}  # order_id -> {customer_phone, items, status, tracking, updates[]}

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

_start_ttl_cleanup(orders)


def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_whatsapp(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": WHATSAPP_NUMBER, "to": to, "text": text, "messaging_profile_id": MESSAGING_PROFILE_ID, "type": "whatsapp"}, timeout=10)
    except requests.RequestException as e:
        app.logger.error("WhatsApp send failed: %s", e)

@app.route("/orders", methods=["POST"])
def create_order():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    order_id = data.get("order_id", f"ORD-{int(time.time())}")
    orders[order_id] = {**data, "order_id": order_id, "status": "confirmed", "updates": [{"status": "confirmed", "time": time.time()}]}
    phone = data.get("customer_phone")
    if phone:
        send_whatsapp(phone, f"Order {order_id} confirmed! You'll receive shipping updates here on WhatsApp. Reply anytime with your order number to check status.")
    return jsonify({"order_id": order_id, "status": "created"}), 200

@app.route("/orders/<order_id>/status", methods=["PUT"])
def update_status(order_id):
    order = orders.get(order_id)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    new_status = data.get("status")
    tracking = data.get("tracking_number")
    order["status"] = new_status
    if tracking:
        order["tracking"] = tracking
    order["updates"].append({"status": new_status, "time": time.time()})
    # nosemgrep: python.flask.security.injection.tainted-sql-string.tainted-sql-string -- builds SMS message text; this app has no SQL/database.
    status_messages = {
        "shipped": f"Your order {order_id} has shipped! Tracking: {tracking or 'pending'}",
        "out_for_delivery": f"Your order {order_id} is out for delivery today!",
        "delivered": f"Your order {order_id} has been delivered. Thanks for shopping with us!",
        "delayed": f"Update on order {order_id}: there's a slight delay. New ETA will be shared soon.",
    }
    msg = status_messages.get(new_status, f"Order {order_id} update: {new_status}")
    send_whatsapp(order.get("customer_phone"), msg)
    return jsonify({"order_id": order_id, "status": new_status}), 200

@app.route("/webhooks/messaging", methods=["POST"])
def handle_whatsapp():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    if data.get("event_type") != "message.received" or p.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = p.get("from", {}).get("phone_number", "")
    text = p.get("text", "").strip()
    if not from_number or not text:
        return jsonify({"status": "ignored"}), 200

    customer_orders = [o for o in orders.values() if o.get("customer_phone") == from_number]
    orders_context = json.dumps(customer_orders[:5]) if customer_orders else "No orders found"
    messages = [{"role": "system", "content": f"You are an order tracking assistant. Customer orders: {orders_context}. Help them check order status, delivery estimates, or handle issues. Be concise and helpful."},
        {"role": "user", "content": text}]
    response = call_inference(messages)
    send_whatsapp(from_number, response)
    return jsonify({"status": "responded"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "orders": len(orders)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
