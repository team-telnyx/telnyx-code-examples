#!/usr/bin/env python3
"""Messaging Campaign A/B Test Optimizer — test SMS copy variants, AI picks winners, auto-scales."""
import os, json, time, secrets, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CAMPAIGN_NUMBER = os.getenv("CAMPAIGN_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
campaigns = {}
# Maps a recipient phone number -> (campaign_id, variant_index) so inbound
# replies can be attributed to the exact variant that was sent to that number.
recipient_attribution = {}

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

_start_ttl_cleanup(campaigns)


def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": CAMPAIGN_NUMBER, "to": to, "text": text, "messaging_profile_id": MESSAGING_PROFILE_ID}, timeout=10)
    except Exception as e:
        app.logger.error("SMS failed: %s", e)

@app.route("/campaigns", methods=["POST"])
def create_campaign():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    cid = f"CAMP-{int(time.time())}"
    campaigns[cid] = {"name": data.get("name", ""), "variants": [{"text": v, "sent": 0, "replies": 0, "conversions": 0} for v in data.get("variants", [])],
        "contacts": data.get("contacts", []), "status": "created"}
    return jsonify({"campaign_id": cid}), 200

@app.route("/campaigns/<cid>/send", methods=["POST"])
def send_campaign(cid):
    campaign = campaigns.get(cid)
    if not campaign:
        return jsonify({"error": "Not found"}), 404
    variants = campaign["variants"]
    for contact in campaign["contacts"]:
        variant_index = secrets.randbelow(len(variants))
        variant = variants[variant_index]
        send_sms(contact, variant["text"])
        variant["sent"] += 1
        # Record which variant this recipient was sent so an inbound reply
        # from this number can be attributed to the correct variant.
        recipient_attribution[contact] = (cid, variant_index)
    campaign["status"] = "sent"
    return jsonify({"status": "sent", "total": len(campaign["contacts"])}), 200

@app.route("/campaigns/<cid>/analyze", methods=["GET"])
def analyze_campaign(cid):
    campaign = campaigns.get(cid)
    if not campaign:
        return jsonify({"error": "Not found"}), 404
    msgs = [{"role": "system", "content": "Analyze A/B test results. Return JSON: winner (index), confidence (percentage), recommendation (string), suggested_next_test (string)."},
        {"role": "user", "content": json.dumps(campaign["variants"])}]
    analysis = call_inference(msgs)
    return jsonify({"variants": campaign["variants"], "analysis": analysis}), 200

@app.route("/webhooks/messaging", methods=["POST"])
def handle_reply():
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
    if data.get("event_type") == "message.received" and p.get("direction") == "inbound":
        # Read the inbound sender's number from the webhook payload. Telnyx
        # represents "from" as an object with a phone_number field.
        sender = p.get("from")
        from_number = sender.get("phone_number") if isinstance(sender, dict) else sender
        # Attribute the reply to the campaign/variant this number was sent.
        mapping = recipient_attribution.get(from_number) if from_number else None
        if mapping:
            cid, variant_index = mapping
            campaign = campaigns.get(cid)
            if campaign and 0 <= variant_index < len(campaign["variants"]):
                campaign["variants"][variant_index]["replies"] += 1
            else:
                app.logger.warning("Reply attribution miss for %s", from_number)
        else:
            # No mapping for this number; do not misattribute the reply.
            app.logger.info("Inbound reply from unknown number; not attributed")
    return jsonify({"status": "ok"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "campaigns": len(campaigns)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
