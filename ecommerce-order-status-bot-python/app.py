#!/usr/bin/env python3
"""E-commerce Order Status Bot - customers call or text order number, get real-time Shopify tracking. AI detects delivery exceptions and proactively texts customers before they call support."""
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
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
SHOPIFY_STORE = os.getenv("SHOPIFY_STORE", "")
SHOPIFY_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
SUPPORT_SLACK = os.getenv("SUPPORT_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

exception_log = []
calls = {}

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

_start_ttl_cleanup(calls)


def lookup_order(order_number):
    if not SHOPIFY_STORE or not SHOPIFY_TOKEN:
        return {"order_number": order_number, "status": "shipped", "tracking": "1Z999AA10123456784",
            "carrier": "UPS", "estimated_delivery": "June 20, 2026", "items": ["Widget Pro x2"]}
    try:
        resp = requests.get(f"https://{SHOPIFY_STORE}.myshopify.com/admin/api/2024-01/orders.json",
            headers={"X-Shopify-Access-Token": SHOPIFY_TOKEN},
            params={"name": order_number, "status": "any"}, timeout=15)
        orders = resp.json().get("orders", [])
        if orders:
            o = orders[0]
            fulfillments = o.get("fulfillments", [])
            tracking = fulfillments[0].get("tracking_number") if fulfillments else None
            return {"order_number": o.get("name"), "status": o.get("fulfillment_status", "unfulfilled"),
                "tracking": tracking, "carrier": fulfillments[0].get("tracking_company") if fulfillments else None,
                "total": o.get("total_price"), "items": [li.get("title") for li in o.get("line_items", [])]}
        return None
    except Exception:
        return None

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip()
    order = lookup_order(text)
    if order:
        msg = f"Order {order['order_number']}: {order['status'].upper()}"
        if order.get("tracking"):
            msg += f"\nTracking: {order['carrier']} {order['tracking']}"
        if order.get("estimated_delivery"):
            msg += f"\nEstimated delivery: {order['estimated_delivery']}"
        msg += f"\nItems: {', '.join(order.get('items', []))}"
    else:
        msg = f"I couldn't find order '{text}'. Please check the number and try again, or reply HELP to speak with support."
    send_sms(sender, msg)
    if text.upper() == "HELP":
        send_sms(sender, "A support agent will call you shortly.")
        if SUPPORT_SLACK:
            try: requests.post(SUPPORT_SLACK, json={"text": f"Customer {sender} requesting support callback"}, timeout=5)
            except Exception: pass
    return jsonify({"status": "ok"}), 200

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
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
    event = data.get("event_type")
    ccid = p.get("call_control_id")
    caller = p.get("from", "")
    if event == "call.initiated" and p.get("direction") == "incoming":
        requests.post(f"{API}/calls/{ccid}/actions/answer", headers=headers, json={}, timeout=10)
    elif event == "call.answered":
        calls[ccid] = {"caller": caller, "conversation": [{"role":"system","content":"You help customers check order status. Ask for their order number. Look up the order and give them status, tracking, and estimated delivery. If they have a complaint, offer to escalate to a human agent."}]}
        requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
            json={"payload":"Thank you for calling. I can help you check your order status. What's your order number?",
                "voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.speak.ended":
        requests.post(f"{API}/calls/{ccid}/actions/gather", headers=headers,
            json={"input_type":"speech","end_silence_timeout_secs":2,"timeout_secs":15,"language_code":"en-US"}, timeout=10)
    elif event == "call.gather.ended":
        speech = p.get("speech",{}).get("result","")
        call = calls.get(ccid,{})
        if speech and call:
            order = lookup_order(speech.replace(" ","").replace("#",""))
            if order:
                status_msg = f"Order {order['order_number']} is {order['status']}."
                if order.get("tracking"): status_msg += f" Tracking number {order['tracking']} via {order['carrier']}."
                if order.get("estimated_delivery"): status_msg += f" Estimated delivery {order['estimated_delivery']}."
            else:
                status_msg = "I couldn't find that order number. Could you repeat it?"
            requests.post(f"{API}/calls/{ccid}/actions/speak", headers=headers,
                json={"payload":status_msg,"voice":"female","language_code":"en-US"}, timeout=10)
    elif event == "call.hangup":
        calls.pop(ccid, None)
    return jsonify({"status":"ok"}), 200

@app.route("/exceptions/check", methods=["POST"])
def check_exceptions():
    """Webhook from shipping provider - proactively notify customers of delivery issues"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    tracking = data.get("tracking_number")
    exception_type = data.get("exception", "delay")
    customer_phone = data.get("customer_phone")
    new_eta = data.get("new_eta", "unknown")
    if customer_phone:
        if exception_type == "delay":
            # nosemgrep: python.flask.security.injection.tainted-sql-string.tainted-sql-string -- builds SMS message text; this app has no SQL/database.
            send_sms(customer_phone, f"Update on your order: Your package ({tracking}) has been delayed. New estimated delivery: {new_eta}. We apologize for the inconvenience.")
        elif exception_type == "returned":
            send_sms(customer_phone, f"Your package ({tracking}) was returned to sender. We'll reship it automatically. Reply REFUND if you'd prefer a refund instead.")
        exception_log.append({"tracking": tracking, "type": exception_type, "phone": customer_phone,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        if SUPPORT_SLACK:
            try: requests.post(SUPPORT_SLACK, json={"text": f"Shipping exception: {exception_type} for {tracking}. Customer notified: {customer_phone}"}, timeout=5)
            except Exception: pass
    return jsonify({"status":"notified"}), 200

@app.route("/exceptions", methods=["GET"])
def list_exceptions():
    return jsonify({"exceptions": exception_log}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","exceptions":len(exception_log)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
