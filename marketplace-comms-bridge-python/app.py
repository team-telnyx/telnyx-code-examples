#!/usr/bin/env python3
"""Marketplace Comms Bridge - buyer texts about a listing, AI responds with details, facilitates anonymous buyer-seller connection via masked numbers, handles scheduling. Ops reviews flagged conversations."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
OPS_SLACK = os.getenv("OPS_SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
INFERENCE_URL = f"{API}/ai/chat/completions"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

listings = {
    "L001": {"title": "2019 Honda Civic", "price": 18500, "seller_phone": "+15559002001", "description": "45K miles, clean title, one owner"},
    "L002": {"title": "Leather Couch Set", "price": 800, "seller_phone": "+15559002002", "description": "Brown leather, 3-piece, excellent condition"},
}
conversations = []
flagged = []

def send_sms(to, text):
    requests.post(f"{API}/messages", headers=headers, json={"from": MAIN_NUMBER, "to": to, "text": text}, timeout=10)

def ai_moderate(text):
    try:
        resp = requests.post(INFERENCE_URL, headers=headers,
            json={"model": AI_MODEL, "messages": [
                {"role": "system", "content": "Check if this marketplace message contains: personal contact info being shared to bypass platform, scam patterns (wire transfer, Western Union, gift cards, timeout=10), abusive language, or off-platform transaction attempts. Reply JSON: {\"safe\": true/false, \"reason\": \"...\"}"},
                {"role": "user", "content": text}], "max_tokens": 80, "temperature": 0.1}, timeout=15)
        return json.loads(resp.json()["choices"][0]["message"]["content"].strip().strip("`").replace("json\n",""))
    except Exception:
        return {"safe": True, "reason": ""}

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

    # Check for listing inquiry
    if text.upper().startswith("LISTING ") or text.upper().startswith("L0"):
        listing_id = text.split()[-1].upper()
        listing = listings.get(listing_id)
        if listing:
            send_sms(sender, f"{listing['title']} - ${listing['price']:,}\n{listing['description']}\nReply ASK {listing_id} <your question> to message the seller.")
        else:
            send_sms(sender, "Listing not found. Check the listing ID and try again.")
        return jsonify({"status": "ok"}), 200

    # Relay message to seller (anonymized)
    if text.upper().startswith("ASK "):
        parts = text.split(" ", 2)
        if len(parts) >= 3:
            listing_id = parts[1].upper()
            message = parts[2]
            listing = listings.get(listing_id)
            if listing:
                moderation = ai_moderate(message)
                if moderation.get("safe"):
                    send_sms(listing["seller_phone"], f"[Marketplace] Buyer inquiry about {listing['title']}: {message}\nReply to respond (anonymized).")
                    conversations.append({"listing": listing_id, "buyer": sender, "seller": listing["seller_phone"],
                        "message": message, "direction": "buyer_to_seller", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
                else:
                    flagged.append({"sender": sender, "message": message, "reason": moderation.get("reason",""),
                        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
                    send_sms(sender, "Your message was flagged for review. Please keep all transactions on-platform for your safety.")
                    if OPS_SLACK:
                        try: requests.post(OPS_SLACK, json={"text": f"FLAGGED message from {sender}: {message} | Reason: {moderation.get('reason','')}"}, timeout=5)
                        except Exception: pass
    return jsonify({"status": "ok"}), 200

@app.route("/listings", methods=["GET"])
def list_listings():
    return jsonify({"listings": listings}), 200

@app.route("/conversations", methods=["GET"])
def list_conversations():
    return jsonify({"conversations": conversations[-50:]}), 200

@app.route("/flagged", methods=["GET"])
def list_flagged():
    return jsonify({"flagged": flagged}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok","conversations":len(conversations),"flagged":len(flagged)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
