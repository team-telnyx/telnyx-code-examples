#!/usr/bin/env python3
"""AI Voice Memo to Email — call a number, dictate a memo, AI cleans it up and sends it as a formatted email via Telnyx."""
import os, json, time, requests, telnyx, queue
from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response, render_template
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
MEMO_NUMBER = os.getenv("MEMO_NUMBER")
DEFAULT_EMAIL = os.getenv("DEFAULT_EMAIL", "memos@example.com")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}

# --- Live dashboard event bus (Server-Sent Events) ---
event_subscribers = []
_event_seq = 0
_event_lock = threading.Lock()

def emit_event(event_type, data):
    global _event_seq
    with _event_lock:
        _event_seq += 1
        evt = {"id": _event_seq, "type": event_type, "data": data, "ts": time.time()}
    for sub in list(event_subscribers):
        try:
            sub.put_nowait(evt)
        except queue.Full:
            # slow client; drop this event rather than block the webhook
            pass

def _subscribe():
    q = queue.Queue(maxsize=256)
    event_subscribers.append(q)
    return q

def _unsubscribe(q):
    if q in event_subscribers:
        event_subscribers.remove(q)

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

_start_ttl_cleanup(active_calls)

memos = []

def call_inference(messages, max_tokens=400):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_email(to, subject, body):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": {"email_address": f"memo@{MEMO_NUMBER.replace('+','', timeout=10)}.telnyx.com"} if MEMO_NUMBER else {"email_address": "memo@telnyx.com"},
                "to": [{"email_address": to}], "subject": subject, "body": body, "type": "email"}, timeout=15)
    except Exception as e:
        app.logger.error("Email send failed (expected - may need Telnyx email setup): %s", e)

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
        active_calls[ccid] = {"caller": p.get("from"), "raw_text": [], "start": time.time()}
        emit_event("call.initiated", {"call_control_id": ccid, "caller": p.get("from")})
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        emit_event("call.answered", {"call_control_id": ccid, "greeting": "Voice memo. Speak your memo after the tone. Press pound when finished."})
        client.calls.actions.speak(ccid, payload="Voice memo. Speak your memo after the tone. Press pound when finished.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended":
        emit_event("call.recording", {"call_control_id": ccid, "message": "Gather started — waiting for caller speech"})
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=5, timeout_secs=120, language_code="en-US", terminating_digit="#")
        return jsonify({"status": "recording"}), 200
    elif event_type == "call.gather.ended":
        call = active_calls.get(ccid)
        speech = p.get("speech", {}).get("result", "")
        if call and speech:
            call["raw_text"].append(speech)
            emit_event("call.transcribed", {"call_control_id": ccid, "raw_text": speech})
            try:
                emit_event("ai.processing", {"call_control_id": ccid, "model": AI_MODEL})
                formatted = call_inference([{"role": "system", "content": "Clean up this voice memo into a well-formatted email. Fix grammar, add structure (paragraphs, bullets if needed). Return JSON: subject (string, inferred from content), body (string, the formatted memo), action_items (list of strings)."},
                    {"role": "user", "content": speech}])
                memo = json.loads(formatted)
                memo["caller"] = call["caller"]
                memo["raw"] = speech
                memo["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
                memos.append(memo)
                emit_event("memo.saved", memo)
                send_email(DEFAULT_EMAIL, memo.get("subject", "Voice Memo"), memo.get("body", speech))
                emit_event("email.sent", {"call_control_id": ccid, "to": DEFAULT_EMAIL, "subject": memo.get("subject", "Voice Memo")})
                client.calls.actions.speak(ccid, payload=f"Memo saved and emailed. Subject: {memo.get('subject', 'Voice Memo')}. Goodbye!", voice="female", language_code="en-US")
            except Exception as e:
                fallback = {"raw": speech, "caller": call["caller"], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                memos.append(fallback)
                emit_event("memo.saved", fallback)
                emit_event("ai.failed", {"call_control_id": ccid, "error": str(e)})
                client.calls.actions.speak(ccid, payload="Memo saved. Goodbye!", voice="female", language_code="en-US")
        return jsonify({"status": "processed"}), 200
    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        emit_event("call.hangup", {"call_control_id": ccid})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/memos", methods=["GET"])
def list_memos():
    return jsonify({"memos": memos[-20:]}), 200

@app.route("/", methods=["GET"])
def dashboard():
    return render_template("index.html")

@app.route("/stream", methods=["GET"])
def stream():
    def event_stream():
        q = _subscribe()
        try:
            # replay the last 20 memos so a reconnecting tab doesn't lose history
            for m in memos[-20:]:
                yield "data: " + json.dumps({"type": "memo.saved", "data": m, "ts": m.get("timestamp", time.time())}) + "\n\n"
            while True:
                try:
                    evt = q.get(timeout=15)
                    yield "data: " + json.dumps(evt) + "\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            _unsubscribe(q)
    return Response(event_stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "memos": len(memos)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
