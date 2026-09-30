#!/usr/bin/env python3
"""AI Voice-Over Studio — upload a script, select voice/style/pacing,
AI adds professional direction cues (pauses, emphasis, pacing), TTS renders
the voice-over, stores output in Cloud Storage. Supports multiple takes."""

import os, json, uuid, requests
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BUCKET_NAME = os.getenv("BUCKET_NAME", "voiceovers")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Telnyx Cloud Storage is S3-compatible: talk to it with boto3 pointed at the
# region-scoped Telnyx S3 endpoint. The Telnyx API key is used as BOTH the
# access key and the secret key.
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")
ENDPOINT_URL = f"https://{REGION}.telnyxcloudstorage.com"
PRESIGN_TTL = int(os.getenv("PRESIGN_TTL_SECONDS", "3600"))

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)

VOICES = {
    "warm_narrator": {"id": "Telnyx.KokoroTTS.af_nova", "desc": "Warm, approachable female — explainers, brand stories"},
    "authoritative": {"id": "Telnyx.KokoroTTS.am_onyx", "desc": "Deep, confident male — documentaries, corporate"},
    "conversational": {"id": "Telnyx.KokoroTTS.am_echo", "desc": "Natural, mid-range male — podcasts, tutorials"},
    "energetic": {"id": "Telnyx.KokoroTTS.af_bella", "desc": "Bright, upbeat female — ads, promos, social"},
    "neutral_pro": {"id": "Telnyx.KokoroTTS.af_alloy", "desc": "Clean, neutral — IVR, e-learning, medical"},
}

STYLES = {
    "commercial": "Energetic, persuasive, punchy. Short sentences. Build to a CTA.",
    "documentary": "Measured, authoritative, contemplative. Let facts breathe.",
    "explainer": "Clear, friendly, conversational. Like talking to a smart friend.",
    "dramatic": "Cinematic tension. Vary pacing. Pause before reveals.",
    "corporate": "Professional, confident, warm. No jargon. Inspire trust.",
    "elearning": "Patient, clear, encouraging. Pause after key concepts.",
}

projects = {}

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

_start_ttl_cleanup(projects)



def inference(messages, max_tokens=4000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4
    }, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def tts_generate(text, voice="Telnyx.KokoroTTS.af_nova"):
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice, "text": text
    }, timeout=60)
    resp.raise_for_status()
    return resp.content


def upload_to_storage(key, data):
    """Upload audio bytes to Telnyx Cloud Storage (S3-compatible) and return a
    time-limited presigned GET URL for playback/download."""
    try:
        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=data, ContentType="audio/mpeg")
        return s3.generate_presigned_url(
            "get_object", Params={"Bucket": BUCKET_NAME, "Key": key}, ExpiresIn=PRESIGN_TTL
        )
    except ClientError as e:
        app.logger.error("Cloud Storage upload failed for key %s: %s", key, e)
        raise


@app.route("/projects/create", methods=["POST"])
def create_project():
    """Create a voice-over project from a script.

    AI adds professional direction cues, TTS renders the voice-over,
    stores output in Cloud Storage.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    script = data.get("script", "")
    title = data.get("title", "Untitled VO")
    voice_key = data.get("voice", "warm_narrator")
    style = data.get("style", "explainer")
    takes = int(data.get("takes", 1))

    if not script:
        return jsonify({"error": "Provide 'script' text"}), 400

    voice_cfg = VOICES.get(voice_key, VOICES["warm_narrator"])
    style_direction = STYLES.get(style, STYLES["explainer"])

    project_id = f"vo-{uuid.uuid4().hex[:8]}"
    projects[project_id] = {
        "id": project_id, "title": title, "status": "directing",
        "voice": voice_key, "style": style,
        "original_script": script, "directed_script": "",
        "takes": [], "created_at": datetime.utcnow().isoformat()
    }

    # Step 1: AI adds professional direction cues
    try:
        directed = inference([
            {"role": "system", "content": f"""You are a professional voice-over director. Take this script and add direction cues for the voice talent.

Style: {style} — {style_direction}

Rules:
- Add [pause] for natural breathing points and dramatic beats
- Add [emphasis] before words that need stress
- Add [slow] or [faster] for pacing changes
- Break into numbered sections for recording
- Add a brief director's note at the top describing the overall tone
- Do NOT change the actual words — only add cues
- Keep the script readable

Return the directed script only."""},
            {"role": "user", "content": script}
        ])
        projects[project_id]["directed_script"] = directed
    except Exception as e:
        app.logger.exception("AI direction step failed for project %s", project_id)
        projects[project_id]["status"] = "failed"
        projects[project_id]["error"] = "Direction failed"
        return jsonify(projects[project_id]), 500

    # Step 2: TTS render — generate requested number of takes
    projects[project_id]["status"] = "rendering"
    # Strip direction cues for TTS (keep pauses as periods)
    clean_script = directed
    for cue in ["[pause]", "[emphasis]", "[slow]", "[faster]", "[beat]"]:
        clean_script = clean_script.replace(cue, "..." if cue == "[pause]" else "")

    for take_num in range(1, takes + 1):
        try:
            audio = tts_generate(clean_script, voice=voice_cfg["id"])
            take = {
                "take": take_num,
                "voice": voice_key,
                "voice_id": voice_cfg["id"],
                "audio_bytes": len(audio),
                "duration_est_sec": round(len(audio) / 16000, 1),
            }

            # Upload to Cloud Storage
            try:
                key = f"{project_id}/take-{take_num:02d}.mp3"
                url = upload_to_storage(key, audio)
                take["storage_url"] = url
            except Exception as e:
                app.logger.exception("Storage upload failed for project %s take %s", project_id, take_num)
                take["storage_error"] = "upload failed"

            projects[project_id]["takes"].append(take)
        except Exception as e:
            app.logger.exception("TTS render failed for project %s take %s", project_id, take_num)
            projects[project_id]["takes"].append({
                "take": take_num, "error": "render failed"
            })

    projects[project_id]["status"] = "complete"
    projects[project_id]["completed_at"] = datetime.utcnow().isoformat()

    return jsonify({
        "project_id": project_id,
        "title": title,
        "status": "complete",
        "voice": f"{voice_key} ({voice_cfg['desc']})",
        "style": style,
        "takes_rendered": len([t for t in projects[project_id]["takes"] if "audio_bytes" in t]),
        "directed_script_preview": directed[:300] + "..." if len(directed) > 300 else directed
    }), 201


@app.route("/projects/<project_id>/retake", methods=["POST"])
def retake(project_id):
    """Render additional takes with a different voice or style adjustment."""
    project = projects.get(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    voice_key = data.get("voice", project["voice"])
    voice_cfg = VOICES.get(voice_key, VOICES["warm_narrator"])

    script = project.get("directed_script") or project["original_script"]
    for cue in ["[pause]", "[emphasis]", "[slow]", "[faster]", "[beat]"]:
        script = script.replace(cue, "..." if cue == "[pause]" else "")

    take_num = len(project["takes"]) + 1

    try:
        audio = tts_generate(script, voice=voice_cfg["id"])
        take = {
            "take": take_num, "voice": voice_key,
            "voice_id": voice_cfg["id"], "audio_bytes": len(audio),
            "duration_est_sec": round(len(audio) / 16000, 1)
        }
        try:
            key = f"{project_id}/take-{take_num:02d}.mp3"
            url = upload_to_storage(key, audio)
            take["storage_url"] = url
        except Exception as e:
            app.logger.exception("Storage upload failed for project %s retake %s", project_id, take_num)
            take["storage_error"] = "upload failed"

        project["takes"].append(take)
        return jsonify(take), 201
    except Exception as e:
        app.logger.exception("Retake render failed for project %s", project_id)
        return jsonify({"error": "render failed"}), 500


@app.route("/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    project = projects.get(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(project)


@app.route("/projects", methods=["GET"])
def list_projects():
    return jsonify({"projects": [{
        "id": p["id"], "title": p["title"], "status": p["status"],
        "voice": p["voice"], "style": p["style"],
        "takes": len(p["takes"]), "created_at": p["created_at"]
    } for p in projects.values()]})


@app.route("/voices", methods=["GET"])
def list_voices():
    return jsonify({"voices": {k: v["desc"] for k, v in VOICES.items()}})


@app.route("/styles", methods=["GET"])
def list_styles():
    return jsonify({"styles": STYLES})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok", "total_projects": len(projects),
        "bucket": BUCKET_NAME, "version": "1.0.0"
    })


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
