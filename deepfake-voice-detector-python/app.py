#!/usr/bin/env python3
"""Deepfake Voice Detector — real-time synthetic speech detection on live calls using Telnyx media streaming and AI inference."""
import os
import json
import time
import base64
import struct
import hashlib
import requests
import threading
import telnyx
from collections import defaultdict
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()
app = Flask(__name__)
# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
ALERT_WEBHOOK = os.getenv("ALERT_WEBHOOK", "")
DETECTION_THRESHOLD = float(os.getenv("DETECTION_THRESHOLD", "0.75"))

INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
API = "https://api.telnyx.com/v2"

# In-memory session store
sessions = {}

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

_start_ttl_cleanup(sessions)


def encode_state(state: dict) -> str:
    """Stringify the state object and base64-encode it — the value Telnyx round-trips."""
    return base64.b64encode(json.dumps(state).encode()).decode()


def decode_state(payload: dict) -> dict:
    """Recover the state object echoed back on the webhook payload."""
    raw = payload.get("client_state")
    if not raw:
        return {}
    try:
        return json.loads(base64.b64decode(raw))
    except Exception:
        return {}


ANALYSIS_PROMPT = """You are a deepfake voice detection analyst. Analyze these audio characteristics from a live phone call and assess the probability of synthetic/AI-generated speech.

Audio features extracted:
{features}

Evaluate for these synthetic speech indicators:
1. Unnatural pitch consistency (real speech has micro-variations; TTS is too smooth)
2. Breathing pattern absence (real speakers breathe; deepfakes often don't)
3. Spectral flatness anomalies (synthetic audio has different spectral distribution)
4. Prosody regularity (too-perfect rhythm suggests synthesis)
5. Background noise coherence (real calls have consistent ambient noise; spliced audio doesn't)
6. Formant transition smoothness (natural speech has micro-jitter in vowel transitions)

Return a JSON object with:
- "score": float 0.0-1.0 (0=definitely human, 1=definitely synthetic)
- "confidence": float 0.0-1.0 (how confident in the assessment)
- "indicators": list of detected synthetic indicators
- "assessment": one of "human", "likely_human", "uncertain", "likely_synthetic", "synthetic"
- "reasoning": brief explanation

Return ONLY the JSON object, no other text."""


def extract_audio_features(audio_chunks):
    """Extract statistical features from raw audio samples for analysis."""
    if not audio_chunks:
        return {}

    all_samples = []
    for chunk in audio_chunks:
        try:
            samples = struct.unpack(f"<{len(chunk)//2}h", chunk)
            all_samples.extend(samples)
        except struct.error:
            continue

    if not all_samples:
        return {}

    n = len(all_samples)
    mean = sum(all_samples) / n
    variance = sum((s - mean) ** 2 for s in all_samples) / n
    std_dev = variance ** 0.5

    # Zero crossing rate (indicator of speech characteristics)
    zero_crossings = sum(1 for i in range(1, n) if (all_samples[i] >= 0) != (all_samples[i-1] >= 0))
    zcr = zero_crossings / n

    # Peak analysis
    abs_samples = [abs(s) for s in all_samples]
    peak = max(abs_samples)
    rms = (sum(s*s for s in all_samples) / n) ** 0.5

    # Crest factor (peak-to-RMS ratio; synthetic speech tends to have lower crest factor)
    crest_factor = peak / rms if rms > 0 else 0

    # Frame-level energy variance (synthetic speech has more uniform energy)
    frame_size = min(160, n // 10)  # ~20ms frames at 8kHz
    if frame_size > 0:
        frame_energies = []
        for i in range(0, n - frame_size, frame_size):
            frame = all_samples[i:i+frame_size]
            energy = sum(s*s for s in frame) / frame_size
            frame_energies.append(energy)
        if frame_energies:
            energy_mean = sum(frame_energies) / len(frame_energies)
            energy_var = sum((e - energy_mean)**2 for e in frame_energies) / len(frame_energies)
            energy_cv = (energy_var ** 0.5) / energy_mean if energy_mean > 0 else 0
        else:
            energy_cv = 0
    else:
        energy_cv = 0

    # Pitch regularity estimate via autocorrelation at speech frequencies
    # Check for suspiciously regular periodicity
    max_lag = min(400, n // 4)  # up to 20ms lag at 8kHz (50Hz fundamental)
    min_lag = 20  # ~400Hz at 8kHz
    autocorr_peaks = []
    if n > max_lag * 2:
        segment = all_samples[:max_lag * 4]
        for lag in range(min_lag, max_lag, 4):
            corr = sum(segment[i] * segment[i + lag] for i in range(len(segment) - lag))
            autocorr_peaks.append((lag, corr))
        autocorr_peaks.sort(key=lambda x: -x[1])

    # Silent frame ratio (absence of breathing pauses is suspicious)
    silence_threshold = peak * 0.02
    silent_frames = 0
    total_frames = 0
    for i in range(0, n - frame_size, frame_size):
        frame = all_samples[i:i+frame_size]
        frame_peak = max(abs(s) for s in frame)
        total_frames += 1
        if frame_peak < silence_threshold:
            silent_frames += 1
    silence_ratio = silent_frames / total_frames if total_frames > 0 else 0

    return {
        "sample_count": n,
        "duration_seconds": round(n / 8000, 2),
        "rms_amplitude": round(rms, 1),
        "peak_amplitude": peak,
        "crest_factor": round(crest_factor, 3),
        "zero_crossing_rate": round(zcr, 4),
        "energy_coefficient_of_variation": round(energy_cv, 4),
        "silence_ratio": round(silence_ratio, 3),
        "std_deviation": round(std_dev, 1),
        "top_autocorrelation_lags": [lag for lag, _ in autocorr_peaks[:3]] if autocorr_peaks else [],
        "pitch_regularity_note": "high" if autocorr_peaks and len(set(p[0] for p in autocorr_peaks[:3])) == 1 else "normal"
    }


def analyze_with_inference(features, call_id):
    """Send extracted features to Telnyx AI Inference for deepfake assessment."""
    try:
        resp = requests.post(INFERENCE_URL, headers=HEADERS, json={
            "model": AI_MODEL,
            "messages": [
                {"role": "system", "content": "You are a voice forensics AI. Return only valid JSON."},
                {"role": "user", "content": ANALYSIS_PROMPT.format(features=json.dumps(features, indent=2))}
            ],
            "max_tokens": 500,
            "temperature": 0.1
        }, timeout=15)
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        # Parse JSON from response
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(content)
    except Exception as e:
        app.logger.exception("Inference failed for %s", call_id)
        return {"score": 0.5, "confidence": 0, "assessment": "error", "indicators": [], "reasoning": "inference error"}


def send_alert(call_id, result, caller):
    """Send alert via webhook when deepfake is detected."""
    if not ALERT_WEBHOOK:
        return
    try:
        requests.post(ALERT_WEBHOOK, json={
            "text": f":warning: *Deepfake Alert* on call `{call_id}`\n"
                    f"Caller: `{caller}`\n"
                    f"Score: {result.get('score', 'N/A')} ({result.get('assessment', 'unknown')})\n"
                    f"Confidence: {result.get('confidence', 'N/A')}\n"
                    f"Indicators: {', '.join(result.get('indicators', []))}\n"
                    f"Reasoning: {result.get('reasoning', 'N/A')}"
        })
    except Exception as e:
        app.logger.error("Alert webhook failed: %s", e)


def telnyx_action(call_control_id, action, payload=None):
    """Execute a Call Control action."""
    url = f"{API}/calls/{call_control_id}/actions/{action}"
    try:
        resp = requests.post(url, headers=HEADERS, json=payload or {}, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        app.logger.error("Call action %s failed: %s", action, e)
        return None


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event = data.get("event_type", "")
    state = decode_state(p)                # per-call state carried by Telnyx
    call_id = p.get("call_control_id", "")
    caller = p.get("from", "")
    if isinstance(caller, dict):
        caller = caller.get("phone_number", "")

    if event == "call.initiated":
        if p.get("direction") == "incoming":
            telnyx_action(call_id, "answer", {"client_state": encode_state({"phase": "detecting"})})

    elif event == "call.answered":
        sessions[call_id] = {
            "caller": caller,
            "audio_chunks": [],
            "start_time": time.time(),
            "analysis": None,
            "status": "recording"
        }
        # Start media streaming to capture audio
        telnyx_action(call_id, "streaming_start", {
            "stream_url": os.getenv("MEDIA_STREAM_URL", request.url_root.rstrip("/").replace("http", "ws") + "/media"),
            "stream_track": "inbound_track"
        })
        # Speak a greeting while we capture audio in background
        telnyx_action(call_id, "speak", {
            "payload": "Thank you for calling. Your call is being connected. Please hold.",
            "language": "en-US",
            "voice": "female"
        })

    elif event == "call.streaming.started":
        app.logger.info("Media streaming started for %s", call_id)

    elif event == "call.streaming.stopped":
        # Analyze collected audio
        session = sessions.get(call_id)
        if session and session["audio_chunks"]:
            features = extract_audio_features(session["audio_chunks"])
            result = analyze_with_inference(features, call_id)
            session["analysis"] = result
            session["status"] = "analyzed"

            if result.get("score", 0) >= DETECTION_THRESHOLD:
                session["status"] = "deepfake_detected"
                send_alert(call_id, result, session["caller"])
                telnyx_action(call_id, "speak", {
                    "payload": "This call has been flagged for security review. A supervisor will join shortly.",
                    "language": "en-US",
                    "voice": "female"
                })
            else:
                session["status"] = "cleared"

    elif event == "call.hangup":
        session = sessions.get(call_id)
        if session:
            session["status"] = "completed"
            session["end_time"] = time.time()

    return jsonify({"status": "ok"}), 200


@app.route("/webhooks/media", methods=["POST"])
def handle_media():
    """Receive media stream audio chunks for analysis."""
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    call_id = p.get("call_control_id", "")
    media = p.get("media", {})

    session = sessions.get(call_id)
    if session and media.get("payload"):
        try:
            audio_bytes = base64.b64decode(media["payload"])
            session["audio_chunks"].append(audio_bytes)
        except Exception:
            pass

    return jsonify({"status": "ok"}), 200


@app.route("/calls/<call_id>/analyze", methods=["POST"])
def force_analyze(call_id):
    """Force analysis of a call's collected audio."""
    session = sessions.get(call_id)
    if not session:
        return jsonify({"error": "Call not found"}), 404
    if not session["audio_chunks"]:
        return jsonify({"error": "No audio collected yet"}), 400

    features = extract_audio_features(session["audio_chunks"])
    result = analyze_with_inference(features, call_id)
    session["analysis"] = result
    session["status"] = "deepfake_detected" if result.get("score", 0) >= DETECTION_THRESHOLD else "cleared"

    if result.get("score", 0) >= DETECTION_THRESHOLD:
        send_alert(call_id, result, session["caller"])

    return jsonify({
        "call_id": call_id,
        "caller": session["caller"],
        "features": features,
        "analysis": result,
        "threshold": DETECTION_THRESHOLD,
        "flagged": result.get("score", 0) >= DETECTION_THRESHOLD
    }), 200


@app.route("/calls", methods=["GET"])
def list_calls():
    """List all analyzed calls with deepfake scores."""
    results = []
    for cid, s in sessions.items():
        results.append({
            "call_id": cid,
            "caller": s.get("caller", ""),
            "status": s.get("status", ""),
            "score": s.get("analysis", {}).get("score") if s.get("analysis") else None,
            "assessment": s.get("analysis", {}).get("assessment") if s.get("analysis") else None,
            "duration_seconds": round(s.get("end_time", time.time()) - s.get("start_time", time.time()), 1)
        })
    flagged = [r for r in results if r.get("score") and r["score"] >= DETECTION_THRESHOLD]
    return jsonify({
        "total": len(results),
        "flagged": len(flagged),
        "calls": sorted(results, key=lambda x: x.get("score") or 0, reverse=True)
    }), 200


@app.route("/health", methods=["GET"])
def health():
    active = sum(1 for s in sessions.values() if s.get("status") == "recording")
    flagged = sum(1 for s in sessions.values() if s.get("status") == "deepfake_detected")
    return jsonify({
        "status": "ok",
        "active_calls": active,
        "total_analyzed": len(sessions),
        "deepfakes_detected": flagged,
        "detection_threshold": DETECTION_THRESHOLD
    }), 200


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
