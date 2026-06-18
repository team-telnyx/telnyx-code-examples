#!/usr/bin/env python3
"""Fax to AI Document Processor — receive fax, AI extracts data, forwards structured summary."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
FAX_NUMBER = os.getenv("FAX_NUMBER")
FORWARD_EMAIL = os.getenv("FORWARD_EMAIL")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
processed_faxes = []

def call_inference(messages, max_tokens=400):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/webhooks/fax", methods=["POST"])
def handle_fax():
    payload = request.get_json()
    data = payload.get("data", {})
    event_type = data.get("event_type")
    if event_type == "fax.received":
        fax_id = data.get("fax_id")
        from_number = data.get("from")
        media_url = data.get("media_url")
        pages = data.get("page_count", 0)
        messages = [{"role": "system", "content": "A fax has been received. Classify the document type and extract key data. Return JSON: document_type (invoice/contract/medical_form/prescription/legal/other), sender (string), summary (2-3 sentences), key_fields (object of extracted values), priority (low/normal/urgent), action_required (string or null)."},
            {"role": "user", "content": f"Fax from {from_number}, {pages} pages. Fax ID: {fax_id}"}]
        try:
            analysis = call_inference(messages)
            result = json.loads(analysis)
        except Exception:
            result = {"document_type": "unknown", "summary": f"Fax received from {from_number}, {pages} pages"}
        processed = {"fax_id": fax_id, "from": from_number, "pages": pages, "analysis": result, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        processed_faxes.append(processed)
        if result.get("priority") == "urgent":
            try:
                requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                    json={"from": FAX_NUMBER, "to": FAX_NUMBER, "text": f"URGENT FAX from {from_number}: {result.get('summary', 'Review needed')}"}, timeout=10)
            except Exception:
                pass
        return jsonify({"status": "processed", "analysis": result}), 200
    return jsonify({"status": "ignored"}), 200

@app.route("/faxes", methods=["GET"])
def list_faxes():
    return jsonify({"faxes": processed_faxes[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "processed": len(processed_faxes)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
