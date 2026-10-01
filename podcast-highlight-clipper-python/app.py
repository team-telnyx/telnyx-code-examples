#!/usr/bin/env python3
"""Podcast Highlight Clipper — upload call recording or audio, STT + inference
identifies viral moments and quotable segments, TTS generates teaser intros
for each clip, SMS sends clips to distribution list."""

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
STT_MODEL = os.getenv("STT_MODEL", "telnyx/asr")
SLACK_WEBHOOK = os.getenv("SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

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

distribution_list = []


def inference(messages, max_tokens=2000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def transcribe(audio_bytes):
    resp = requests.post(f"{API}/ai/transcribe", headers={
        "Authorization": f"Bearer {TELNYX_API_KEY}"
    }, files={"file": ("audio.mp3", audio_bytes, "audio/mpeg")},
    data={"model": STT_MODEL, "language": "en", "timestamps": True, "diarize": True},
    timeout=120)
    resp.raise_for_status()
    return resp.json()


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


def notify_slack(msg):
    if SLACK_WEBHOOK:
        try:
            requests.post(SLACK_WEBHOOK, json={"text": msg}, timeout=5)
        except Exception:
            pass


@app.route("/clip", methods=["POST"])
def clip_highlights():
    """Upload audio and extract highlight clips.

    Pipeline: STT → AI finds viral moments → TTS teaser intros → SMS distribution.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload audio as 'audio'"}), 400

    title = request.form.get("title", "Recording")
    try:
        max_clips = int(request.form.get("max_clips", "5"))
    except (ValueError, TypeError):
        max_clips = 5
    max_clips = max(1, min(max_clips, 20))
    distribute = request.form.get("distribute", "false").lower() == "true"

    audio_bytes = request.files["audio"].read()
    job_id = f"clip-{uuid.uuid4().hex[:8]}"

    jobs[job_id] = {
        "id": job_id, "title": title, "status": "transcribing",
        "created_at": datetime.utcnow().isoformat(),
        "transcript": "", "highlights": [], "teasers": [],
        "distribution": {"sent": 0, "failed": 0}
    }

    # Step 1: Transcribe
    try:
        result = transcribe(audio_bytes)
        transcript = result.get("text", "")
        segments = result.get("segments", [])
        jobs[job_id]["transcript"] = transcript
        jobs[job_id]["segment_count"] = len(segments)
    except Exception as e:
        app.logger.exception("Transcription failed for job %s", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "transcription failed"
        return jsonify(jobs[job_id]), 500

    # Step 2: AI identifies viral/quotable moments
    jobs[job_id]["status"] = "analyzing"
    try:
        highlights_raw = inference([
            {"role": "system", "content": f"""Analyze this podcast/recording transcript and find the {max_clips} most clip-worthy moments.
For each highlight, return JSON array with objects:
- "quote": exact words (under 300 chars)
- "speaker": speaker label if identifiable
- "virality_score": 1-10 (how shareable is this?)
- "category": "insight" | "hot_take" | "funny" | "emotional" | "actionable" | "controversial"
- "teaser_hook": a 10-word hook that makes someone want to hear the full clip
- "context": one sentence explaining why this moment stands out

Rank by virality_score descending. Focus on: surprising insights, strong opinions, emotional moments, practical advice, and humor."""},
            {"role": "user", "content": transcript[:10000]}
        ])
        highlights = json.loads(highlights_raw)
        jobs[job_id]["highlights"] = highlights[:max_clips]
    except json.JSONDecodeError:
        jobs[job_id]["highlights"] = [{"quote": highlights_raw[:280], "virality_score": 5, "category": "insight", "teaser_hook": "Listen to this moment"}]
    except Exception as e:
        app.logger.exception("Highlight analysis failed for job %s", job_id)
        jobs[job_id]["error"] = "analysis failed"

    # Step 3: Generate TTS teaser intros for each highlight
    jobs[job_id]["status"] = "generating_teasers"
    voices = ["Telnyx.KokoroTTS.af_nova", "Telnyx.KokoroTTS.am_onyx", "Telnyx.KokoroTTS.am_echo", "Telnyx.KokoroTTS.af_bella", "Telnyx.KokoroTTS.af_alloy"]
    for i, highlight in enumerate(jobs[job_id]["highlights"]):
        try:
            hook = highlight.get("teaser_hook", "Check this out")
            teaser_text = f"{hook}... {highlight['quote'][:200]}"
            voice = voices[i % len(voices)]
            audio = tts_generate(teaser_text, voice=voice)
            jobs[job_id]["teasers"].append({
                "index": i,
                "hook": hook,
                "voice": voice,
                "category": highlight.get("category", "insight"),
                "virality_score": highlight.get("virality_score", 0),
                "audio_bytes": len(audio),
                "text": teaser_text
            })
        except Exception as e:
            app.logger.error("Teaser %s failed: %s", i, e)

    # Step 4: SMS distribution
    if distribute and distribution_list and jobs[job_id]["highlights"]:
        best = jobs[job_id]["highlights"][0]
        sms_text = f"🎧 Highlight from '{title}':\n\n\"{best['quote'][:200]}\"\n\n🔥 Virality: {best.get('virality_score', '?')}/10"
        for phone in distribution_list:
            if send_sms(phone, sms_text):
                jobs[job_id]["distribution"]["sent"] += 1
            else:
                jobs[job_id]["distribution"]["failed"] += 1

    jobs[job_id]["status"] = "complete"
    jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

    notify_slack(f"✂️ Clipped {len(jobs[job_id]['highlights'])} highlights from *{title}*")

    return jsonify({
        "job_id": job_id,
        "status": "complete",
        "highlights": len(jobs[job_id]["highlights"]),
        "teasers_generated": len(jobs[job_id]["teasers"]),
        "sms_sent": jobs[job_id]["distribution"]["sent"],
        "top_highlight": jobs[job_id]["highlights"][0] if jobs[job_id]["highlights"] else None
    }), 201


@app.route("/clip/<job_id>", methods=["GET"])
def get_job(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/distribution", methods=["POST"])
def add_to_distribution():
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone")
    if phone and phone not in distribution_list:
        distribution_list.append(phone)
    return jsonify({"total": len(distribution_list)})


@app.route("/jobs", methods=["GET"])
def list_jobs():
    return jsonify({"jobs": [{
        "id": j["id"], "title": j["title"], "status": j["status"],
        "highlights": len(j["highlights"]), "teasers": len(j["teasers"]),
        "created_at": j["created_at"]
    } for j in jobs.values()]})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_jobs": len(jobs), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
