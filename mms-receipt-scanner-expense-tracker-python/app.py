#!/usr/bin/env python3
"""MMS Receipt Scanner & Expense Tracker — text a photo of a receipt, AI extracts data and tracks expenses."""

import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BOT_NUMBER = os.getenv("BOT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

expenses = {}  # phone -> list of {vendor, amount, category, date, description}

def call_inference(messages, max_tokens=300):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": BOT_NUMBER, "to": to, "text": text}, timeout=10)
    except requests.RequestException as e:
        app.logger.error(f"SMS failed: {e}")

@app.route("/webhooks/messaging", methods=["POST"])
def handle_mms():
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip().lower()
    media = data.get("media", [])

    if not from_number:
        return jsonify({"status": "ignored"}), 200

    if from_number not in expenses:
        expenses[from_number] = []

    # Handle commands
    if text == "summary" or text == "report":
        user_expenses = expenses.get(from_number, [])
        if not user_expenses:
            send_sms(from_number, "No expenses tracked yet. Send a photo of a receipt to get started!")
            return jsonify({"status": "no_expenses"}), 200
        total = sum(e.get("amount", 0) for e in user_expenses)
        by_category = {}
        for e in user_expenses:
            cat = e.get("category", "other")
            by_category[cat] = by_category.get(cat, 0) + e.get("amount", 0)
        summary = f"Expense Summary ({len(user_expenses)} items)\nTotal: ${total:.2f}\n"
        for cat, amt in sorted(by_category.items(), key=lambda x: -x[1]):
            summary += f"  {cat}: ${amt:.2f}\n"
        send_sms(from_number, summary)
        return jsonify({"status": "summary_sent"}), 200

    # Handle receipt photo
    if media:
        media_url = media[0].get("url", "")
        if media_url:
            messages = [{"role": "system", "content": "Extract receipt data from the description. Return JSON: vendor (string), amount (float), category (food/transport/office/entertainment/other), date (string or null), items (list of strings)."},
                {"role": "user", "content": f"Receipt image received from {from_number}. The user also said: '{text}'. Analyze this as a receipt and extract the data. If the text contains amounts or vendor info, use that."}]
            try:
                result_json = call_inference(messages)
                result = json.loads(result_json)
                result["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                expenses[from_number].append(result)
                send_sms(from_number, f"Logged: ${result.get('amount', 0):.2f} at {result.get('vendor', 'Unknown')} ({result.get('category', 'other')}). Text 'summary' for your total.")
            except (json.JSONDecodeError, Exception):
                send_sms(from_number, "Couldn't read that receipt. Try a clearer photo or type the amount and vendor.")
            return jsonify({"status": "receipt_processed"}), 200

    # Handle text-based expense entry
    if text and any(c.isdigit() for c in text):
        messages = [{"role": "system", "content": "Parse this expense description. Return JSON: vendor (string), amount (float), category (food/transport/office/entertainment/other), description (string)."},
            {"role": "user", "content": text}]
        try:
            result_json = call_inference(messages)
            result = json.loads(result_json)
            result["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            expenses[from_number].append(result)
            send_sms(from_number, f"Logged: ${result.get('amount', 0):.2f} - {result.get('description', text)}")
        except Exception:
            send_sms(from_number, "Send a receipt photo or type something like '$42.50 lunch at Chipotle'")
    else:
        send_sms(from_number, "Send me a receipt photo or type an expense like '$25 cab ride'. Text 'summary' for your report.")

    return jsonify({"status": "handled"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "users": len(expenses), "total_receipts": sum(len(v) for v in expenses.values())}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
