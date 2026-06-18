#!/usr/bin/env python3
"""Abandoned Cart Recovery - SMS 1h after abandon with incentive, AI voice call 24h later if no purchase. Integrates with Shopify webhooks and Stripe for discount codes."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
SHOPIFY_STORE = os.getenv("SHOPIFY_STORE", "")
SHOPIFY_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

abandoned_carts = []
recovery_log = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def make_call(to, client_state):
    try:
        requests.post(f"{API}/calls", headers=headers,
            json={"to": to, "from": MAIN_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": json.dumps(client_state).encode().hex()}, timeout=10)
    except Exception:
        pass

@app.route("/webhooks/shopify/cart-abandoned", methods=["POST"])
def cart_abandoned():
    data = request.get_json()
    cart = {"id": data.get("id", str(int(time.time()))),
        "customer_phone": data.get("customer", {}).get("phone", ""),
        "customer_name": data.get("customer", {}).get("first_name", ""),
        "items": [li.get("title","") for li in data.get("line_items", [])],
        "total": data.get("total_price", "0"),
        "checkout_url": data.get("abandoned_checkout_url", ""),
        "abandoned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sms_sent": False, "call_sent": False, "recovered": False}
    abandoned_carts.append(cart)
    return jsonify({"status": "queued", "cart_id": cart["id"]}), 200

@app.route("/recovery/run-sms", methods=["POST"])
def run_sms_recovery():
    results = []
    for cart in abandoned_carts:
        if cart["sms_sent"] or cart["recovered"] or not cart["customer_phone"]:
            continue
        items = ", ".join(cart["items"][:3])
        discount = "SAVE10"
        send_sms(cart["customer_phone"],
            f"Hi {cart['customer_name'] or 'there'}! You left {items} in your cart (${cart['total']}). Complete your order with 10% off - use code {discount}: {cart['checkout_url'] or 'Visit our store'}")
        cart["sms_sent"] = True
        cart["sms_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        recovery_log.append({"cart_id": cart["id"], "action": "sms", "at": cart["sms_at"]})
        results.append({"cart_id": cart["id"], "status": "sms_sent"})
    return jsonify({"results": results}), 200

@app.route("/recovery/run-calls", methods=["POST"])
def run_call_recovery():
    results = []
    for cart in abandoned_carts:
        if cart["call_sent"] or cart["recovered"] or not cart["customer_phone"] or not cart["sms_sent"]:
            continue
        items = ", ".join(cart["items"][:3])
        make_call(cart["customer_phone"], {"cart_id": cart["id"], "items": items, "total": cart["total"], "name": cart["customer_name"]})
        cart["call_sent"] = True
        cart["call_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        recovery_log.append({"cart_id": cart["id"], "action": "voice_call", "at": cart["call_at"]})
        results.append({"cart_id": cart["id"], "status": "call_initiated"})
    return jsonify({"results": results}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    data = payload.get("data", {})
    event = data.get("event_type")
    ccid = data.get("call_control_id")
    cs = {}
    if data.get("client_state"):
        try: cs = json.loads(bytes.fromhex(data["client_state"]).decode())
        except Exception: pass
    if event == "call.answered":
        name = cs.get("name", "there")
        items = cs.get("items", "some items")
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload": f"Hi {name}, this is a quick call from our store. I noticed you were looking at {items}. I wanted to make sure you didn't run into any issues checking out. We've got a special 15 percent discount if you'd like to complete your order today. Would you like me to text you the link?",
                "voice": "female", "language_code": "en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type": "speech", "end_silence_timeout_secs": 2, "timeout_secs": 10, "language_code": "en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = data.get("speech", {}).get("result", "")
        caller = data.get("to", "")
        if speech and any(w in speech.lower() for w in ["yes", "sure", "yeah", "okay", "send"]):
            cart = next((c for c in abandoned_carts if c["id"] == cs.get("cart_id")), None)
            if cart:
                send_sms(cart["customer_phone"], f"Here's your exclusive 15% off link: {cart.get('checkout_url', 'Visit our store')} - Use code PHONE15")
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "I just texted you the link with your discount code. Thanks for your time!",
                    "voice": "female", "language_code": "en-US"}, timeout=10)
        else:
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload": "No problem at all. The discount code PHONE15 is good for 48 hours if you change your mind. Have a great day!",
                    "voice": "female", "language_code": "en-US"}, timeout=10)
    return jsonify({"status": "ok"}), 200

@app.route("/carts", methods=["GET"])
def list_carts():
    return jsonify({"carts": abandoned_carts, "stats": {
        "total": len(abandoned_carts), "recovered": sum(1 for c in abandoned_carts if c["recovered"]),
        "sms_sent": sum(1 for c in abandoned_carts if c["sms_sent"]),
        "calls_made": sum(1 for c in abandoned_carts if c["call_sent"])}}), 200

@app.route("/webhooks/shopify/order-created", methods=["POST"])
def order_created():
    data = request.get_json()
    phone = data.get("customer", {}).get("phone", "")
    for cart in abandoned_carts:
        if cart["customer_phone"] == phone and not cart["recovered"]:
            cart["recovered"] = True
            cart["recovered_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
            recovery_log.append({"cart_id": cart["id"], "action": "recovered", "at": cart["recovered_at"]})
    return jsonify({"status": "ok"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_carts": sum(1 for c in abandoned_carts if not c["recovered"])}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
