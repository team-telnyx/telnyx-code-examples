#!/usr/bin/env python3
"""Messaging Campaign A/B Test Optimizer — test SMS copy variants, AI picks winners, auto-scales."""
import os, json, time, random, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
CAMPAIGN_NUMBER = os.getenv("CAMPAIGN_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
campaigns = {}

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
        app.logger.error(f"SMS failed: {e}")

@app.route("/campaigns", methods=["POST"])
def create_campaign():
    data = request.get_json()
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
        variant = random.choice(variants)
        send_sms(contact, variant["text"])
        variant["sent"] += 1
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
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") == "message.received" and data.get("direction") == "inbound":
        for cid, campaign in campaigns.items():
            for variant in campaign["variants"]:
                variant["replies"] += 1
                break
            break
    return jsonify({"status": "ok"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "campaigns": len(campaigns)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
