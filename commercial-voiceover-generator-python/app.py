#!/usr/bin/env python3
"""Commercial Voice-Over Generator — provide product name, target audience,
and tone. AI writes the script with timing marks, TTS renders multiple
voice options, delivers via SMS for client approval."""

import os, json, uuid, requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

SPOT_LENGTHS = {
    "15s": {"words": 40, "desc": "Pre-roll, bumper, social"},
    "30s": {"words": 80, "desc": "Standard broadcast/streaming"},
    "60s": {"words": 160, "desc": "Long-form, storytelling"},
}

TONES = ["professional", "playful", "urgent", "luxurious", "friendly", "edgy", "inspirational"]

campaigns = {}

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



def inference(messages, max_tokens=2000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def tts_generate(text, voice="Telnyx.KokoroTTS.af_nova"):
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice, "text": text
    }, timeout=30)
    resp.raise_for_status()
    return resp.content


def send_sms(to, text):
    try:
        requests.post(f"{API}/messages", headers=HEADERS, json={
            "from": MAIN_NUMBER, "to": to, "text": text,
            "messaging_profile_id": MESSAGING_PROFILE_ID
        }, timeout=10)
        return True
    except Exception:
        return False


@app.route("/commercials/generate", methods=["POST"])
def generate_commercial():
    """Generate a commercial voice-over from a product brief.

    AI writes the script, TTS renders in multiple voices, SMS notifies client.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    product = data.get("product", "")
    audience = data.get("audience", "general consumers")
    tone = data.get("tone", "professional")
    length = data.get("length", "30s")
    cta = data.get("cta", "")
    client_phone = data.get("client_phone", "")

    if not product:
        return jsonify({"error": "Provide 'product' name/description"}), 400

    spot = SPOT_LENGTHS.get(length, SPOT_LENGTHS["30s"])
    campaign_id = f"cm-{uuid.uuid4().hex[:8]}"

    campaigns[campaign_id] = {
        "id": campaign_id, "product": product, "status": "writing",
        "tone": tone, "length": length, "scripts": [],
        "renders": [], "created_at": datetime.utcnow().isoformat()
    }

    # Step 1: AI writes 3 script variations
    try:
        scripts_raw = inference([
            {"role": "system", "content": f"""You are an award-winning commercial copywriter. Write 3 voice-over script variations.

Product: {product}
Target audience: {audience}
Tone: {tone}
Spot length: {length} ({spot['words']} words max)
CTA: {cta if cta else 'Visit our website'}

For each script:
- Stay under {spot['words']} words
- Include timing marks: [0s], [5s], [10s], etc.
- End with a clear CTA
- Make each variation distinctly different in approach

Return JSON array with objects: {{"variation": "A"|"B"|"C", "approach": "one-word strategy", "script": "the VO script", "word_count": int}}"""},
            {"role": "user", "content": f"Write 3 commercial scripts for {product}"}
        ])
        scripts = json.loads(scripts_raw)
        campaigns[campaign_id]["scripts"] = scripts
    except json.JSONDecodeError:
        scripts = [{"variation": "A", "approach": "direct", "script": scripts_raw[:200], "word_count": len(scripts_raw.split())}]
        campaigns[campaign_id]["scripts"] = scripts
    except Exception as e:
        app.logger.exception("Script generation failed for campaign %s", campaign_id)
        campaigns[campaign_id]["status"] = "failed"
        campaigns[campaign_id]["error"] = "script generation failed"
        return jsonify(campaigns[campaign_id]), 500

    # Step 2: TTS render each script with best-fit voice
    campaigns[campaign_id]["status"] = "rendering"
    voice_picks = {
        "professional": "Telnyx.KokoroTTS.am_onyx", "playful": "Telnyx.KokoroTTS.af_bella", "urgent": "Telnyx.KokoroTTS.am_echo",
        "luxurious": "Telnyx.KokoroTTS.af_nova", "friendly": "Telnyx.KokoroTTS.af_nova", "edgy": "Telnyx.KokoroTTS.am_echo",
        "inspirational": "Telnyx.KokoroTTS.am_onyx"
    }
    primary_voice = voice_picks.get(tone, "Telnyx.KokoroTTS.af_nova")
    alt_voice = "Telnyx.KokoroTTS.af_bella" if primary_voice != "Telnyx.KokoroTTS.af_bella" else "Telnyx.KokoroTTS.am_echo"

    for script_data in scripts:
        script_text = script_data.get("script", "")
        # Remove timing marks for TTS
        clean = script_text
        for i in range(0, 61, 5):
            clean = clean.replace(f"[{i}s]", "")
        clean = clean.strip()

        for voice in [primary_voice, alt_voice]:
            try:
                audio = tts_generate(clean, voice=voice)
                campaigns[campaign_id]["renders"].append({
                    "variation": script_data.get("variation", "?"),
                    "voice": voice,
                    "audio_bytes": len(audio),
                    "script_preview": clean[:100]
                })
            except Exception as e:
                app.logger.exception(
                    "TTS render failed for campaign %s variation %s voice %s",
                    campaign_id, script_data.get("variation", "?"), voice)
                campaigns[campaign_id]["renders"].append({
                    "variation": script_data.get("variation", "?"),
                    "voice": voice, "error": "render failed"
                })

    # Step 3: SMS notify client
    if client_phone:
        best = campaigns[campaign_id]["scripts"][0] if campaigns[campaign_id]["scripts"] else {}
        sms_text = f"Your {length} commercial for {product} is ready!\n\nScript A ({best.get('approach', 'direct')}):\n\"{best.get('script', '')[:200]}\"\n\n{len(campaigns[campaign_id]['renders'])} audio renders available."
        send_sms(client_phone, sms_text)

    campaigns[campaign_id]["status"] = "complete"
    campaigns[campaign_id]["completed_at"] = datetime.utcnow().isoformat()

    return jsonify({
        "campaign_id": campaign_id,
        "status": "complete",
        "product": product,
        "scripts": len(scripts),
        "renders": len([r for r in campaigns[campaign_id]["renders"] if "audio_bytes" in r]),
        "length": length,
        "tone": tone,
        "scripts_preview": [{"variation": s["variation"], "approach": s["approach"], "word_count": s.get("word_count")} for s in scripts]
    }), 201


@app.route("/commercials/<campaign_id>", methods=["GET"])
def get_campaign(campaign_id):
    campaign = campaigns.get(campaign_id)
    if not campaign:
        return jsonify({"error": "Campaign not found"}), 404
    return jsonify(campaign)


@app.route("/commercials", methods=["GET"])
def list_campaigns():
    return jsonify({"campaigns": [{
        "id": c["id"], "product": c["product"], "status": c["status"],
        "tone": c["tone"], "length": c["length"],
        "renders": len(c["renders"]), "created_at": c["created_at"]
    } for c in campaigns.values()]})


@app.route("/options", methods=["GET"])
def list_options():
    return jsonify({"spot_lengths": SPOT_LENGTHS, "tones": TONES})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_campaigns": len(campaigns), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
