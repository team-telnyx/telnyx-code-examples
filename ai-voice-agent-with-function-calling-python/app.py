#!/usr/bin/env python3
"""AI Voice Agent with Function Calling — voice agent that calls external APIs mid-conversation."""
import os, json, re, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)

# Override base_url so the SDK doesn't pick up TELNYX_BASE_URL from the env.
client = telnyx.Telnyx(
    api_key=os.getenv("TELNYX_API_KEY"),
    public_key=os.getenv("TELNYX_PUBLIC_KEY"),
    base_url="https://api.telnyx.com/v2",
)
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
AGENT_NUMBER = os.getenv("AGENT_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
VOICE = "Telnyx.KokoroTTS.af"
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


_start_ttl_cleanup(active_calls)


# ── Tool definitions (OpenAI function-calling schema) ──────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_order",
            "description": "Look up order status by order number",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_account_balance",
            "description": "Check account balance by account number",
            "parameters": {
                "type": "object",
                "properties": {"account_id": {"type": "string"}},
                "required": ["account_id"],
            },
        },
    },
]


def execute_function(name, args):
    """Mock function implementations — replace with real API calls in production."""
    if name == "check_weather":
        return json.dumps({"city": args.get("city"), "temp": "72F", "condition": "Partly cloudy", "humidity": "45%"})
    elif name == "lookup_order":
        return json.dumps({"order_id": args.get("order_id"), "status": "shipped", "eta": "June 20", "carrier": "FedEx"})
    elif name == "check_account_balance":
        return json.dumps({"account_id": args.get("account_id"), "balance": "$1,234.56", "due_date": "July 1"})
    return json.dumps({"error": "Unknown function"})


def _strip_fences(text):
    """Strip ```json or ```markdown fences so TTS doesn't read them aloud."""
    return re.sub(r"^```(?:json|markdown)?\s*\n?", "", text).strip("` \n")


def call_inference(messages, max_tokens=300, _depth=0, _max_depth=5):
    """Send conversation to Telnyx AI Inference with tool-calling support.

    Recursively executes any tool_calls the model returns, up to _max_depth.
    Note: max_tokens and tools can't be used together (API restriction), so
    max_tokens is only sent on the final (no-tools) call.
    """
    if _depth >= _max_depth:
        return "I'm having trouble processing that request right now."

    payload = {
        "model": AI_MODEL,
        "messages": messages,
        "temperature": 0.5,
        "tools": TOOLS,
    }
    try:
        resp = requests.post(
            INFERENCE_URL,
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
    except Exception as e:
        app.logger.error("Inference request failed: %s", e)
        return "I couldn't reach the AI service just now. Please try again."

    try:
        resp.raise_for_status()
    except Exception as e:
        app.logger.error("Inference HTTP error: %s — %s", e, resp.text[:200])
        return "The AI service returned an error. Please try again."

    choice = resp.json()["choices"][0]
    msg = choice["message"]

    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            fn = tc["function"]
            try:
                fn_args = json.loads(fn.get("arguments", "{}"))
            except json.JSONDecodeError:
                fn_args = {}
            app.logger.info("Tool call: %s(%s)", fn["name"], fn_args)
            result = execute_function(fn["name"], fn_args)
            messages.append(msg)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        return call_inference(messages, max_tokens, _depth=_depth + 1, _max_depth=_max_depth)

    return _strip_fences(msg["content"])


SYSTEM_PROMPT = (
    "You are a helpful voice assistant with access to real-time tools. "
    "You can check weather, look up orders, and check account balances. "
    "Use tools when the user asks. Keep voice responses under 2 sentences."
)

GREETING = "Hi! I can check weather, look up orders, or check your account balance. What do you need?"
REPROMPT = "I didn't catch that. What can I help with?"


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
    call = active_calls.get(ccid)

    if event_type == "call.initiated" and p.get("direction") == "incoming":
        active_calls[ccid] = {
            "caller": p.get("from"),
            "conversation": [{"role": "system", "content": SYSTEM_PROMPT}],
            "_ts": time.time(),
        }
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload=GREETING, voice=VOICE, language="en-US")
        return jsonify({"status": "greeting"}), 200

    elif event_type == "call.speak.ended" and call:
        # After any TTS finishes, start listening for the caller's speech.
        # gather_using_ai transcribes free-form speech and returns it as text.
        if call.get("processed"):
            call["processed"] = False
        client.calls.actions.gather_using_ai(
            ccid,
            parameters={
                "type": "object",
                "properties": {
                    "user_request": {
                        "type": "string",
                        "description": "What the caller said — their full spoken request.",
                    }
                },
                "required": ["user_request"],
            },
            voice=VOICE,
            language="en-US",
            user_response_timeout_ms=15000,
        )
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.ai_gather.ended" and call:
        # gather_using_ai fires call.ai_gather.ended (not call.gather.ended).
        # Dedup guard — Telnyx may retry webhooks.
        if call.get("processed"):
            return jsonify({"status": "ok"}), 200
        call["processed"] = True

        # Extract the transcribed speech from the result object.
        result = p.get("result", {})
        speech = result.get("user_request", "") if isinstance(result, dict) else ""

        # Fallback: check message_history for a user turn.
        if not speech:
            for msg in reversed(p.get("message_history", [])):
                if msg.get("role") == "user":
                    speech = msg.get("content", "")
                    break

        if not speech:
            try:
                client.calls.actions.speak(ccid, payload=REPROMPT, voice=VOICE, language="en-US")
            except Exception:
                pass
            return jsonify({"status": "reprompting"}), 200

        app.logger.info("Caller said: %s", speech)
        call["conversation"].append({"role": "user", "content": speech})
        response = call_inference(call["conversation"])
        call["conversation"].append({"role": "assistant", "content": response})
        app.logger.info("AI response: %s", response)

        try:
            client.calls.actions.speak(ccid, payload=response, voice=VOICE, language="en-US")
        except Exception as e:
            app.logger.error("Speak failed (call may have ended): %s", e)
        return jsonify({"status": "responding"}), 200

    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        return jsonify({"status": "ended"}), 200

    return jsonify({"status": "ok"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_calls)}), 200


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
