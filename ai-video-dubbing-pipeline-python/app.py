#!/usr/bin/env python3
"""AI Video Dubbing Pipeline — upload audio, STT transcribes dialogue,
inference translates to target language and labels speakers, TTS generates
dubbed audio with speaker-matched voices. Full pipeline on Telnyx."""

import os, json, uuid, time, requests, threading
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_file, Response
import io
import time as _ttl_time

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Whisper STT model — multilingual for non-English source audio, distil for English-only.
STT_MODEL = os.getenv("STT_MODEL", "openai/whisper-large-v3-turbo")

# Voice mapping for dubbing — match source speaker characteristics to Telnyx TTS voices.
# These are real Telnyx KokoroTTS voice IDs (en-US timbre; the `language` parameter
# passed to TTS controls pronunciation for the target language).
VOICE_MAP = {
    "male_low": "Telnyx.KokoroTTS.am_onyx",
    "male_mid": "Telnyx.KokoroTTS.am_echo",
    "female_mid": "Telnyx.KokoroTTS.af_nova",
    "female_high": "Telnyx.KokoroTTS.af_heart",
    "neutral": "Telnyx.KokoroTTS.af_alloy",
}

SUPPORTED_LANGUAGES = {
    "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese",
    "it": "Italian", "ja": "Japanese", "ko": "Korean", "zh": "Chinese",
    "ar": "Arabic", "hi": "Hindi", "ru": "Russian", "nl": "Dutch",
    "sv": "Swedish", "pl": "Polish", "tr": "Turkish"
}

# Map our short lang codes to BCP-47 for STT `language` param.
STT_LANGUAGE_MAP = {
    "en": "en-US", "es": "es-ES", "fr": "fr-FR", "de": "de-DE",
    "pt": "pt-BR", "it": "it-IT", "ja": "ja-JP", "ko": "ko-KR",
    "zh": "zh-CN", "ar": "ar-SA", "hi": "hi-IN", "ru": "ru-RU",
    "nl": "nl-NL", "sv": "sv-SE", "pl": "pl-PL", "tr": "tr-TR"
}

jobs = {}  # job_id -> dubbing state
jobs_lock = threading.Lock()


def _start_ttl_cleanup(store, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            with jobs_lock:
                expired = [k for k, v in store.items()
                            if isinstance(v, dict) and v.get("_ts", 0) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()


_start_ttl_cleanup(jobs)


def inference(messages, max_tokens=4000):
    """Call Telnyx AI Inference (OpenAI-compatible chat completions)."""
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3
    }, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def transcribe_audio(audio_bytes, source_language="en"):
    """Transcribe audio using Telnyx STT (OpenAI-compatible transcription API).

    Returns segments with id, start, end, text. Note: the Telnyx STT API does
    NOT perform speaker diarization — speaker labeling is handled downstream
    by the LLM (see label_and_translate_segments).
    """
    bcp47 = STT_LANGUAGE_MAP.get(source_language, "en-US")
    resp = requests.post(f"{API}/ai/audio/transcriptions", headers={
        "Authorization": f"Bearer {TELNYX_API_KEY}"
    }, files={
        "file": ("audio.mp3", audio_bytes, "audio/mpeg")
    }, data={
        "model": STT_MODEL,
        "language": bcp47,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "segment"
    }, timeout=120)
    resp.raise_for_status()
    return resp.json()


def label_and_translate_segments(segments, source_lang, target_lang_name):
    """Use the LLM to label speakers AND translate in a single call.

    Since Telnyx STT does not diarize, we send all segments to the LLM and ask
    it to (a) assign a speaker label to each segment based on conversational
    context and (b) translate each segment to the target language. Returns a
    list of dicts: {speaker, original, translated, start, end}.
    """
    segment_texts = [
        {"id": i, "text": s.get("text", "").strip(), "start": s.get("start", 0), "end": s.get("end", 0)}
        for i, s in enumerate(segments)
    ]
    prompt = (
        f"You are a dubbing assistant. Below are {len(segment_texts)} transcribed audio segments "
        f"from a conversation in {source_lang}. For EACH segment:\n"
        f"1. Assign a speaker label (SPEAKER_0, SPEAKER_1, etc.) based on conversational context.\n"
        f"2. Translate the text to {target_lang_name}, preserving tone and meaning.\n\n"
        f"Return ONLY a JSON array (no markdown fences, no explanation) where each element is:\n"
        f'{{"id": <int>, "speaker": "SPEAKER_N", "translated": "<text in {target_lang_name}>"}}\n\n'
        f"Segments:\n{json.dumps(segment_texts, ensure_ascii=False)}"
    )
    raw = inference([
        {"role": "system", "content": "You are a translation and speaker-diarization engine. You always return valid JSON arrays, never prose."},
        {"role": "user", "content": prompt}
    ], max_tokens=4000)

    # Tolerate markdown fences if the model wraps output.
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        if raw.endswith("```"):
            raw = raw[:-3].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()

    try:
        labeled = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: if LLM JSON parse fails, label everything as SPEAKER_0
        # and translate each segment individually.
        labeled = []
        for i, seg in enumerate(segment_texts):
            translated = inference([
                {"role": "system", "content": f"Translate to {target_lang_name}. Return ONLY the translated text."},
                {"role": "user", "content": seg["text"]}
            ], max_tokens=500).strip()
            labeled.append({"id": i, "speaker": "SPEAKER_0", "translated": translated})

    # Merge labeled results with original segment timing/text.
    labeled_by_id = {item["id"]: item for item in labeled} if isinstance(labeled, list) else {}
    result = []
    for i, seg in enumerate(segment_texts):
        lab = labeled_by_id.get(i, {"speaker": "SPEAKER_0", "translated": seg["text"]})
        result.append({
            "speaker": lab.get("speaker", "SPEAKER_0"),
            "original": seg["text"],
            "translated": lab.get("translated", seg["text"]),
            "start": seg["start"],
            "end": seg["end"]
        })
    return result


def tts_generate(text, voice, language):
    """Generate speech audio via Telnyx TTS. Returns raw audio bytes (mp3)."""
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "text": text,
        "voice": voice,
        "language": language,
        "output_type": "binary_output",
        "provider": "telnyx"
    }, timeout=30)
    resp.raise_for_status()
    return resp.content


def _run_pipeline(job_id, audio_bytes, source_lang, target_lang):
    """Background worker: transcribe → label+translate → synthesize."""
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "transcribing"

        transcription = transcribe_audio(audio_bytes, source_lang)
        segments = transcription.get("segments", [])
        if not segments and transcription.get("text"):
            segments = [{"text": transcription["text"], "start": 0, "end": 0}]

        with jobs_lock:
            jobs[job_id]["transcript"] = {
                "text": transcription.get("text", ""),
                "segments": [{"start": s.get("start", 0), "end": s.get("end", 0),
                               "text": s.get("text", "")} for s in segments],
            }
            jobs[job_id]["status"] = "translating"

        translated = label_and_translate_segments(
            segments, source_lang, SUPPORTED_LANGUAGES[target_lang]
        )

        with jobs_lock:
            jobs[job_id]["translated_segments"] = translated
            jobs[job_id]["status"] = "synthesizing"

        # Assign a distinct voice to each speaker.
        speaker_voices = {}
        available_voices = list(VOICE_MAP.values())
        audio_chunks = []
        for seg in translated:
            speaker = seg["speaker"]
            if speaker not in speaker_voices:
                idx = len(speaker_voices) % len(available_voices)
                speaker_voices[speaker] = available_voices[idx]

            voice = speaker_voices[speaker]
            audio = tts_generate(seg["translated"], voice=voice, language=target_lang)
            audio_chunks.append(audio)
            with jobs_lock:
                jobs[job_id]["dubbed_segments"].append({
                    "speaker": speaker,
                    "voice": voice,
                    "text": seg["translated"],
                    "audio_size_bytes": len(audio),
                    "start": seg["start"],
                    "end": seg["end"]
                })

        # Concatenate audio chunks (byte-level MP3 concat — fine for a demo).
        full_audio = b"".join(audio_chunks)
        with jobs_lock:
            jobs[job_id]["audio_bytes"] = full_audio
            jobs[job_id]["speaker_voice_map"] = speaker_voices
            jobs[job_id]["status"] = "complete"
            jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()

    except Exception as e:
        app.logger.exception("Dubbing pipeline failed for job %s", job_id)
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = str(e)


@app.route("/dub", methods=["POST"])
def start_dubbing():
    """Upload audio and start the dubbing pipeline asynchronously.

    Accepts multipart form with 'audio' file and 'target_language' field.
    Optionally 'source_language' (default: en). Returns 202 with the job_id.
    """
    if "audio" not in request.files:
        return jsonify({"error": "Upload an audio file as 'audio'"}), 400

    target_lang = request.form.get("target_language", "es")
    source_lang = request.form.get("source_language", "en")

    if target_lang not in SUPPORTED_LANGUAGES:
        return jsonify({
            "error": f"Unsupported target language: {target_lang}",
            "supported": SUPPORTED_LANGUAGES
        }), 400
    if source_lang not in SUPPORTED_LANGUAGES and source_lang != "en":
        return jsonify({
            "error": f"Unsupported source language: {source_lang}",
            "supported": {"en": "English", **SUPPORTED_LANGUAGES}
        }), 400

    audio_file = request.files["audio"]
    audio_bytes = audio_file.read()

    job_id = f"dub-{uuid.uuid4().hex[:8]}"
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "source_language": source_lang,
            "target_language": target_lang,
            "target_language_name": SUPPORTED_LANGUAGES[target_lang],
            "created_at": datetime.utcnow().isoformat(),
            "_ts": _ttl_time.time(),
            "transcript": None,
            "translated_segments": [],
            "dubbed_segments": [],
            "audio_bytes": None,
            "speaker_voice_map": {},
            "error": None
        }

    # Run the pipeline in a background thread so the HTTP request returns fast.
    thread = threading.Thread(
        target=_run_pipeline,
        args=(job_id, audio_bytes, source_lang, target_lang),
        daemon=True
    )
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "source_language": source_lang,
        "target_language": f"{target_lang} ({SUPPORTED_LANGUAGES[target_lang]})",
        "message": "Pipeline started. Poll GET /dub/<job_id> for status."
    }), 202


@app.route("/dub/<job_id>", methods=["GET"])
def get_job(job_id):
    """Get dubbing job status and results (without the audio payload)."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        # Return a copy without large/internal fields.
        safe = {k: v for k, v in job.items() if k not in ("audio_bytes", "_ts")}
    return jsonify(safe)


@app.route("/dub/<job_id>/audio", methods=["GET"])
def get_audio(job_id):
    """Download the dubbed audio track (mp3) once the job is complete."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        if job["status"] != "complete":
            return jsonify({"error": f"Job not complete (status: {job['status']})"}), 409
        audio = job.get("audio_bytes")
    if not audio:
        return jsonify({"error": "Audio not available"}), 500
    return Response(
        io.BytesIO(audio),
        mimetype="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename={job_id}.mp3"}
    )


@app.route("/dub/<job_id>/transcript", methods=["GET"])
def get_transcript(job_id):
    """Get side-by-side original and translated transcript."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        translated = job.get("translated_segments", [])
        source = job["source_language"]
        target = job["target_language"]

    side_by_side = []
    for seg in translated:
        side_by_side.append({
            "speaker": seg["speaker"],
            "original": seg["original"],
            "translated": seg["translated"],
            "timestamp": f"{seg['start']:.1f}s - {seg['end']:.1f}s"
        })

    return jsonify({
        "job_id": job_id,
        "source": source,
        "target": target,
        "segments": side_by_side
    })


@app.route("/languages", methods=["GET"])
def list_languages():
    """List supported dubbing target languages."""
    return jsonify({"languages": SUPPORTED_LANGUAGES})


@app.route("/jobs", methods=["GET"])
def list_jobs():
    """List all dubbing jobs (metadata only)."""
    with jobs_lock:
        result = [{
            "id": j["id"],
            "status": j["status"],
            "source": j["source_language"],
            "target": j["target_language"],
            "segments": len(j.get("dubbed_segments", [])),
            "created_at": j["created_at"]
        } for j in jobs.values()]
    return jsonify({"jobs": result})


@app.route("/health", methods=["GET"])
def health():
    with jobs_lock:
        active = sum(1 for j in jobs.values() if j["status"] not in ("complete", "failed"))
        total = len(jobs)
    return jsonify({
        "status": "ok",
        "total_jobs": total,
        "active": active,
        "supported_languages": len(SUPPORTED_LANGUAGES),
        "version": "1.0.0"
    })


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
