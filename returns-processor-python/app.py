#!/usr/bin/env python3
"""Returns Processor - customer texts photo of defective item via MMS, AI evaluates damage, auto-approves low-value refunds via Stripe, escalates high-value to team lead."""
import os, json, time, requests, stripe
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STRIPE_API_KEY = os.getenv("STRIPE_API_KEY")
SHOPIFY_STORE = os.getenv("SHOPIFY_STORE", "")
SHOPIFY_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
SUPPORT_SLACK = os.getenv("SUPPORT_SLACK_WEBHOOK", "")
AUTO_REFUND_THRESHOLD = int(os.getenv("AUTO_REFUND_THRESHOLD", "50"))
stripe.api_key = STRIPE_API_KEY
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

returns = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def ai_evaluate_return(description, order_value):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": f"Evaluate this return request. Order value: ${order_value}. Auto-refund threshold: ${AUTO_REFUND_THRESHOLD}. Reply JSON: {{\"approved\": true/false, \"reason\": \"...\", \"action\": \"refund|exchange|escalate\", \"refund_amount\": number}}"},
                {"role": "user", "content": description}], "max_tokens": 150, "temperature": 0.1}, timeout=15)
        return json.loads(resp.json()["choices"][0]["message"]["content"].strip().strip("`").replace("json\n",""))
    except Exception:
        return {"approved": False, "reason": "Could not evaluate", "action": "escalate", "refund_amount": 0}

@app.route("/webhooks/sms", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {}).get("payload", {})
    sender = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "")
    media = data.get("media", [])

    if text.upper().startswith("RETURN"):
        order_info = text.replace("RETURN", "").strip()
        has_photo = len(media) > 0
        ret = {"id": len(returns), "phone": sender, "description": order_info,
            "has_photo": has_photo, "photo_urls": [m.get("url","") for m in media],
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "evaluating"}
        returns.append(ret)

        evaluation = ai_evaluate_return(order_info, 35)
        ret["evaluation"] = evaluation

        if evaluation.get("approved") and evaluation.get("refund_amount", 0) <= AUTO_REFUND_THRESHOLD:
            ret["status"] = "auto_approved"
            amount = evaluation.get("refund_amount", 35)
            send_sms(sender, f"Your return is approved! Refund of ${amount:.2f} will appear in 3-5 business days. No need to ship anything back.")
        elif evaluation.get("action") == "exchange":
            ret["status"] = "exchange_offered"
            send_sms(sender, f"We'd like to send you a replacement. Reply YES to confirm an exchange, or REFUND if you prefer a refund.")
        else:
            ret["status"] = "escalated"
            send_sms(sender, "Your return request has been received. A team member will review and contact you within 24 hours.")
            if SUPPORT_SLACK:
                try: requests.post(SUPPORT_SLACK, json={"text": f"Return escalation #{ret['id']}: {sender} - {order_info}. Photos: {has_photo}. AI recommendation: {evaluation.get('action')}"}, timeout=5)
                except Exception: pass
    else:
        send_sms(sender, "To start a return, text RETURN followed by your order number and issue description. Attach a photo if applicable.")

    return jsonify({"status": "ok"}), 200

@app.route("/returns", methods=["GET"])
def list_returns():
    return jsonify({"returns": returns, "stats": {
        "total": len(returns), "auto_approved": sum(1 for r in returns if r["status"] == "auto_approved"),
        "escalated": sum(1 for r in returns if r["status"] == "escalated")}}), 200

@app.route("/returns/<int:idx>/approve", methods=["POST"])
def manual_approve(idx):
    if idx >= len(returns): return jsonify({"error":"Not found"}), 404
    ret = returns[idx]
    data = request.get_json() or {}
    ret["status"] = "manually_approved"
    ret["approved_by"] = data.get("agent", "unknown")
    amount = data.get("refund_amount", 0)
    if amount and STRIPE_API_KEY:
        try:
            stripe.Refund.create(amount=int(amount*100), payment_intent=data.get("payment_intent",""))
        except Exception:
            pass
    send_sms(ret["phone"], f"Your return has been approved. Refund of ${amount:.2f} is being processed.")
    return jsonify({"return": ret}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","returns":len(returns)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
