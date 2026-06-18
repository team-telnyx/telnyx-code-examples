#!/usr/bin/env python3
"""WhatsApp Order Tracking Notifications — proactive shipping updates and AI-powered order inquiries."""

import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

orders = {}  # order_id -> {customer_phone, items, status, tracking, updates[]}

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
        app.logger.error(f"WhatsApp send failed: {e}")

@app.route("/orders", methods=["POST"])
def create_order():
    data = request.get_json()
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
    new_status = data.get("status")
    tracking = data.get("tracking_number")
    order["status"] = new_status
    if tracking:
        order["tracking"] = tracking
    order["updates"].append({"status": new_status, "time": time.time()})
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
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip()
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
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
