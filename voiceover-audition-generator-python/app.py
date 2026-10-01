#!/usr/bin/env python3
"""Voice-Over Audition Generator — submit a script, hear it read by every
available TTS voice with AI-scored best-fit recommendations. Compare voices
side by side. Delivers top picks via SMS to decision-makers."""

import os, json, uuid, requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BUCKET_NAME = os.getenv("BUCKET_NAME", "voiceovers")
# Region selects the S3 endpoint host, e.g. us-central-1 -> us-central-1.telnyxcloudstorage.com
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Telnyx Cloud Storage is S3-compatible. Point boto3 at the region-scoped Telnyx
# endpoint and supply the Telnyx API key as BOTH the access key and the secret key.
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)

ALL_VOICES = [
    {"id": "Telnyx.KokoroTTS.af_nova", "name": "Nova", "traits": "warm, approachable, female"},
    {"id": "Telnyx.KokoroTTS.am_onyx", "name": "Onyx", "traits": "deep, authoritative, male"},
    {"id": "Telnyx.KokoroTTS.am_echo", "name": "Echo", "traits": "natural, conversational, male"},
    {"id": "Telnyx.KokoroTTS.af_bella", "name": "Shimmer", "traits": "bright, energetic, female"},
    {"id": "Telnyx.KokoroTTS.af_alloy", "name": "Alloy", "traits": "neutral, clean, balanced"},
]

auditions = {}

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

_start_ttl_cleanup(auditions)



def inference(messages, max_tokens=1000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4
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


def upload_to_storage(key, data):
    """Upload audio bytes to S3-compatible Telnyx Cloud Storage and return a
    time-limited presigned GET URL (valid 1 hour) for playback/review."""
    try:
        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=data, ContentType="audio/mpeg")
        return s3.generate_presigned_url(
            "get_object", Params={"Bucket": BUCKET_NAME, "Key": key}, ExpiresIn=3600
        )
    except ClientError:
        app.logger.exception("storage upload failed for key %s", key)
        raise


@app.route("/auditions/create", methods=["POST"])
def create_audition():
    """Submit a script and get TTS auditions from every voice with AI scoring.

    Generates audio for all voices, AI ranks best fit based on script content,
    optionally SMS top picks to decision-makers.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    script = data.get("script", "")
    project = data.get("project", "Untitled")
    context = data.get("context", "")  # e.g., "luxury car commercial", "kids app tutorial"
    notify_phones = data.get("notify", [])

    if not script:
        return jsonify({"error": "Provide 'script' text"}), 400

    audition_id = f"aud-{uuid.uuid4().hex[:8]}"
    auditions[audition_id] = {
        "id": audition_id, "project": project, "status": "rendering",
        "script": script, "context": context,
        "voices": [], "ranking": [], "created_at": datetime.utcnow().isoformat()
    }

    # Step 1: Render all voices
    for voice_cfg in ALL_VOICES:
        try:
            audio = tts_generate(script, voice=voice_cfg["id"])
            voice_result = {
                "voice_id": voice_cfg["id"],
                "voice_name": voice_cfg["name"],
                "traits": voice_cfg["traits"],
                "audio_bytes": len(audio)
            }

            try:
                key = f"{audition_id}/{voice_cfg['id']}.mp3"
                url = upload_to_storage(key, audio)
                voice_result["storage_url"] = url
            except Exception as e:
                app.logger.exception("storage upload failed for voice %s", voice_cfg["id"])
                voice_result["storage_error"] = "audio upload failed"

            auditions[audition_id]["voices"].append(voice_result)
        except Exception as e:
            app.logger.exception("voice rendering failed for voice %s", voice_cfg["id"])
            auditions[audition_id]["voices"].append({
                "voice_id": voice_cfg["id"],
                "voice_name": voice_cfg["name"],
                "error": "voice rendering failed"
            })

    # Step 2: AI ranks voices for this script
    auditions[audition_id]["status"] = "scoring"
    try:
        voice_list = "\n".join([f"- {v['name']}: {v['traits']}" for v in ALL_VOICES])
        context_note = f"\nContext: {context}" if context else ""
        ranking_raw = inference([
            {"role": "system", "content": f"""You are a professional voice casting director. Rank these TTS voices for the given script.

Available voices:
{voice_list}
{context_note}

Evaluate each voice on:
1. Tone match (does the voice suit the content?)
2. Authority (does it convey the right level of credibility?)
3. Engagement (would the target audience want to keep listening?)
4. Pacing fit (does the voice's natural rhythm work for this script?)

Return JSON array ranked best to worst, each with:
{{"voice_id": "...", "rank": 1, "score": 85, "reasoning": "one sentence why", "best_for": "what type of content this voice excels at"}}"""},
            {"role": "user", "content": script}
        ])
        ranking = json.loads(ranking_raw)
        auditions[audition_id]["ranking"] = ranking
    except json.JSONDecodeError:
        auditions[audition_id]["ranking"] = [{"voice_id": "Telnyx.KokoroTTS.af_nova", "rank": 1, "score": 80, "reasoning": ranking_raw[:200]}]
    except Exception as e:
        app.logger.exception("voice ranking failed for audition %s", audition_id)
        auditions[audition_id]["ranking_error"] = "voice ranking failed"

    # Step 3: SMS notify decision-makers with top pick
    if notify_phones and auditions[audition_id]["ranking"]:
        top = auditions[audition_id]["ranking"][0]
        sms_text = f"🎤 Voice audition for '{project}':\n\nTop pick: {top.get('voice_id', '?')} (score: {top.get('score', '?')}/100)\n{top.get('reasoning', '')}\n\n{len(ALL_VOICES)} voice samples ready for review."
        for phone in notify_phones:
            send_sms(phone, sms_text)

    auditions[audition_id]["status"] = "complete"
    auditions[audition_id]["completed_at"] = datetime.utcnow().isoformat()

    return jsonify({
        "audition_id": audition_id,
        "project": project,
        "status": "complete",
        "voices_rendered": len([v for v in auditions[audition_id]["voices"] if "audio_bytes" in v]),
        "top_pick": auditions[audition_id]["ranking"][0] if auditions[audition_id]["ranking"] else None,
        "full_ranking": auditions[audition_id]["ranking"]
    }), 201


@app.route("/auditions/<audition_id>", methods=["GET"])
def get_audition(audition_id):
    aud = auditions.get(audition_id)
    if not aud:
        return jsonify({"error": "Audition not found"}), 404
    return jsonify(aud)


@app.route("/auditions", methods=["GET"])
def list_auditions():
    return jsonify({"auditions": [{
        "id": a["id"], "project": a["project"], "status": a["status"],
        "voices": len(a["voices"]), "created_at": a["created_at"]
    } for a in auditions.values()]})


@app.route("/voices", methods=["GET"])
def list_voices():
    return jsonify({"voices": ALL_VOICES})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_auditions": len(auditions), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
