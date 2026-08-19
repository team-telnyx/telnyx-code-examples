#!/usr/bin/env python3
"""Voicemail Agent Demo — live dashboard for the audio-transcribe-summarize-sms pipeline.

Run locally:
    python demo/app.py

Then open http://localhost:8000 in your browser and upload a voicemail audio file.
The dashboard shows each pipeline stage as it happens:
  1. Upload → 2. Transcribe (STT) → 3. Summarize (LLM) → 4. SMS delivery
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from html import escape
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

# ── Config ──────────────────────────────────────────────────────────────────

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
SENDER_PHONE = os.getenv("SENDER_PHONE", "")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "")
STORAGE_REGION = os.getenv("STORAGE_REGION", "us-central-1")

STT_URL = "https://api.telnyx.com/v2/ai/audio/transcriptions"
LLM_URL = "https://api.telnyx.com/v2/ai/openai/chat/completions"
SMS_URL = "https://api.telnyx.com/v2/messages"

app = Flask(__name__)

# ── In-memory event log + pipeline state ────────────────────────────────────

_events: deque[dict[str, Any]] = deque(maxlen=100)
_log_lock = threading.Lock()
_current_pipeline: dict[str, Any] = {}


def log_event(kind: str, title: str, detail: str = "") -> None:
    evt = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "kind": kind,
        "title": title,
        "detail": detail,
    }
    with _log_lock:
        _events.append(evt)
    print(f"[{evt['ts']}] [{kind}] {title}" + (f" — {detail}" if detail else ""), flush=True)


def update_pipeline(status: str, **kwargs: Any) -> None:
    global _current_pipeline
    _current_pipeline.update({"status": status, **kwargs})


# ── Pipeline runner (background thread) ─────────────────────────────────────


def run_pipeline(audio_bytes: bytes, filename: str, recipient_phone: str) -> None:
    try:
        log_event("upload", "Audio received", f"{filename} ({len(audio_bytes)} bytes)")

        # Stage 1: Transcribe
        update_pipeline("transcribing")
        log_event("transcribe", "Sending to STT API", f"model: distil-whisper/distil-large-v2, file: {filename}")
        headers = {"Authorization": f"Bearer {TELNYX_API_KEY}"}
        files = {"file": (filename, audio_bytes, "audio/wav")}
        data = {"model": "distil-whisper/distil-large-v2"}
        stt_resp = requests.post(STT_URL, headers=headers, files=files, data=data, timeout=60)
        stt_resp.raise_for_status()
        stt_data = stt_resp.json()
        transcript = stt_data.get("text", "")
        log_event("transcribe", "Transcript received", transcript[:100] + "..." if len(transcript) > 100 else transcript)
        update_pipeline("summarizing", transcript=transcript)

        # Stage 2: Summarize
        system_prompt = (
            "You are a voicemail summarizer. Given a voicemail transcript, "
            "produce a concise SMS-friendly summary in 1-3 sentences. "
            "Include who called, what they wanted, and any action items. "
            "Keep it under 160 characters. Just the summary text."
        )
        llm_body = {
            "model": AI_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            "max_tokens": 100,
            "temperature": 0.3,
        }
        log_event("ai", "LLM summarizing", f"model: {AI_MODEL}")
        llm_resp = requests.post(
            LLM_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=llm_body,
            timeout=30,
        )
        llm_resp.raise_for_status()
        llm_data = llm_resp.json()
        summary = llm_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        log_event("ai", "Summary generated", summary)
        update_pipeline("sending", transcript=transcript, summary=summary)

        # Stage 3: SMS
        sms_body = {
            "from": SENDER_PHONE,
            "to": recipient_phone,
            "text": summary,
        }
        log_event("sms", "Sending SMS", f"to: {recipient_phone}")
        sms_resp = requests.post(
            SMS_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=sms_body,
            timeout=15,
        )
        sms_resp.raise_for_status()
        log_event("sms", "SMS delivered", f"from: {SENDER_PHONE} → {recipient_phone}")
        update_pipeline("done", transcript=transcript, summary=summary, smsSent=True, recipientPhone=recipient_phone)

    except Exception as e:
        err = str(e)
        log_event("error", "Pipeline failed", err)
        update_pipeline("error", error=err)


# ── Routes ──────────────────────────────────────────────────────────────────


@app.route("/health")
def health() -> tuple[Any, int]:
    return jsonify({"status": "ok"}), 200


@app.route("/clear", methods=["POST", "GET"])
def clear_events() -> tuple[Any, int]:
    with _log_lock:
        _events.clear()
    global _current_pipeline
    _current_pipeline = {}
    return jsonify({"status": "cleared"}), 200


@app.route("/upload", methods=["POST"])
def upload() -> tuple[Any, int]:
    file = request.files.get("file")
    phone = request.form.get("recipient_phone")

    if not file or not phone:
        return jsonify({"error": "Missing 'file' or 'recipient_phone'"}), 400
    if not TELNYX_API_KEY:
        return jsonify({"error": "TELNYX_API_KEY not set in .env"}), 500

    audio_bytes = file.read()
    threading.Thread(target=run_pipeline, args=(audio_bytes, file.filename, phone), daemon=True).start()
    return jsonify({"action": "queued", "filename": file.filename, "recipient_phone": phone}), 200


@app.route("/status")
def status() -> tuple[Any, int]:
    return jsonify(_current_pipeline), 200


@app.route("/events")
def events() -> tuple[Any, int]:
    with _log_lock:
        return jsonify(list(reversed(_events))), 200


@app.route("/")
def dashboard() -> str:
    with _log_lock:
        event_snapshot = list(reversed(_events))

    rows = "\n".join(_render_event_row(e) for e in event_snapshot)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voicemail Agent — Live Pipeline Dashboard</title>
<style>
  :root {{
    --bg: #fafafa; --card: #ffffff; --border: #e5e5e5; --text: #1a1a1a;
    --muted: #666; --accent: #4a1; --accent-bg: #e8f5e9;
    --stage-pending: #f1f5f9; --stage-pending-text: #475569;
    --stage-active: #fef3c7; --stage-active-text: #92400e;
    --stage-done: #d1fae5; --stage-done-text: #065f46;
    --stage-error: #fee2e2; --stage-error-text: #991b1b;
  }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 960px; margin: 0 auto; padding: 32px; color: var(--text); background: var(--bg); }}
  h1 {{ font-size: 24px; margin: 0 0 4px; }}
  .sub {{ color: var(--muted); font-size: 14px; margin-bottom: 24px; }}
  .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px;
          padding: 20px; margin-bottom: 20px; }}
  .card h2 {{ font-size: 16px; margin: 0 0 16px; font-weight: 600; }}
  label {{ display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--muted); }}
  input[type=file], input[type=tel] {{ width: 100%; padding: 10px 12px; border: 1px solid var(--border);
          border-radius: 6px; font-size: 14px; margin-bottom: 14px; font-family: inherit; }}
  button {{ background: var(--accent); color: white; border: none; padding: 12px 24px;
           border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }}
  button:hover {{ opacity: 0.9; }}
  button:disabled {{ opacity: 0.5; cursor: not-allowed; }}
  .stages {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }}
  .stage {{ padding: 14px; border-radius: 6px; text-align: center; font-size: 12px;
           font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
           background: var(--stage-pending); color: var(--stage-pending-text); }}
  .stage.active {{ background: var(--stage-active); color: var(--stage-active-text); }}
  .stage.done {{ background: var(--stage-done); color: var(--stage-done-text); }}
  .stage.error {{ background: var(--stage-error); color: var(--stage-error-text); }}
  .stage-num {{ display: block; font-size: 18px; margin-bottom: 4px; }}
  pre {{ background: #f7f7f7; padding: 12px; border-radius: 6px; font-size: 13px;
        white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto;
        margin: 0; font-family: 'SF Mono', Monaco, monospace; }}
  .meta-line {{ font-size: 13px; color: var(--muted); margin-bottom: 8px; }}
  .meta-line b {{ color: var(--text); }}
  .empty {{ color: #999; font-style: italic; }}
  .error-text {{ color: var(--stage-error-text); font-weight: 600; }}
  table {{ width: 100%; border-collapse: collapse; background: var(--card);
          border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }}
  th, td {{ padding: 10px 14px; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: top; }}
  th {{ background: #f7f7f7; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }}
  .kind {{ font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; }}
  .kind-upload {{ background: #e0e7ff; color: #3730a3; }}
  .kind-transcribe {{ background: #e8f0fe; color: #1a56db; }}
  .kind-ai {{ background: #fef3c7; color: #92400e; }}
  .kind-sms {{ background: #d1fae5; color: #065f46; }}
  .kind-error {{ background: #fee2e2; color: #991b1b; }}
  .ts {{ color: #999; font-family: 'SF Mono', Monaco, monospace; font-size: 12px; white-space: nowrap; }}
  .detail {{ color: #555; max-width: 500px; word-wrap: break-word; }}
</style>
</head>
<body>
  <h1>Voicemail Agent — Live Pipeline</h1>
  <div class="sub">Upload a voicemail → transcribe → AI summary → SMS. Powered by Telnyx AI Inference + Messaging.</div>

  <div class="card">
    <h2>1. Upload audio file</h2>
    <form id="uploadForm">
      <label for="file">Audio file (.wav, .mp3, .m4a)</label>
      <input type="file" id="file" name="file" accept="audio/*" required>
      <label for="phone">Recipient phone (E.164, e.g. +17177247292)</label>
      <input type="tel" id="phone" name="recipient_phone" placeholder="+17177247292" value="{escape(os.getenv('DEMO_RECIPIENT_PHONE', '+17177247292'))}" required>
      <button type="submit" id="submitBtn">Run pipeline</button>
      <button type="button" id="clearBtn" style="background:#666;margin-left:8px;">Clear events</button>
    </form>
    <div id="uploadStatus" style="margin-top:12px;font-size:13px;"></div>
  </div>

  <div class="card" id="pipelineCard" style="display:none;">
    <h2>2. Pipeline status</h2>
    <div class="stages">
      <div class="stage done" id="stage-upload"><span class="stage-num">1</span>Upload</div>
      <div class="stage" id="stage-transcribe"><span class="stage-num">2</span>Transcribe</div>
      <div class="stage" id="stage-summarize"><span class="stage-num">3</span>Summarize</div>
      <div class="stage" id="stage-notify"><span class="stage-num">4</span>SMS</div>
    </div>
    <div class="meta-line" id="statusLine">Status: <b>pending</b></div>
    <div class="meta-line" id="errorLine" style="display:none;"></div>
  </div>

  <div class="card" id="transcriptCard" style="display:none;">
    <h2>3. Transcript (speech-to-text)</h2>
    <pre id="transcript" class="empty">Waiting for transcription…</pre>
  </div>

  <div class="card" id="summaryCard" style="display:none;">
    <h2>4. AI Summary (LLM)</h2>
    <pre id="summary" class="empty">Waiting for summary…</pre>
  </div>

  <div class="card" id="smsCard" style="display:none;">
    <h2>5. SMS delivery</h2>
    <div class="meta-line" id="smsLine">SMS status: <b>pending</b></div>
  </div>

  <div class="card">
    <h2>Event log</h2>
    <table>
      <thead><tr><th>Time (UTC)</th><th>Stage</th><th>What happened</th><th>Detail</th></tr></thead>
      <tbody id="eventLog">
        {rows if rows else '<tr><td colspan="4" style="text-align:center;padding:32px;color:#999;">No events yet — upload an audio file to begin.</td></tr>'}
      </tbody>
    </table>
  </div>

<script>
const form = document.getElementById('uploadForm');
const submitBtn = document.getElementById('submitBtn');
const uploadStatus = document.getElementById('uploadStatus');
const pipelineCard = document.getElementById('pipelineCard');
const transcriptCard = document.getElementById('transcriptCard');
const summaryCard = document.getElementById('summaryCard');
const smsCard = document.getElementById('smsCard');
const eventLog = document.getElementById('eventLog');
let pollTimer = null;
let eventPollTimer = null;

function setStage(name, cls) {{
  const el = document.getElementById('stage-' + name);
  if (!el) return;
  el.className = 'stage ' + cls;
}}

document.getElementById('clearBtn').addEventListener('click', async () => {{
  await fetch('/clear', {{ method: 'POST' }});
  location.reload();
}});

form.addEventListener('submit', async (e) => {{
  e.preventDefault();
  submitBtn.disabled = true;
  uploadStatus.textContent = 'Uploading…';
  const fd = new FormData(form);
  try {{
    const res = await fetch('/upload', {{ method: 'POST', body: fd }});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    uploadStatus.innerHTML = 'Queued. File: <b>' + escapeHtml(data.filename) + '</b>';
    pipelineCard.style.display = 'block';
    setStage('transcribe', 'active');
    pollStatus();
    pollEvents();
  }} catch (err) {{
    uploadStatus.innerHTML = '<span class="error-text">Error: ' + escapeHtml(err.message) + '</span>';
    submitBtn.disabled = false;
  }}
}});

function pollStatus() {{
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {{
    try {{
      const res = await fetch('/status');
      const s = await res.json();
      if (!s.status) return;
      updateUI(s);
      if (s.status === 'done' || s.status === 'error') {{
        clearInterval(pollTimer);
        pollTimer = null;
        submitBtn.disabled = false;
      }}
    }} catch (e) {{}}
  }}, 2000);
}}

function pollEvents() {{
  if (eventPollTimer) clearInterval(eventPollTimer);
  eventPollTimer = setInterval(async () => {{
    try {{
      const res = await fetch('/events');
      const evs = await res.json();
      eventLog.innerHTML = evs.length ? evs.map(e =>
        '<tr><td class="ts">' + escapeHtml(e.ts) + '</td>' +
        '<td><span class="kind kind-' + escapeHtml(e.kind) + '">' + escapeHtml(e.kind) + '</span></td>' +
        '<td>' + escapeHtml(e.title) + '</td>' +
        '<td class="detail">' + escapeHtml(e.detail) + '</td></tr>'
      ).join('') : '<tr><td colspan="4" style="text-align:center;padding:32px;color:#999;">No events yet.</td></tr>';
    }} catch (e) {{}}
  }}, 2000);
}}

function updateUI(s) {{
  const statusLine = document.getElementById('statusLine');
  const errorLine = document.getElementById('errorLine');
  statusLine.innerHTML = 'Status: <b>' + escapeHtml(s.status) + '</b>';

  if (s.transcript) {{
    setStage('transcribe', 'done');
    setStage('summarize', 'active');
    transcriptCard.style.display = 'block';
    document.getElementById('transcript').textContent = s.transcript;
    document.getElementById('transcript').className = '';
  }}
  if (s.summary) {{
    setStage('summarize', 'done');
    setStage('notify', 'active');
    summaryCard.style.display = 'block';
    document.getElementById('summary').textContent = s.summary;
    document.getElementById('summary').className = '';
    smsCard.style.display = 'block';
  }}
  if (s.status === 'sending') {{ setStage('notify', 'active'); }}
  if (s.status === 'done') {{
    setStage('notify', 'done');
    document.getElementById('smsLine').innerHTML = 'SMS sent to <b>' + escapeHtml(s.recipientPhone || '') + '</b> ✓';
  }}
  if (s.status === 'error') {{
    errorLine.style.display = 'block';
    errorLine.className = 'meta-line error-text';
    errorLine.textContent = 'Error: ' + (s.error || 'unknown');
    setStage('transcribe', s.transcript ? 'done' : 'error');
    setStage('summarize', s.summary ? 'done' : 'error');
    setStage('notify', 'error');
  }}
}}

function escapeHtml(s) {{
  return String(s || '').replace(/[&<>"']/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]));
}}
</script>
</body>
</html>"""


def _render_event_row(e: dict[str, Any]) -> str:
    kind = escape(e.get("kind", "info"))
    return (
        "<tr>"
        f'<td class="ts">{escape(e.get("ts", ""))}</td>'
        f'<td><span class="kind kind-{kind}">{kind}</span></td>'
        f'<td>{escape(e.get("title", ""))}</td>'
        f'<td class="detail">{escape(e.get("detail", ""))}</td>'
        "</tr>"
    )


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    log_event("info", "Voicemail Agent demo started", f"listening on {host}:{port}")
    if not TELNYX_API_KEY:
        log_event("error", "TELNYX_API_KEY not set", "Copy .env.example to .env and add your API key")
    if not SENDER_PHONE:
        log_event("error", "SENDER_PHONE not set", "Add your Telnyx SMS number to .env")
    app.run(debug=False, host=host, port=port)
