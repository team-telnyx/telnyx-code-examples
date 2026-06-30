#!/usr/bin/env python3
"""Number Lookup Lead Enrichment — CNAM and carrier lookup to qualify and enrich sales leads."""
import os, json, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "MiniMaxAI/MiniMax-M3-MXFP8")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
enriched_leads = []

def _extract_json(text):
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        s = s[start:end + 1]
    return s

def parse_json_response(result):
    payload = _extract_json(result)
    if not payload:
        return None
    return json.loads(payload)

def lookup_number(phone):
    try:
        resp = requests.get(f"https://api.telnyx.com/v2/number_lookup/{phone}", headers={"Authorization": f"Bearer {TELNYX_API_KEY}"}, timeout=10)
        if resp.ok:
            return resp.json().get("data", {})
    except Exception:
        pass
    return {}

def call_inference(messages, max_tokens=1500):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/enrich", methods=["POST"])
def enrich_lead():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    if not phone:
        return jsonify({"error": "phone_number required"}), 400
    lookup = lookup_number(phone)
    carrier = lookup.get("carrier") or {}
    cnam = lookup.get("caller_name") or {}
    portability = lookup.get("portability") or {}
    enrichment = {
        "phone": phone,
        "carrier_name": carrier.get("name"),
        "carrier_type": carrier.get("type"),
        "caller_name": cnam.get("caller_name"),
        "line_type": portability.get("line_type") or carrier.get("type"),
        "country": lookup.get("country_code"),
        "valid_number": lookup.get("valid_number"),
    }
    msgs = [{"role": "system", "content": "Score this lead based on phone data. Return only JSON, no prose, no markdown fences: lead_quality (hot/warm/cold), reasoning (string), is_mobile (boolean), is_voip (boolean), recommended_channel (sms/voice/email)."},
        {"role": "user", "content": json.dumps(enrichment)}]
    try:
        score = parse_json_response(call_inference(msgs))
        if score:
            enrichment["score"] = score
    except Exception:
        pass
    enriched_leads.append(enrichment)
    return jsonify(enrichment), 200

@app.route("/enrich/bulk", methods=["POST"])
def enrich_bulk():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    numbers = data.get("phone_numbers", [])
    results = []
    for phone in numbers[:50]:
        lookup = lookup_number(phone)
        carrier = lookup.get("carrier") or {}
        portability = lookup.get("portability") or {}
        results.append({
            "phone": phone,
            "carrier": carrier.get("name"),
            "type": portability.get("line_type") or carrier.get("type"),
            "country": lookup.get("country_code"),
            "valid": lookup.get("valid_number"),
        })
    return jsonify({"results": results, "total": len(results)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "enriched": len(enriched_leads)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
