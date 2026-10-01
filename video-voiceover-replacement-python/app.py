#!/usr/bin/env python3
"""Video Voice-Over Replacement — extract audio from existing content via STT,
AI rewrites/improves the script with professional voice direction,
TTS generates new voice-over track. Replace amateur VO with studio quality."""

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
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
STT_MODEL = os.getenv("STT_MODEL", "telnyx/asr")
BUCKET_NAME = os.getenv("BUCKET_NAME", "voiceovers")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Telnyx Cloud Storage is S3-compatible. Talk to it with the AWS SDK (boto3) pointed
# at the region-scoped Telnyx S3 endpoint — not a storage.telnyx.com REST endpoint.
# Auth uses the Telnyx API key as BOTH the access key and the secret key.
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)

REWRITE_MODES = {
    "polish": "Clean up grammar and pacing, keep meaning identical",
    "professional": "Rewrite for professional broadcast quality",
    "simplify": "Make simpler and more accessible, lower reading level",
    "energize": "Make more dynamic and engaging, add energy",
    "shorten": "Cut to half length while keeping all key points",
}

jobs = {}

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

_start_ttl_cleanup(jobs)



def inference(messages, max_tokens=4000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4
    }, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def transcribe(audio_bytes, language="en"):
    resp = requests.post(f"{API}/ai/audio/transcriptions", headers={
        "Authorization": f"Bearer {TELNYX_API_KEY}"
    }, files={"file": ("audio.mp3", audio_bytes, "audio/mpeg")},
    data={"model": STT_MODEL, "language": language, "timestamps": True},
    timeout=120)
    resp.raise_for_status()
    return resp.json()


def tts_generate(text, voice="Telnyx.KokoroTTS.af_nova"):
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice, "text": text
    }, timeout=60)
    resp.raise_for_status()
    return resp.content


def upload_to_storage(key, data, content_type="audio/mpeg"):
    """Store bytes in Telnyx Cloud Storage (S3-compatible) and return a presigned
    GET URL valid for 1 hour. Failures are logged, not leaked to callers."""
    try:
        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=data, ContentType=content_type)
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": key},
            ExpiresIn=3600,
        )
    except ClientError:
        app.logger.exception("Cloud Storage upload failed for key %s", key)
        raise


@app.route("/replace", methods=["POST"])
def replace_voiceover():
    """Upload audio with existing voice-over, get back improved version.

    Pipeline: STT extract → AI rewrite/improve → TTS re-record.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload audio file as 'audio'"}), 400

    mode = request.form.get("mode", "professional")
    voice = request.form.get("voice", "Telnyx.KokoroTTS.af_nova")
    language = request.form.get("language", "en")
    title = request.form.get("title", "VO Replacement")
    custom_notes = request.form.get("notes", "")

    if mode not in REWRITE_MODES:
        return jsonify({"error": f"Invalid mode. Options: {list(REWRITE_MODES.keys())}"}), 400

    audio_bytes = request.files["audio"].read()
    job_id = f"rep-{uuid.uuid4().hex[:8]}"

    jobs[job_id] = {
        "id": job_id, "title": title, "status": "transcribing",
        "mode": mode, "voice": voice,
        "created_at": datetime.utcnow().isoformat()
    }

    # Step 1: STT transcribe original
    try:
        result = transcribe(audio_bytes, language)
        original_text = result.get("text", "")
        jobs[job_id]["original_script"] = original_text
        jobs[job_id]["original_word_count"] = len(original_text.split())
    except Exception as e:
        app.logger.exception("Transcription failed for job %s", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "Transcription failed"
        return jsonify(jobs[job_id]), 500

    if not original_text.strip():
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "No speech detected"
        return jsonify(jobs[job_id]), 400

    # Step 2: AI rewrite
    jobs[job_id]["status"] = "rewriting"
    try:
        direction = REWRITE_MODES[mode]
        extra = f"\n\nAdditional notes from the client: {custom_notes}" if custom_notes else ""
        rewritten = inference([
            {"role": "system", "content": f"""You are a professional voice-over script editor. Rewrite this script.

Mode: {mode} — {direction}{extra}

Rules:
- This will be read aloud by TTS — make it sound natural when spoken
- Match the approximate timing of the original (similar word count for 'polish' and 'professional')
- Add natural breathing points
- Remove filler words, false starts, verbal tics
- Improve flow and clarity
- Return ONLY the new script"""},
            {"role": "user", "content": original_text}
        ])
        jobs[job_id]["improved_script"] = rewritten.strip()
        jobs[job_id]["improved_word_count"] = len(rewritten.split())
    except Exception as e:
        app.logger.exception("Rewrite failed for job %s", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "Rewrite failed"
        return jsonify(jobs[job_id]), 500

    # Step 3: TTS render
    jobs[job_id]["status"] = "rendering"
    try:
        new_audio = tts_generate(jobs[job_id]["improved_script"], voice=voice)
        jobs[job_id]["audio_bytes"] = len(new_audio)

        try:
            url = upload_to_storage(f"{job_id}/improved.mp3", new_audio)
            jobs[job_id]["storage_url"] = url
        except Exception as e:
            app.logger.exception("Storage upload failed for job %s", job_id)
            jobs[job_id]["storage_error"] = "Storage upload failed"
    except Exception as e:
        app.logger.exception("TTS rendering failed for job %s", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "TTS failed"
        return jsonify(jobs[job_id]), 500

    jobs[job_id]["status"] = "complete"
    jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

    return jsonify({
        "job_id": job_id,
        "status": "complete",
        "mode": mode,
        "voice": voice,
        "original_word_count": jobs[job_id]["original_word_count"],
        "improved_word_count": jobs[job_id]["improved_word_count"],
        "change_pct": round((jobs[job_id]["improved_word_count"] - jobs[job_id]["original_word_count"]) / max(jobs[job_id]["original_word_count"], 1) * 100, 1),
        "improved_script": jobs[job_id]["improved_script"][:500],
        "storage_url": jobs[job_id].get("storage_url")
    }), 201


@app.route("/replace/<job_id>", methods=["GET"])
def get_job(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/replace/<job_id>/compare", methods=["GET"])
def compare_scripts(job_id):
    """Side-by-side comparison of original and improved scripts."""
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "mode": job["mode"],
        "original": job.get("original_script", ""),
        "improved": job.get("improved_script", ""),
        "original_words": job.get("original_word_count", 0),
        "improved_words": job.get("improved_word_count", 0)
    })


@app.route("/modes", methods=["GET"])
def list_modes():
    return jsonify({"modes": REWRITE_MODES})


@app.route("/jobs", methods=["GET"])
def list_jobs():
    return jsonify({"jobs": [{
        "id": j["id"], "title": j["title"], "status": j["status"],
        "mode": j["mode"], "voice": j["voice"],
        "created_at": j["created_at"]
    } for j in jobs.values()]})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_jobs": len(jobs), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
