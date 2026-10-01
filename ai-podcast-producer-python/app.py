#!/usr/bin/env python3
"""AI Podcast Producer — record a multi-host podcast via conference call,
transcribe each speaker, generate show notes + chapters + social clips,
and produce TTS intro/outro bumpers. All on Telnyx."""

import os, json, base64, time, uuid, hashlib, requests, telnyx
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()
app = Flask(__name__)

# public_key (from the Portal) lets the SDK verify inbound webhook signatures.
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
TTS_VOICE = os.getenv("TTS_VOICE", "Telnyx.KokoroTTS.af_nova")
SLACK_WEBHOOK = os.getenv("SLACK_WEBHOOK", "")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

episodes = {}  # episode_id -> episode state
conferences = {}  # conference_id -> episode_id

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

_start_ttl_cleanup(episodes, conferences)



def telnyx_post(path, payload):
    resp = requests.post(f"{API}/{path}", headers=HEADERS, json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json()


def telnyx_get(path):
    resp = requests.get(f"{API}/{path}", headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def inference(messages, max_tokens=2000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.4
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def tts_generate(text, voice=None):
    """Generate speech audio via Telnyx TTS inference."""
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice or TTS_VOICE,
        "text": text
    }, timeout=30)
    resp.raise_for_status()
    return resp.content  # raw audio bytes


def notify_slack(message):
    if SLACK_WEBHOOK:
        try:
            requests.post(SLACK_WEBHOOK, json={"text": message}, timeout=5)
        except Exception:
            pass


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


@app.route("/episodes/start", methods=["POST"])
def start_episode():
    """Start a new podcast episode recording session via conference call."""
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    title = data.get("title", f"Episode {datetime.utcnow().strftime('%Y-%m-%d')}")
    hosts = data.get("hosts", [])  # list of E.164 phone numbers

    if not hosts:
        return jsonify({"error": "Provide at least one host phone number"}), 400

    episode_id = f"ep-{uuid.uuid4().hex[:8]}"
    conf_name = f"podcast-{episode_id}"

    episodes[episode_id] = {
        "id": episode_id,
        "title": title,
        "conference": conf_name,
        "hosts": hosts,
        "status": "dialing",
        "speakers": {},
        "transcript_segments": [],
        "recording_urls": [],
        "started_at": datetime.utcnow().isoformat(),
        "show_notes": None,
        "chapters": [],
        "clips": [],
        "bumpers": {}
    }

    # Dial each host into the conference
    for phone in hosts:
        try:
            result = telnyx_post("calls", {
                "connection_id": CONNECTION_ID,
                "to": phone,
                "from": MAIN_NUMBER,
                "conference_name": conf_name,
                "conference_config": {
                    "start_conference_on_join": True,
                    "record_conference": True,
                    "beep_enabled": "on_enter"
                },
                "client_state": encode_state({"episode_id": episode_id, "role": "host"})
            })
            speaker_id = phone[-4:]
            episodes[episode_id]["speakers"][speaker_id] = {
                "phone": phone,
                "call_id": result.get("data", {}).get("call_control_id"),
                "segments": []
            }
        except Exception as e:
            app.logger.error("Failed to dial %s: %s", phone, e)

    conferences[conf_name] = episode_id
    notify_slack(f"🎙️ Podcast recording started: *{title}* with {len(hosts)} hosts")

    return jsonify({
        "episode_id": episode_id,
        "title": title,
        "conference": conf_name,
        "hosts_dialed": len(hosts),
        "status": "dialing"
    }), 201


@app.route("/episodes/<episode_id>/stop", methods=["POST"])
def stop_episode(episode_id):
    """Stop recording and trigger post-production pipeline."""
    episode = episodes.get(episode_id)
    if not episode:
        return jsonify({"error": "Episode not found"}), 404

    episode["status"] = "processing"
    episode["ended_at"] = datetime.utcnow().isoformat()

    # Hang up all participants
    for speaker in episode["speakers"].values():
        if speaker.get("call_id"):
            try:
                telnyx_post(f"calls/{speaker['call_id']}/actions/hangup", {"client_state": ""})
            except Exception:
                pass

    # Build full transcript from segments
    full_transcript = "\n".join([
        f"[{seg['speaker']}] {seg['text']}"
        for seg in sorted(episode["transcript_segments"], key=lambda s: s.get("timestamp", 0))
    ])

    if full_transcript:
        # Generate show notes
        show_notes = inference([
            {"role": "system", "content": "You are a podcast producer. Generate professional show notes from this transcript. Include: summary (2-3 sentences), key topics discussed, notable quotes, and links/references mentioned."},
            {"role": "user", "content": full_transcript}
        ])
        episode["show_notes"] = show_notes

        # Generate chapters
        chapters_raw = inference([
            {"role": "system", "content": "Extract chapter markers from this podcast transcript. Return JSON array with objects containing 'title' and 'summary' for each distinct topic segment. Keep chapter titles concise (under 60 chars)."},
            {"role": "user", "content": full_transcript}
        ])
        try:
            episode["chapters"] = json.loads(chapters_raw)
        except json.JSONDecodeError:
            episode["chapters"] = [{"title": "Full Episode", "summary": chapters_raw}]

        # Generate social clips (quotable segments)
        clips_raw = inference([
            {"role": "system", "content": "Find the 3-5 most quotable, shareable moments from this podcast transcript. For each, return JSON with 'quote' (exact text, under 280 chars), 'speaker', and 'context' (why it's interesting). These will be used for social media promotion."},
            {"role": "user", "content": full_transcript}
        ])
        try:
            episode["clips"] = json.loads(clips_raw)
        except json.JSONDecodeError:
            episode["clips"] = []

    # Generate TTS bumpers
    try:
        intro_text = f"Welcome to {episode['title']}. Recorded on {episode['started_at'][:10]}."
        intro_audio = tts_generate(intro_text)
        episode["bumpers"]["intro"] = {
            "text": intro_text,
            "audio_bytes": len(intro_audio),
            "generated": True
        }

        outro_text = f"That's a wrap on {episode['title']}. Thanks for listening."
        outro_audio = tts_generate(outro_text)
        episode["bumpers"]["outro"] = {
            "text": outro_text,
            "audio_bytes": len(outro_audio),
            "generated": True
        }
    except Exception as e:
        app.logger.error("TTS bumper generation failed: %s", e)

    episode["status"] = "complete"
    notify_slack(f"✅ Podcast *{episode['title']}* processed: {len(episode.get('chapters', []))} chapters, {len(episode.get('clips', []))} clips")

    return jsonify({
        "episode_id": episode_id,
        "status": "complete",
        "show_notes": episode.get("show_notes"),
        "chapters": episode.get("chapters"),
        "clips": episode.get("clips"),
        "bumpers": list(episode.get("bumpers", {}).keys())
    })


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice_webhook():
    """Handle call control events during recording."""
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    event = payload.get("data", {})
    event_type = event.get("event_type", "")
    p = event.get("payload", {})            # Telnyx nests event fields under data.payload
    call_id = p.get("call_control_id", "")
    state = decode_state(p)                 # per-call state carried by Telnyx (base64 JSON)

    if event_type == "call.answered":
        # Start continuous real-time transcription of this participant's speech.
        # Telnyx streams each utterance back as a `call.transcription` webhook,
        # which we accumulate into this speaker's segments over the whole call.
        try:
            telnyx_post(f"calls/{call_id}/actions/transcription_start", {
                "language": "en",
            })
        except Exception as e:
            app.logger.error("Transcription start failed: %s", e)

    elif event_type == "call.transcription":
        transcription_data = p.get("transcription_data", {})
        transcript_text = transcription_data.get("transcript", "")

        if transcript_text:
            # Prefer the episode_id echoed back in client_state; fall back to all
            # episodes. Then find the matching speaker for this call and append.
            ep_id = state.get("episode_id")
            candidates = [episodes[ep_id]] if ep_id in episodes else list(episodes.values())
            for ep in candidates:
                for spk_id, spk in ep["speakers"].items():
                    if spk.get("call_id") == call_id:
                        segment = {
                            "speaker": spk_id,
                            "text": transcript_text,
                            "timestamp": time.time(),
                            "confidence": transcription_data.get("confidence", 0)
                        }
                        ep["transcript_segments"].append(segment)
                        spk["segments"].append(segment)
                        break

    elif event_type == "conference.recording.saved":
        recording_url = event.get("payload", {}).get("recording_urls", {}).get("mp3")
        conf_name = event.get("payload", {}).get("conference_name", "")
        ep_id = conferences.get(conf_name)
        if ep_id and recording_url:
            episodes[ep_id]["recording_urls"].append(recording_url)

    elif event_type == "call.hangup":
        pass  # Cleanup handled in stop_episode

    return jsonify({"status": "ok"}), 200


@app.route("/episodes", methods=["GET"])
def list_episodes():
    """List all episodes."""
    return jsonify({
        "episodes": [{
            "id": ep["id"],
            "title": ep["title"],
            "status": ep["status"],
            "hosts": len(ep["hosts"]),
            "segments": len(ep["transcript_segments"]),
            "started_at": ep.get("started_at")
        } for ep in episodes.values()]
    })


@app.route("/episodes/<episode_id>", methods=["GET"])
def get_episode(episode_id):
    """Get full episode details including show notes and clips."""
    episode = episodes.get(episode_id)
    if not episode:
        return jsonify({"error": "Episode not found"}), 404
    return jsonify(episode)


@app.route("/health", methods=["GET"])
def health():
    recording = sum(1 for e in episodes.values() if e["status"] == "dialing")
    return jsonify({
        "status": "ok",
        "total_episodes": len(episodes),
        "recording": recording,
        "version": "1.0.0"
    })


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
