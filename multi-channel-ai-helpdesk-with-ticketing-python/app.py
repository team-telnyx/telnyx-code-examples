#!/usr/bin/env python3
"""Multi-Channel AI Helpdesk with Ticketing — voice + SMS + WhatsApp support with auto-ticket creation."""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
HELPDESK_NUMBER = os.getenv("HELPDESK_NUMBER")
TICKET_WEBHOOK_URL = os.getenv("TICKET_WEBHOOK_URL", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
tickets = []
active_calls = {}
customer_context = {}

SYSTEM_PROMPT = """You are a helpful support agent. Try to resolve issues directly. If you cannot resolve:
- Collect: customer name, issue description, urgency level
- Let them know a ticket has been created
Keep voice responses under 2 sentences. Text responses can be slightly longer."""

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def create_ticket(customer, issue, channel, urgency="normal"):
    ticket = {"id": f"TKT-{int(time.time())}", "customer": customer, "issue": issue, "channel": channel, "urgency": urgency, "status": "open", "created": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    tickets.append(ticket)
    if TICKET_WEBHOOK_URL:
        try:
            requests.post(TICKET_WEBHOOK_URL, json=ticket, timeout=10)
        except Exception:
            pass
    return ticket

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": HELPDESK_NUMBER, "to": to, "text": text, "messaging_profile_id": os.getenv("MESSAGING_PROFILE_ID", "")}, timeout=10)
    except Exception as e:
        app.logger.error(f"SMS failed: {e}")

def get_context(phone):
    if phone not in customer_context:
        customer_context[phone] = {"messages": [{"role": "system", "content": SYSTEM_PROMPT}], "tickets": []}
    return customer_context[phone]

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    event_type = payload.get("data", {}).get("event_type")
    ccid = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})
    call = active_calls.get(ccid)
    if event_type == "call.initiated" and data.get("direction") == "incoming":
        caller = data.get("from", "unknown")
        ctx = get_context(caller)
        active_calls[ccid] = {"caller": caller}
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Thanks for calling support! How can I help you today?", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended" and call:
        client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=2, timeout_secs=15, language_code="en-US")
        return jsonify({"status": "listening"}), 200
    elif event_type == "call.gather.ended" and call:
        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(ccid, payload="Sorry, I missed that.", voice="female", language_code="en-US")
            return jsonify({"status": "reprompting"}), 200
        ctx = get_context(call["caller"])
        ctx["messages"].append({"role": "user", "content": f"[voice] {speech}"})
        response = call_inference(ctx["messages"])
        ctx["messages"].append({"role": "assistant", "content": response})
        if any(word in response.lower() for word in ["ticket", "created a ticket", "escalat"]):
            ticket = create_ticket(call["caller"], speech, "voice")
            ctx["tickets"].append(ticket["id"])
        client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
        return jsonify({"status": "responding"}), 200
    elif event_type == "call.hangup":
        active_calls.pop(ccid, None)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/webhooks/messaging", methods=["POST"])
def handle_messaging():
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "")
    if not from_number or not text:
        return jsonify({"status": "ignored"}), 200
    ctx = get_context(from_number)
    ctx["messages"].append({"role": "user", "content": f"[sms] {text}"})
    response = call_inference(ctx["messages"])
    ctx["messages"].append({"role": "assistant", "content": response})
    if any(word in response.lower() for word in ["ticket", "created a ticket", "escalat"]):
        ticket = create_ticket(from_number, text, "sms")
        ctx["tickets"].append(ticket["id"])
    send_sms(from_number, response)
    return jsonify({"status": "responded"}), 200

@app.route("/tickets", methods=["GET"])
def list_tickets():
    return jsonify({"tickets": tickets[-50:], "total": len(tickets)}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "tickets": len(tickets), "active_calls": len(active_calls)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
