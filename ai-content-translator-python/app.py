#!/usr/bin/env python3
"""AI Content Translator — file-upload STT + AI translate + REST TTS pipeline.

Upload an audio file. Telnyx STT transcribes it in the source language
(OpenAI Whisper via /v2/ai/audio/transcriptions). Telnyx AI Inference
translates the transcript (OpenAI-compatible chat completions).
Telnyx TTS generates a dubbed mp3 in the target language
(REST /v2/text-to-speech/speech with binary_output).

Returns the translated transcript and a URL you can use to download
the dubbed audio.

Endpoints:
  GET  /                            Polished UI (drag/drop, side-by-side, audio)
  POST /translate                   multipart upload: audio, source, target
  GET  /translate/<job_id>          job metadata + full transcripts
  GET  /translate/<job_id>/audio    stream dubbed mp3
  GET  /languages                   supported source/target languages + voices
  GET  /health                      service health

State is in-memory (dict) — fine for a single-process demo.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB upload cap

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "openai/gpt-4o")
STT_MODEL = os.getenv("STT_MODEL", "openai/whisper-large-v3-turbo")
TTS_VOICE_FALLBACK = os.getenv("TTS_VOICE", "AWS.Polly.Joanna-Neural")
TTS_FORMAT = os.getenv("TTS_FORMAT", "mp3")
TTS_SAMPLE_RATE = int(os.getenv("TTS_SAMPLE_RATE", "24000"))
TTS_CHUNK_CHARS = int(os.getenv("TTS_CHUNK_CHARS", "1500"))
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

API = "https://api.telnyx.com/v2"
HEADERS_JSON = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

LANGUAGES: dict[str, dict[str, str]] = {
    "en": {"name": "English", "voice": "AWS.Polly.Joanna-Neural"},
    "es": {"name": "Spanish", "voice": "AWS.Polly.Lucia-Neural"},
    "fr": {"name": "French", "voice": "AWS.Polly.Lea-Neural"},
    "de": {"name": "German", "voice": "AWS.Polly.Vicki-Neural"},
    "pt": {"name": "Portuguese", "voice": "AWS.Polly.Camila-Neural"},
    "it": {"name": "Italian", "voice": "AWS.Polly.Bianca-Neural"},
    "ja": {"name": "Japanese", "voice": "AWS.Polly.Kazuha-Neural"},
    "ko": {"name": "Korean", "voice": "AWS.Polly.Seoyeon-Neural"},
    "zh": {"name": "Chinese", "voice": "Azure.zh-CN-Xiaoxiao:DragonHDFlashLatestNeural"},
    "ar": {"name": "Arabic", "voice": "Azure.ar-SA-ZariyahNeural"},
    "hi": {"name": "Hindi", "voice": "Azure.hi-IN-AnanyaNeural"},
}

SUPPORTED_MIME = {
    "audio/mpeg", "audio/mp3", "audio/x-mpeg",
    "audio/wav", "audio/x-wav", "audio/wave",
    "audio/m4a", "audio/x-m4a", "audio/mp4",
    "audio/ogg", "audio/ogg; codecs=opus",
    "audio/flac", "audio/webm", "audio/aac",
}
SUPPORTED_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".aac"}

jobs: dict[str, dict[str, Any]] = {}
JOB_TTL = 7200


def _ttl_cleanup_loop() -> None:
    while True:
        time.sleep(300)
        cutoff = time.time() - JOB_TTL
        for job_id in [k for k, v in jobs.items() if v.get("_ts", 0) < cutoff]:
            jobs.pop(job_id, None)


threading.Thread(target=_ttl_cleanup_loop, daemon=True).start()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stt(audio_bytes: bytes, language: str, filename: str = "audio.mp3") -> dict[str, Any]:
    # Telnyx STT requires the uploaded filename to carry a known audio extension,
    # otherwise it returns 400 "Invalid file format". Preserve the original name
    # when it has a recognized extension, else fall back to ".mp3".
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in SUPPORTED_EXT:
        ext = ".mp3"
    upload_name = (filename or "audio") if ext in (filename or "") else f"audio{ext}"
    form_fields = {"model": STT_MODEL}
    if language and language != "auto":
        form_fields["language"] = language
    files = {"file": (upload_name, audio_bytes, "application/octet-stream")}
    resp = requests.post(
        f"{API}/ai/audio/transcriptions",
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
        files=files,
        data=form_fields,
        timeout=180,
    )
    resp.raise_for_status()
    return resp.json()


def _chat(messages: list[dict[str, str]], max_tokens: int = 2000) -> str:
    resp = requests.post(
        f"{API}/ai/chat/completions",
        headers=HEADERS_JSON,
        json={
            "model": AI_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    choice = data.get("choices", [{}])[0]
    msg = choice.get("message", {})
    content = (msg.get("content") or "").strip()
    if not content and msg.get("reasoning"):
        content = (msg.get("reasoning") or "").strip()
        m = re.search(r'"([^"]{10,})"', content, re.S)
        if m:
            content = m.group(1)
    return content


def _tts_chunk(text: str, voice: str) -> bytes:
    resp = requests.post(
        f"{API}/text-to-speech/speech",
        headers=HEADERS_JSON,
        json={
            "text": text,
            "voice": voice,
            "audio_format": TTS_FORMAT,
            "sample_rate": TTS_SAMPLE_RATE,
            "output_type": "binary_output",
        },
        timeout=120,
        stream=True,
    )
    resp.raise_for_status()
    buf = io.BytesIO()
    for chunk in resp.iter_content(chunk_size=8192):
        if chunk:
            buf.write(chunk)
    return buf.getvalue()


def _chunk_text(text: str, max_chars: int) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    parts = re.split(r"(?<=[.!?。！？])\s+", text)
    chunks: list[str] = []
    cur = ""
    for p in parts:
        if not p:
            continue
        if len(p) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            for i in range(0, len(p), max_chars):
                chunks.append(p[i : i + max_chars])
            continue
        if len(cur) + len(p) + 1 > max_chars:
            if cur:
                chunks.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        chunks.append(cur)
    return chunks


def _update_job(job_id: str, **fields: Any) -> None:
    job = jobs.get(job_id)
    if not job:
        return
    job.update(fields)
    job["_ts"] = time.time()


@app.route("/", methods=["GET"])
def index():
    return Response(_HTML_PAGE, mimetype="text/html")


@app.route("/translate", methods=["POST"])
def translate_content():
    if not TELNYX_API_KEY:
        return jsonify({"error": "TELNYX_API_KEY not configured on the server"}), 500

    if "audio" not in request.files:
        return jsonify({"error": "Upload audio file as 'audio' (multipart form field)"}), 400
    audio_file = request.files["audio"]
    if not audio_file or not audio_file.filename:
        return jsonify({"error": "audio file is missing or has no filename"}), 400

    filename = audio_file.filename
    ext = os.path.splitext(filename)[1].lower()
    mime = (audio_file.mimetype or "").split(";")[0].strip().lower()
    if mime and mime not in SUPPORTED_MIME and ext not in SUPPORTED_EXT:
        return jsonify(
            {
                "error": f"Unsupported file type: {mime or ext or 'unknown'}",
                "supported_mime": sorted(SUPPORTED_MIME),
                "supported_ext": sorted(SUPPORTED_EXT),
            }
        ), 400

    source = (request.form.get("source") or "auto").lower()
    target = (request.form.get("target") or "en").lower()

    if target not in LANGUAGES:
        return jsonify(
            {"error": f"Unsupported target language: {target}", "supported": sorted(LANGUAGES.keys())}
        ), 400
    if source not in LANGUAGES and source != "auto":
        return jsonify(
            {"error": f"Unsupported source language: {source}", "supported": sorted(LANGUAGES.keys()) + ["auto"]}
        ), 400

    audio_bytes = audio_file.read()
    if not audio_bytes:
        return jsonify({"error": "audio file is empty"}), 400

    job_id = f"tr-{uuid.uuid4().hex[:10]}"
    jobs[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "stage": "stt",
        "source": source,
        "target": target,
        "filename": filename,
        "created_at": _now_iso(),
        "original_transcript": "",
        "translated_transcript": "",
        "segments": [],
        "audio_ready": False,
        "audio_bytes": 0,
        "_ts": time.time(),
    }

    try:
        _update_job(job_id, stage="stt")
        stt_resp = _stt(audio_bytes, source, filename=filename)
        original_text = (stt_resp.get("text") or "").strip()
        if not original_text:
            _update_job(job_id, status="failed", stage="stt", error="No speech detected in audio")
            return jsonify(jobs[job_id]), 400
        _update_job(job_id, original_transcript=original_text)

        detected_source = source
        if source == "auto":
            detected_source = (stt_resp.get("language") or "").lower() or "en"
            if detected_source not in LANGUAGES:
                detected_source = "en"
            _update_job(job_id, source=detected_source)

        target_name = LANGUAGES[target]["name"]
        source_name = LANGUAGES.get(detected_source, {}).get("name", detected_source)

        _update_job(job_id, stage="translation")
        translation = _chat(
            [
                {
                    "role": "system",
                    "content": (
                        f"Translate the following {source_name} text to {target_name}. "
                        "Preserve meaning, tone, and natural speech patterns. "
                        "The result will be read aloud, so make it sound natural when spoken. "
                        "Return ONLY the translation. Do not include any preamble, notes, "
                        "or quotation marks around the whole text."
                    ),
                },
                {"role": "user", "content": original_text},
            ]
        )
        translated_text = translation.strip().strip('"').strip()
        if not translated_text:
            _update_job(job_id, status="failed", stage="translation", error="Translation returned empty content (try a different AI_MODEL)")
            return jsonify(jobs[job_id]), 502
        _update_job(job_id, translated_transcript=translated_text, stage="tts")

        voice = LANGUAGES[target]["voice"]
        chunks = _chunk_text(translated_text, TTS_CHUNK_CHARS)
        if not chunks:
            _update_job(job_id, status="failed", stage="tts", error="No text to synthesize")
            return jsonify(jobs[job_id]), 400

        audio_buffer = io.BytesIO()
        total_bytes = 0
        failed_chunks: list[int] = []
        for i, chunk in enumerate(chunks):
            try:
                audio = _tts_chunk(chunk, voice=voice)
            except Exception as exc:
                app.logger.warning("TTS failed on chunk %d/%d: %s", i + 1, len(chunks), exc)
                failed_chunks.append(i)
                continue
            audio_buffer.write(audio)
            total_bytes += len(audio)
            jobs[job_id]["segments"].append(
                {"index": i, "text": chunk[:300], "audio_bytes": len(audio)}
            )

        if total_bytes == 0:
            _update_job(
                job_id,
                status="failed",
                stage="tts",
                error="All TTS chunks failed (transcripts still available)",
            )
            return jsonify(jobs[job_id]), 502

        jobs[job_id]["audio_bytes_raw"] = audio_buffer.getvalue()
        jobs[job_id]["audio_bytes"] = total_bytes
        jobs[job_id]["audio_ready"] = True
        jobs[job_id]["failed_chunks"] = failed_chunks
        jobs[job_id]["stage"] = "done"

        if failed_chunks:
            jobs[job_id]["status"] = "partial"
            jobs[job_id]["error"] = f"{len(failed_chunks)} of {len(chunks)} TTS chunks failed (transcript + partial audio available)"
        else:
            jobs[job_id]["status"] = "complete"
        jobs[job_id]["completed_at"] = _now_iso()

        return jsonify(
            {
                "job_id": job_id,
                "status": jobs[job_id]["status"],
                "source": detected_source,
                "source_name": source_name,
                "target": target,
                "target_name": target_name,
                "original_length": len(original_text),
                "translated_length": len(translated_text),
                "audio_segments": len(jobs[job_id]["segments"]),
                "audio_bytes": total_bytes,
                "audio_url": f"/translate/{job_id}/audio",
                "transcript_url": f"/translate/{job_id}",
                "failed_chunks": failed_chunks,
                "original_transcript_preview": original_text[:600] + ("..." if len(original_text) > 600 else ""),
                "translated_transcript_preview": translated_text[:600] + ("..." if len(translated_text) > 600 else ""),
            }
        ), 201
    except requests.HTTPError as exc:
        app.logger.exception("Telnyx API error")
        upstream_body = ""
        try:
            upstream_body = exc.response.text[:400] if exc.response else ""
        except Exception:
            pass
        _update_job(
            job_id,
            status="failed",
            error=f"Telnyx API error: {exc.response.status_code if exc.response else exc} {upstream_body}",
        )
        return jsonify(jobs[job_id]), 502
    except Exception as exc:
        app.logger.exception("Translation pipeline failed for job %s", job_id)
        _update_job(job_id, status="failed", error=f"{type(exc).__name__}: {exc}")
        return jsonify(jobs[job_id]), 500


@app.route("/translate/<job_id>", methods=["GET"])
def get_translation(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "job not found"}), 404
    public = {k: v for k, v in job.items() if k not in ("audio_bytes_raw", "_ts")}
    return jsonify(public), 200


@app.route("/translate/<job_id>/audio", methods=["GET"])
def get_translated_audio(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "job not found"}), 404
    if not job.get("audio_ready") or not job.get("audio_bytes_raw"):
        return jsonify({"error": "audio not ready", "status": job.get("status"), "stage": job.get("stage")}), 409
    mime = "audio/mpeg" if TTS_FORMAT == "mp3" else f"audio/{TTS_FORMAT}"
    return Response(
        job["audio_bytes_raw"],
        mimetype=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{job_id}.{TTS_FORMAT}"',
            "Content-Length": str(len(job["audio_bytes_raw"])),
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "bytes",
        },
    )


@app.route("/languages", methods=["GET"])
def list_languages():
    return jsonify(
        {
            "languages": {code: {"name": meta["name"], "voice": meta["voice"]} for code, meta in LANGUAGES.items()},
            "supports_auto_detect": True,
            "stt_model": STT_MODEL,
            "ai_model": AI_MODEL,
        }
    ), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "jobs": len(jobs),
            "supported_languages": len(LANGUAGES),
            "ai_model": AI_MODEL,
            "stt_model": STT_MODEL,
            "tts_endpoint": "/v2/text-to-speech/speech",
            "configured": bool(TELNYX_API_KEY),
        }
    ), 200


_HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Content Translator — Telnyx</title>
<style>
:root {
  --bg:#0b0d10; --panel:#13171c; --panel-2:#1a1f26; --border:#262d36;
  --text:#e6e9ee; --muted:#8a93a0; --accent:#00e3aa; --accent-2:#0bd59b;
  --warn:#ffb86b; --err:#ff6b6b; --ok:#7cf59b;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin:0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(1200px 600px at 70% -10%, #142028 0%, transparent 60%), var(--bg);
  color: var(--text); min-height: 100vh;
}
.container { max-width: 1100px; margin: 0 auto; padding: 36px 20px 80px; }
header { margin-bottom: 28px; }
.brand { display:flex; align-items:center; gap:14px; }
.brand-mark {
  width:38px; height:38px; border-radius:10px;
  background: linear-gradient(135deg, var(--accent) 0%, #18a090 100%);
  display:flex; align-items:center; justify-content:center;
  font-weight:700; color:#06241d; font-size:18px;
  box-shadow: 0 6px 18px -8px rgba(0,227,170,.55);
}
.brand-text h1 { margin:0; font-size:22px; letter-spacing:-0.01em; }
.brand-text p { margin:2px 0 0; color: var(--muted); font-size:13px; }
.eyebrow { color: var(--accent); font-size:11px; letter-spacing:.16em; text-transform:uppercase; margin-bottom:6px; font-weight:600; }

.card {
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
  border:1px solid var(--border);
  border-radius:14px; padding:22px; margin-bottom:18px;
  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 18px 40px -28px rgba(0,0,0,.6);
}

.upload-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
.field { display:flex; flex-direction:column; gap:6px; }
.field label { font-size:11px; color: var(--muted); letter-spacing:.05em; text-transform:uppercase; font-weight:600; }
select, input[type=text] {
  background:#0e1318; border:1px solid var(--border); color:var(--text);
  padding:10px 12px; border-radius:8px; font-size:14px; min-width:160px;
  font-family: inherit;
}
select:focus, input:focus { outline:2px solid var(--accent); border-color:transparent; }

.dropzone {
  flex: 1 1 320px;
  border:2px dashed var(--border);
  border-radius:12px; padding:22px 18px; text-align:center;
  cursor:pointer; transition: all .18s ease;
  background: rgba(255,255,255,.01);
  position:relative;
}
.dropzone:hover { border-color: var(--accent); background: rgba(0,227,170,.04); }
.dropzone.dragover { border-color: var(--accent); background: rgba(0,227,170,.08); transform:scale(1.01); }
.dropzone .dz-icon { font-size:30px; margin-bottom:8px; opacity:.85; }
.dropzone .dz-label { font-size:14px; color:var(--text); }
.dropzone .dz-hint { font-size:12px; color:var(--muted); margin-top:4px; }
.dropzone input[type=file] { display:none; }
.file-pill {
  display:inline-flex; gap:8px; align-items:center; margin-top:10px;
  background:#1a2229; border:1px solid #2c3a44; color:var(--accent);
  padding:6px 12px; border-radius:999px; font-size:12px; font-family:var(--mono);
}
.file-pill button { background:transparent; border:0; color:var(--muted); cursor:pointer; font-size:14px; }
.file-pill button:hover { color: var(--err); }

button.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color:#04221b; border:0; padding:12px 22px; border-radius:10px;
  font-weight:600; font-size:14px; cursor:pointer;
  box-shadow: 0 10px 24px -14px rgba(0,227,170,.7);
  transition: transform .12s ease;
}
button.primary:hover { transform: translateY(-1px); }
button.primary:disabled { opacity:.5; cursor:not-allowed; transform:none; box-shadow:none; }
button.ghost {
  background:transparent; color:var(--text); border:1px solid var(--border);
  padding:8px 14px; border-radius:8px; font-size:13px; cursor:pointer;
}
button.ghost:hover { border-color: var(--accent); color: var(--accent); }

.progress { display:none; margin-top:18px; }
.progress.show { display:block; }
.step { display:flex; align-items:center; gap:10px; padding:8px 0; font-size:13px; color:var(--muted); }
.step .dot { width:10px; height:10px; border-radius:50%; background:#3a434f; transition: all .2s; }
.step.active .dot { background:var(--warn); box-shadow:0 0 0 4px rgba(255,184,107,.15); }
.step.active { color:var(--text); }
.step.done .dot { background:var(--ok); }
.step.done { color:var(--text); }
.step.error .dot { background:var(--err); }
.step.error { color:var(--err); }

.error-box {
  display:none; margin-top:16px; padding:14px 16px; border-radius:10px;
  background: rgba(255,107,107,.08); border:1px solid rgba(255,107,107,.35);
  color:var(--err); font-size:13px;
}
.error-box.show { display:block; }

.results { display:none; }
.results.show { display:block; }
.transcripts {
  display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-top:18px;
}
@media (max-width: 720px) { .transcripts { grid-template-columns: 1fr; } }
.panel-tile {
  background:#0e1318; border:1px solid var(--border); border-radius:10px; padding:14px;
}
.panel-tile h3 {
  margin:0 0 10px; font-size:11px; color:var(--muted);
  letter-spacing:.06em; text-transform:uppercase; font-weight:600;
  display:flex; align-items:center; gap:8px;
}
.panel-tile .lang-badge {
  background:rgba(0,227,170,.12); color:var(--accent);
  padding:2px 8px; border-radius:6px; font-size:11px; font-family:var(--mono);
}
.panel-tile pre {
  margin:0; white-space:pre-wrap; word-wrap:break-word; font-family:var(--mono);
  font-size:13px; line-height:1.55; color:var(--text);
}
.audio-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:16px; }
audio { width:100%; max-width:560px; }
.meta-row {
  margin-top:14px; display:flex; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--muted);
}
.meta-chip {
  background:#0e1318; border:1px solid var(--border); padding:5px 10px; border-radius:6px;
  font-family:var(--mono);
}
.curl-box {
  margin-top:14px; background:#0e1318; border:1px solid var(--border);
  border-radius:8px; padding:12px 14px; font-family:var(--mono); font-size:12px;
  color:var(--text); overflow-x:auto; white-space:pre;
}
.curl-box .copy-btn {
  float:right; background:#1a2229; border:1px solid var(--border); color:var(--accent);
  padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-family:inherit;
}
.curl-box .copy-btn:hover { background:#22303a; }
footer { text-align:center; color:var(--muted); font-size:12px; margin-top:30px; }
footer a { color:var(--accent); text-decoration:none; }
.hidden { display:none !important; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="brand">
      <div class="brand-mark">T</div>
      <div class="brand-text">
        <div class="eyebrow">Telnyx AI Inference</div>
        <h1>AI Content Translator</h1>
        <p>Upload audio &rarr; STT transcribes &rarr; AI translates &rarr; TTS dubs the audio. All on one private network.</p>
      </div>
    </div>
  </header>

  <div class="card">
    <div class="upload-row">
      <div class="field">
        <label for="source">Source language</label>
        <select id="source">
          <option value="auto" selected>Auto-detect</option>
        </select>
      </div>
      <div class="field">
        <label for="target">Target language</label>
        <select id="target"></select>
      </div>
      <div class="field" style="flex:1 1 320px;">
        <label>Audio file (mp3, wav, m4a, ogg, flac, webm &mdash; max 25 MB)</label>
        <div class="dropzone" id="dropzone">
          <div class="dz-icon">&#128226;</div>
          <div class="dz-label">Drag &amp; drop an audio file here, or click to choose</div>
          <div class="dz-hint">Spanish podcast clip works great for a first test</div>
          <input type="file" id="fileInput" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac">
          <div id="filePillContainer"></div>
        </div>
      </div>
      <div class="field">
        <button class="primary" id="translateBtn" disabled>Translate &rarr;</button>
      </div>
    </div>

    <div class="progress" id="progress">
      <div class="step" id="step-stt"><div class="dot"></div><span>1. Speech-to-text transcription</span></div>
      <div class="step" id="step-translate"><div class="dot"></div><span>2. AI translation</span></div>
      <div class="step" id="step-tts"><div class="dot"></div><span>3. Text-to-speech synthesis</span></div>
    </div>

    <div class="error-box" id="errorBox"></div>
  </div>

  <div class="card results" id="resultsCard">
    <div class="eyebrow">Result</div>
    <h2 id="resultTitle" style="margin:6px 0 4px; font-size:18px;"></h2>
    <div class="meta-row" id="metaRow"></div>

    <div class="audio-row">
      <audio id="audioPlayer" controls></audio>
      <a class="ghost" id="downloadLink" download>&#11015; Download mp3</a>
      <button class="ghost" id="newJobBtn">Translate another</button>
    </div>

    <div class="transcripts">
      <div class="panel-tile">
        <h3>Source transcript <span class="lang-badge" id="srcBadge"></span></h3>
        <pre id="srcTranscript"></pre>
      </div>
      <div class="panel-tile">
        <h3>Translated transcript <span class="lang-badge" id="tgtBadge"></span></h3>
        <pre id="tgtTranscript"></pre>
      </div>
    </div>

    <div class="curl-box">
      <button class="copy-btn" id="copyCurlBtn">Copy</button>
      <code id="curlCommand"></code>
    </div>
  </div>

  <footer>
    Built on <a href="https://developers.telnyx.com/docs/ai-inference" target="_blank" rel="noopener">Telnyx AI Inference</a>
    &middot; <a href="https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-content-translator-python" target="_blank" rel="noopener">View source on GitHub</a>
  </footer>
</div>

<script>
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const filePillContainer = document.getElementById('filePillContainer');
const translateBtn = document.getElementById('translateBtn');
const sourceSel = document.getElementById('source');
const targetSel = document.getElementById('target');
const progress = document.getElementById('progress');
const stepStt = document.getElementById('step-stt');
const stepTranslate = document.getElementById('step-translate');
const stepTts = document.getElementById('step-tts');
const errorBox = document.getElementById('errorBox');
const resultsCard = document.getElementById('resultsCard');
const audioPlayer = document.getElementById('audioPlayer');
const downloadLink = document.getElementById('downloadLink');
const newJobBtn = document.getElementById('newJobBtn');
const srcTranscript = document.getElementById('srcTranscript');
const tgtTranscript = document.getElementById('tgtTranscript');
const srcBadge = document.getElementById('srcBadge');
const tgtBadge = document.getElementById('tgtBadge');
const resultTitle = document.getElementById('resultTitle');
const metaRow = document.getElementById('metaRow');
const curlCommand = document.getElementById('curlCommand');
const copyCurlBtn = document.getElementById('copyCurlBtn');

let currentFile = null;

const LANGS = {
  en:"English", es:"Spanish", fr:"French", de:"German", pt:"Portuguese",
  it:"Italian", ja:"Japanese", ko:"Korean", zh:"Chinese", ar:"Arabic", hi:"Hindi"
};

// Populate language dropdowns
for (const [code,name] of Object.entries(LANGS)) {
  const o1 = document.createElement('option'); o1.value=code; o1.textContent=name;
  sourceSel.appendChild(o1);
  const o2 = document.createElement('option'); o2.value=code; o2.textContent=name;
  targetSel.appendChild(o2);
}
targetSel.value = 'en';

function setError(msg) {
  if (!msg) { errorBox.classList.remove('show'); errorBox.textContent=''; return; }
  errorBox.textContent = msg; errorBox.classList.add('show');
}
function resetSteps() {
  [stepStt, stepTranslate, stepTts].forEach(s => s.classList.remove('active','done','error'));
  progress.classList.remove('show');
}
function setStep(name, state) {
  const el = name==='stt'?stepStt : name==='translate'?stepTranslate : stepTts;
  el.classList.remove('active','done','error');
  el.classList.add(state);
}

function handleFile(file) {
  currentFile = file;
  filePillContainer.innerHTML = '';
  const pill = document.createElement('div');
  pill.className = 'file-pill';
  const sizeKb = (file.size/1024).toFixed(0);
  const sizeLabel = file.size > 1024*1024 ? (file.size/1024/1024).toFixed(1)+' MB' : sizeKb+' KB';
  pill.innerHTML = `<span>&#128206; ${file.name} &middot; ${sizeLabel}</span><button title="remove">&times;</button>`;
  pill.querySelector('button').onclick = (e) => {
    e.stopPropagation();
    currentFile = null; fileInput.value=''; filePillContainer.innerHTML='';
    translateBtn.disabled = true; setError('');
  };
  filePillContainer.appendChild(pill);
  translateBtn.disabled = false;
  setError('');
}

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

newJobBtn.addEventListener('click', () => {
  resultsCard.classList.remove('show');
  currentFile = null; fileInput.value=''; filePillContainer.innerHTML='';
  translateBtn.disabled = true; resetSteps(); setError('');
});

copyCurlBtn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(curlCommand.textContent); copyCurlBtn.textContent='Copied'; setTimeout(()=>copyCurlBtn.textContent='Copy',1500); }
  catch(e) { copyCurlBtn.textContent='Press Ctrl+C'; }
});

translateBtn.addEventListener('click', async () => {
  if (!currentFile) { setError('Please choose an audio file first'); return; }
  if (currentFile.size > 25*1024*1024) { setError('File is larger than 25 MB. Use a shorter clip.'); return; }
  setError(''); resetSteps(); progress.classList.add('show');
  resultsCard.classList.remove('show');
  translateBtn.disabled = true;

  const fd = new FormData();
  fd.append('audio', currentFile);
  fd.append('source', sourceSel.value);
  fd.append('target', targetSel.value);

  setStep('stt','active');
  try {
    const resp = await fetch('/translate', { method:'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok) {
      const stage = (data.stage || 'stt');
      setStep(stage === 'translation' ? 'translate' : (stage==='tts'?'tts':'stt'), 'error');
      setError(data.error || ('HTTP ' + resp.status));
      translateBtn.disabled = false;
      return;
    }
    setStep('stt','done');
    setStep('translate','done');
    setStep('tts', data.status==='partial' ? 'active' : 'done');

    // Fetch full transcripts
    const jobResp = await fetch('/translate/' + data.job_id);
    const job = await jobResp.json();

    srcTranscript.textContent = job.original_transcript || '';
    tgtTranscript.textContent = job.translated_transcript || '';
    srcBadge.textContent = (data.source || sourceSel.value) + ' &middot; ' + (data.source_name || LANGS[data.source] || 'auto');
    tgtBadge.textContent = data.target + ' &middot; ' + data.target_name;
    srcBadge.innerHTML = (data.source || sourceSel.value) + ' &middot; ' + (data.source_name || LANGS[data.source] || 'auto');
    tgtBadge.innerHTML = data.target + ' &middot; ' + data.target_name;

    const dur = ((job.audio_bytes || 0) / (24*1024)).toFixed(1);
    metaRow.innerHTML = '';
    const chips = [
      ['job', data.job_id],
      ['status', data.status],
      ['audio', ((data.audio_bytes||0)/1024).toFixed(0) + ' KB'],
      ['segments', (data.audio_segments||0)],
      ['chars', (data.translated_length||0)],
    ];
    if (data.failed_chunks && data.failed_chunks.length) chips.push(['failed_chunks', data.failed_chunks.length]);
    for (const [k,v] of chips) {
      const c = document.createElement('div'); c.className='meta-chip';
      c.textContent = k+': ' + v; metaRow.appendChild(c);
    }
    if (data.status === 'partial') {
      setError('Some TTS chunks failed (transcript + partial audio still available). ' + (data.error||''));
    }

    audioPlayer.src = '/translate/' + data.job_id + '/audio';
    audioPlayer.type = 'audio/mpeg';
    downloadLink.href = '/translate/' + data.job_id + '/audio';
    downloadLink.download = (data.job_id || 'translated') + '.mp3';
    resultTitle.textContent = 'Translated ' + (data.source_name||'source') + ' to ' + data.target_name;

    curlCommand.textContent =
      `curl -X POST ${location.origin}/translate \\\n  -F audio=@${currentFile.name} \\\n  -F source=${sourceSel.value} \\\n  -F target=${targetSel.value}`;

    resultsCard.classList.add('show');
    resultsCard.scrollIntoView({ behavior:'smooth', block:'start' });
  } catch (e) {
    setError('Network error: ' + e.message);
    [stepStt,stepTranslate,stepTts].forEach(s => s.classList.remove('active','done'));
    setStep('stt','error');
  } finally {
    translateBtn.disabled = false;
  }
});
</script>
</body>
</html>
"""


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT, threaded=True)
