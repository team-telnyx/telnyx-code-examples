#!/usr/bin/env python3
"""Web demo for AI Real-Time Translation Bridge.

Shows the same translation engine from the phone-call app, but in a browser.
Uses the real Telnyx AI Inference API — same endpoint, same model, same prompt.

Run:
    cp .env.example .env   # add TELNYX_API_KEY
    pip install -r requirements.txt
    python app.py          # open http://localhost:5001
"""
import os
import requests
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "zai-org/GLM-5.1-FP8")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

LANG_CODES = {
    "English": "en-US", "Spanish": "es-US", "French": "fr-FR",
    "German": "de-DE", "Italian": "it-IT", "Portuguese": "pt-BR",
    "Hindi": "hi-IN", "Arabic": "ar-SA", "Chinese": "zh-CN",
    "Japanese": "ja-JP", "Korean": "ko-KR", "Russian": "ru-RU",
}


@app.route("/")
def index():
    return render_template(
        "index.html",
        languages=LANG_CODES,
        api_key_set=bool(TELNYX_API_KEY),
    )


@app.route("/translate", methods=["POST"])
def translate():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400

    text = (data.get("text") or "").strip()
    from_lang = data.get("from_lang", "English")
    to_lang = data.get("to_lang", "Spanish")

    if not text:
        return jsonify({"error": "no text provided"}), 400
    if not TELNYX_API_KEY:
        return jsonify({"error": "TELNYX_API_KEY not set on server"}), 500

    try:
        resp = requests.post(
            INFERENCE_URL,
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": AI_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": f"Translate from {from_lang} to {to_lang}. Return ONLY the translation, nothing else.",
                    },
                    {"role": "user", "content": text},
                ],
                "max_tokens": 800,
                "temperature": 0.1,
            },
            timeout=30,
        )
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]
        translated = (msg.get("content") or "").strip()
        # Reasoning models (e.g. Kimi-K2.6) may put the answer in `reasoning`
        # when they run out of tokens. Fall back to extracting from there.
        if not translated and msg.get("reasoning"):
            import re
            reasoning = msg["reasoning"]
            # Look for quoted translation in the reasoning text
            m = re.search(r'"([^"]+)"', reasoning)
            if m:
                translated = m.group(1).strip()
        return jsonify({
            "original": text,
            "translated": translated,
            "from_lang": from_lang,
            "to_lang": to_lang,
            "from_code": LANG_CODES.get(from_lang, "en-US"),
            "to_code": LANG_CODES.get(to_lang, "es-US"),
        })
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": f"AI Inference error: {e}"}), 502
    except Exception as e:
        return jsonify({"error": f"Translation failed: {e}"}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok", "api_key_set": bool(TELNYX_API_KEY)})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(debug=False, host="127.0.0.1", port=port)
