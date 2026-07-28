#!/usr/bin/env python3
"""AI Real-Time Translation Bridge — connect two callers who speak different languages.
AI translates each side's speech before playing it to the other party."""
import os, json, base64, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BRIDGE_NUMBER = os.getenv("BRIDGE_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
bridges = {}

LANG_CODES = {
    "english": "en-US", "spanish": "es-US", "french": "fr-FR",
    "german": "de-DE", "italian": "it-IT", "portuguese": "pt-BR",
    "hindi": "hi-IN", "arabic": "ar-SA", "chinese": "zh-CN",
    "japanese": "ja-JP", "korean": "ko-KR", "russian": "ru-RU",
}

def lang_code(lang):
    """Map a language name to a BCP-47 code for TTS/STT."""
    return LANG_CODES.get(lang.lower(), "en-US")

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

_start_ttl_cleanup(bridges)


def translate(text, from_lang, to_lang):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": [{"role": "system", "content": f"Translate from {from_lang} to {to_lang}. Return ONLY the translation, nothing else."},
            {"role": "user", "content": text}], "max_tokens": 200, "temperature": 0.1}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

@app.route("/bridge", methods=["POST"])
def create_bridge():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    bid = f"BR-{int(time.time())}"
    bridges[bid] = {"caller_a": data.get("number_a"), "lang_a": data.get("lang_a", "English"),
        "caller_b": data.get("number_b"), "lang_b": data.get("lang_b", "Spanish"), "state": "initiating", "ccids": {}}
    try:
        resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"to": data["number_a"], "from": BRIDGE_NUMBER, "connection_id": CONNECTION_ID,
                "client_state": base64.b64encode(json.dumps({"bid": bid, "side": "a"}).encode()).decode()}, timeout=10)
        bridges[bid]["ccids"]["a"] = resp.json().get("data", {}).get("call_control_id")
    except Exception as e:
        app.logger.exception("Failed to initiate outbound call for bridge %s", bid)
        return jsonify({"error": "internal error"}), 500
    return jsonify({"bridge_id": bid, "status": "calling_a"}), 200

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
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    cs_raw = p.get("client_state", "")
    cs = {}
    if cs_raw:
        try: cs = json.loads(base64.b64decode(cs_raw))
        except Exception: pass
    bid = cs.get("bid")
    side = cs.get("side")
    bridge = bridges.get(bid) if bid else None
    if event_type == "call.answered" and bridge:
        if side == "a":
            client.calls.actions.speak(ccid, payload=f"Connected. Translation bridge active between {bridge['lang_a']} and {bridge['lang_b']}. Speak now.", voice="female", language_code="en-US")
            try:
                resp = requests.post("https://api.telnyx.com/v2/calls", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
                    json={"to": bridge["caller_b"], "from": BRIDGE_NUMBER, "connection_id": CONNECTION_ID,
                        "client_state": base64.b64encode(json.dumps({"bid": bid, "side": "b"}).encode()).decode()}, timeout=10)
                bridge["ccids"]["b"] = resp.json().get("data", {}).get("call_control_id")
            except Exception: pass
        elif side == "b":
            client.calls.actions.speak(ccid, payload="Translation bridge connected. Speak now.", voice="female", language_code="en-US")
            bridge["state"] = "active"
        return jsonify({"status": "ok"}), 200
    elif event_type == "call.speak.ended" and bridge:
        my_side = "a" if ccid == bridge["ccids"].get("a") else "b"
        my_lang = lang_code(bridge[f"lang_{my_side}"])
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code=my_lang)
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and bridge:
        speech = p.get("speech", {}).get("result", "")
        if speech and bridge.get("state") == "active":
            from_lang = bridge[f"lang_{side}"]
            to_lang = bridge["lang_b"] if side == "a" else bridge["lang_a"]
            other_ccid = bridge["ccids"].get("b" if side == "a" else "a")
            translated = translate(speech, from_lang, to_lang)
            if other_ccid:
                client.calls.actions.speak(other_ccid, payload=translated, voice="female", language_code=lang_code(to_lang))
            client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code=lang_code(bridge[f"lang_{side}"]))
        return jsonify({"status": "translated"}), 200
    elif event_type == "call.hangup" and bridge:
        other_side = "b" if side == "a" else "a"
        other_ccid = bridge.get("ccids", {}).get(other_side)
        if other_ccid:
            try: requests.post(f"https://api.telnyx.com/v2/calls/{other_ccid}/actions/hangup", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}, json={}, timeout=10)
            except Exception: pass
        bridge["state"] = "ended"
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/bridges", methods=["GET"])
def list_bridges():
    return jsonify({"bridges": {k: {"state": v["state"], "languages": f"{v['lang_a']}<>{v['lang_b']}"} for k, v in bridges.items()}}), 200

@app.route("/health", methods=["GET"])
def health():
    active = sum(1 for b in bridges.values() if b["state"] == "active")
    return jsonify({"status": "ok", "active_bridges": active}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
