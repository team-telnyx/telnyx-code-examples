#!/usr/bin/env python3
"""AI Voice Agent with Function Calling — voice agent that calls external APIs mid-conversation."""
import os, json, time, requests, telnyx, queue
from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response, render_template
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"), base_url="https://api.telnyx.com/v2")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
AGENT_NUMBER = os.getenv("AGENT_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}
conversations = []

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


TOOLS = [
    {"type": "function", "function": {"name": "check_weather", "description": "Get current weather for a city", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}},
    {"type": "function", "function": {"name": "lookup_order", "description": "Look up order status by order number", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}}},
    {"type": "function", "function": {"name": "check_account_balance", "description": "Check account balance by account number", "parameters": {"type": "object", "properties": {"account_id": {"type": "string"}}, "required": ["account_id"]}}},
]

def execute_function(name, args):
    if name == "check_weather":
        return json.dumps({"city": args.get("city"), "temp": "72F", "condition": "Partly cloudy", "humidity": "45%"})
    elif name == "lookup_order":
        return json.dumps({"order_id": args.get("order_id"), "status": "shipped", "eta": "June 20", "carrier": "FedEx"})
    elif name == "check_account_balance":
        return json.dumps({"account_id": args.get("account_id"), "balance": "$1,234.56", "due_date": "July 1"})
    return json.dumps({"error": "Unknown function"})

def call_inference(messages, ccid=None, tools=None):
    if tools is None:
        tools = TOOLS
    payload = {"model": AI_MODEL, "messages": messages, "temperature": 0.5}
    if tools:
        payload["tools"] = tools
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}, json=payload, timeout=30)
    resp.raise_for_status()
    choice = resp.json()["choices"][0]
    msg = choice["message"]
    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            fn = tc["function"]
            args = json.loads(fn.get("arguments", "{}"))
            emit_event("function.called", {"call_control_id": ccid, "function": fn["name"], "arguments": args})
            result = execute_function(fn["name"], args)
            emit_event("function.result", {"call_control_id": ccid, "function": fn["name"], "result": json.loads(result)})
            messages.append(msg)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        # Recurse WITHOUT tools so the model must produce a final spoken answer (prevents duplicate tool calls).
        return call_inference(messages, ccid, tools=[])
    return msg["content"]

SYSTEM_PROMPT = "You are a helpful voice assistant with access to real-time tools. You can check weather, look up orders, and check account balances. Use tools when the user asks. Keep voice responses under 2 sentences."

GREETING = "Hi! I can check weather, look up orders, or check your account balance. What do you need?"
REPROMPT = "I didn't catch that. What can I help with?"
ERROR_MSG = "Sorry, I had an issue. Please try again."

def speak(ccid, text):
    client.calls.actions.speak(ccid, payload=text, voice="female", language="en-US")

def gather_speech(ccid):
    client.calls.actions.gather_using_ai(ccid, parameters={
        "type": "object",
        "properties": {
            "utterance": {
                "type": "string",
                "description": "The caller's spoken response, transcribed verbatim.",
            }
        },
        "required": ["utterance"],
    }, assistant={
        "model": AI_MODEL,
        "instructions": "You are a one-turn speech capture component. Capture exactly what the caller says in the utterance field. Do not ask follow-up questions or give advice.",
    }, transcription={"language": "en"}, user_response_timeout_ms=15000)

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception as e:
        emit_event("webhook.rejected", {"error": str(e)})
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    call = active_calls.get(ccid)
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[ccid] = {"caller": p.get("from"), "conversation": [{"role": "system", "content": SYSTEM_PROMPT}], "start": time.time()}
        emit_event("call.initiated", {"call_control_id": ccid, "caller": p.get("from")})
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        emit_event("call.answered", {"call_control_id": ccid, "greeting": GREETING})
        speak(ccid, GREETING)
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        emit_event("call.listening", {"call_control_id": ccid, "message": "Gathering speech — waiting for caller"})
        gather_speech(ccid)
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.ai_gather.ended" and call:
        result = p.get("result", {})
        if isinstance(result, dict) and result.get("utterance"):
            speech = str(result["utterance"]).strip()
        else:
            speech = ""
            for msg in reversed(p.get("message_history") or []):
                if msg.get("role") == "user" and msg.get("content"):
                    speech = str(msg["content"]).strip()
                    break
        if not speech:
            emit_event("call.reprompting", {"call_control_id": ccid, "message": "No speech detected — reprompting"})
            speak(ccid, REPROMPT)
            return jsonify({"status": "reprompting"}), 200
        emit_event("call.transcribed", {"call_control_id": ccid, "speech": speech})
        call["conversation"].append({"role": "user", "content": speech})
        try:
            emit_event("ai.processing", {"call_control_id": ccid, "model": AI_MODEL})
            response = call_inference(call["conversation"], ccid=ccid)
            call["conversation"].append({"role": "assistant", "content": response})
            emit_event("ai.responded", {"call_control_id": ccid, "response": response})
            speak(ccid, response)
        except Exception as e:
            emit_event("ai.failed", {"call_control_id": ccid, "error": str(e)})
            speak(ccid, ERROR_MSG)
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        if call:
            log = {
                "caller": call.get("caller"),
                "conversation": [{"role": m["role"], "content": m["content"]} for m in call["conversation"] if m["role"] != "system"],
                "duration": round(time.time() - call.get("start", time.time()), 1),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            conversations.append(log)
        active_calls.pop(ccid, None)
        emit_event("call.hangup", {"call_control_id": ccid})
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/conversations", methods=["GET"])
def list_conversations():
    return jsonify({"conversations": conversations[-20:]}), 200

@app.route("/", methods=["GET"])
def dashboard():
    return render_template("index.html")

@app.route("/stream", methods=["GET"])
def stream():
    def event_stream():
        q = _subscribe()
        try:
            for c in conversations[-20:]:
                yield "data: " + json.dumps({"type": "conversation.replay", "data": c, "ts": c.get("timestamp", time.time())}) + "\n\n"
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
    return jsonify({"status": "ok", "active": len(active_calls), "conversations": len(conversations)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
