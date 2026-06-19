#!/usr/bin/env python3
"""Smart IVR A/B Tester — run two IVR flows simultaneously and track which converts better."""
import os, json, time, secrets, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
IVR_NUMBER = os.getenv("IVR_NUMBER")
AGENT_NUMBER = os.getenv("AGENT_NUMBER")
experiments = {}
active_calls = {}

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

_start_ttl_cleanup(experiments, active_calls)


DEFAULT_EXPERIMENT = {
    "variant_a": {"greeting": "Thanks for calling! Press 1 for sales, 2 for support.", "name": "Standard"},
    "variant_b": {"greeting": "Hey! Looking to buy? Press 1. Need help? Press 2. Or just tell me what you need.", "name": "Casual"},
    "traffic_split": 0.5,
    "results": {"a": {"calls": 0, "connected": 0, "hangups": 0}, "b": {"calls": 0, "connected": 0, "hangups": 0}},
}
experiments["default"] = DEFAULT_EXPERIMENT

@app.route("/experiments", methods=["POST"])
def create_experiment():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    eid = f"EXP-{int(time.time())}"
    experiments[eid] = {"variant_a": data.get("variant_a", {}), "variant_b": data.get("variant_b", {}),
        "traffic_split": data.get("split", 0.5), "results": {"a": {"calls": 0, "connected": 0, "hangups": 0}, "b": {"calls": 0, "connected": 0, "hangups": 0}}}
    return jsonify({"experiment_id": eid}), 200

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
    event_type = payload.get("data", {}).get("event_type")
    data = payload.get("data", {})
    p = data.get("payload", {})
    ccid = p.get("call_control_id")
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        exp = experiments.get("default", DEFAULT_EXPERIMENT)
        variant = "a" if secrets.randbelow(1000) / 1000 < exp["traffic_split"] else "b"
        exp["results"][variant]["calls"] += 1
        active_calls[ccid] = {"variant": variant, "experiment": "default"}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        call = active_calls.get(ccid)
        if call:
            exp = experiments.get(call["experiment"], DEFAULT_EXPERIMENT)
            greeting = exp[f"variant_{call['variant']}"]["greeting"]
            client.calls.actions.speak(ccid, payload=greeting, voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended":
        client.calls.actions.gather(ccid, input_type="dtmf speech", timeout_secs=10, min_digits=1, max_digits=1, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended":
        call = active_calls.get(ccid)
        digits = p.get("digits", "")
        if call and digits in ("1", "2"):
            exp = experiments.get(call["experiment"], DEFAULT_EXPERIMENT)
            exp["results"][call["variant"]]["connected"] += 1
            if AGENT_NUMBER:
                client.calls.actions.transfer(ccid, to=AGENT_NUMBER)
            else:
                client.calls.actions.speak(ccid, payload="Thanks! Connecting you now.", voice="female", language_code="en-US")
        return jsonify({"status": "routed"}), 200
    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call:
            exp = experiments.get(call["experiment"], DEFAULT_EXPERIMENT)
            exp["results"][call["variant"]]["hangups"] += 1
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/experiments/<eid>/results", methods=["GET"])
def get_results(eid):
    exp = experiments.get(eid)
    if not exp: return jsonify({"error": "Not found"}), 404
    results = {}
    for v in ("a", "b"):
        r = exp["results"][v]
        rate = round(r["connected"] / max(r["calls"], 1) * 100, 1)
        results[v] = {"name": exp[f"variant_{v}"].get("name", v), "calls": r["calls"], "connected": r["connected"], "hangups": r["hangups"], "conversion_rate": rate}
    winner = "a" if results["a"]["conversion_rate"] > results["b"]["conversion_rate"] else "b"
    return jsonify({"results": results, "winner": winner, "confidence": "need more data" if results["a"]["calls"] + results["b"]["calls"] < 100 else "significant"}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "experiments": len(experiments)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
