#!/usr/bin/env python3
"""AI Phone Tree Builder — describe your business in English, AI creates a working phone system."""

import os, json, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

generated_trees = []

def call_inference(messages, max_tokens=800):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/generate", methods=["POST"])
def generate_phone_tree():
    """Describe your business, get a complete AI Assistant + TeXML phone tree."""
    data = request.get_json()
    description = data.get("description", "")
    if not description:
        return jsonify({"error": "Provide a business description"}), 400

    messages = [{"role": "system", "content": """You are a phone system architect. Given a business description, generate:
1. A Telnyx AI Assistant configuration (JSON) with name, instructions, greeting, voice, and insight_settings
2. A TeXML document (XML) for fallback IVR routing
3. Department list with extensions and transfer numbers

Return JSON with: assistant_config (object), texml (string), departments (list of {name, extension, description}), greeting_script (string)."""},
        {"role": "user", "content": description}]

    result_json = call_inference(messages)
    try:
        result = json.loads(result_json)
    except json.JSONDecodeError:
        result = {"raw_output": result_json}

    # Optionally create the assistant via API
    if data.get("deploy") and "assistant_config" in result:
        try:
            config = result["assistant_config"]
            config["model"] = AI_MODEL
            config.setdefault("telephony_settings", {"enabled": True})
            resp = requests.post(f"https://api.telnyx.com/v2/ai/assistants", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                json=config, timeout=15)
            if resp.ok:
                result["deployed_assistant_id"] = resp.json().get("data", {}).get("id")
        except requests.RequestException as e:
            result["deploy_error"] = str(e)

    generated_trees.append(result)
    return jsonify(result), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "trees_generated": len(generated_trees)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
