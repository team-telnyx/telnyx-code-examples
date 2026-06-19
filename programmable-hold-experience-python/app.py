#!/usr/bin/env python3
"""Programmable Hold Experience — custom hold experiences: tips, trivia, estimated wait time, callback offers."""
import os, json, time, secrets, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
HOLD_NUMBER = os.getenv("HOLD_NUMBER")
HOLD_MUSIC_URL = os.getenv("HOLD_MUSIC_URL", "https://file-examples.com/storage/fe1e2c9e0c6765da67ac0ed/2017/11/file_example_MP3_700KB.mp3")
active_holds = {}

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

_start_ttl_cleanup(active_holds)


TIPS = [
    "Did you know? You can manage your account 24/7 at our self-service portal.",
    "Pro tip: Set up auto-pay to never miss a payment and get a 5% discount.",
    "Fun fact: Our network spans 60 countries with owned infrastructure.",
    "Quick tip: Download our mobile app for instant support and account management.",
    "Did you know? You can port your existing numbers in as little as 24 hours.",
]

TRIVIA = [
    "Trivia time! The first phone call was made by Alexander Graham Bell in 1876. Press 1 if you knew that!",
    "Did you know? More than 5 billion people worldwide have mobile phone connections.",
    "Fun fact: The average person checks their phone 96 times a day.",
]

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
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_holds[ccid] = {"start": time.time(), "tip_idx": 0, "caller": p.get("from"), "offered_callback": False}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        wait_min = 2 + secrets.randbelow(7)
        client.calls.actions.speak(ccid, payload=f"Thank you for calling. Your estimated wait time is {wait_min} minutes. While you wait, here are some tips. Press 9 at any time for a callback instead.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended":
        hold = active_holds.get(ccid)
        if hold:
            elapsed = int(time.time() - hold["start"])
            if elapsed > 120 and not hold["offered_callback"]:
                hold["offered_callback"] = True
                client.calls.actions.speak(ccid, payload="You've been waiting a while. Press 9 and we'll call you back when an agent is free.", voice="female", language_code="en-US")
            elif HOLD_MUSIC_URL:
                client.calls.actions.playback_start(ccid, audio_url=HOLD_MUSIC_URL)
            else:
                tip = secrets.choice(TIPS + TRIVIA)
                hold["tip_idx"] += 1
                client.calls.actions.speak(ccid, payload=tip, voice="female", language_code="en-US")
        return jsonify({"status": "holding"}), 200
    elif event_type == "call.playback.ended":
        hold = active_holds.get(ccid)
        if hold:
            tip = TIPS[hold["tip_idx"] % len(TIPS)]
            hold["tip_idx"] += 1
            client.calls.actions.speak(ccid, payload=tip, voice="female", language_code="en-US")
        return jsonify({"status": "tip"}), 200
    elif event_type == "call.dtmf.received":
        digit = p.get("digits", "")
        if digit == "9":
            hold = active_holds.get(ccid)
            if hold:
                client.calls.actions.speak(ccid, payload="Got it! We'll call you back shortly. Goodbye!", voice="female", language_code="en-US")
            return jsonify({"status": "callback_requested"}), 200
    elif event_type == "call.hangup":
        hold = active_holds.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "on_hold": len(active_holds)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
