#!/usr/bin/env python3
"""SMS Chatbot with Conversation Memory — persistent AI conversations over text with context retention."""

import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BOT_NUMBER = os.getenv("BOT_NUMBER")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Persistent conversation memory: phone_number -> {messages, metadata}
conversations = {}

SYSTEM_PROMPT = """You are a helpful SMS assistant. You remember everything the user has told you across messages.
Keep responses under 160 characters when possible to fit in a single SMS. If you need more space, use up to 320 characters.
Be concise, helpful, and conversational. Reference previous messages when relevant."""

def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def send_sms(to, text):
    try:
        requests.post("https://api.telnyx.com/v2/messages", headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json={"from": BOT_NUMBER, "to": to, "text": text, "messaging_profile_id": os.getenv("MESSAGING_PROFILE_ID", "")}, timeout=10)
    except requests.RequestException as e:
        app.logger.error(f"SMS failed: {e}")

def get_conversation(phone):
    if phone not in conversations:
        conversations[phone] = {"messages": [{"role": "system", "content": SYSTEM_PROMPT}], "created_at": time.time(), "message_count": 0}
    return conversations[phone]

def summarize_if_needed(conv):
    """Summarize old messages to keep context window manageable."""
    if len(conv["messages"]) > 20:
        old_msgs = conv["messages"][1:15]  # Keep system prompt, summarize middle
        summary_prompt = [{"role": "system", "content": "Summarize this conversation in 2-3 sentences, capturing key facts and preferences the user shared."},
            {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in old_msgs)}]
        summary = call_inference(summary_prompt)
        conv["messages"] = [conv["messages"][0], {"role": "system", "content": f"Previous conversation summary: {summary}"}] + conv["messages"][15:]

@app.route("/webhooks/messaging", methods=["POST"])
def handle_sms():
    payload = request.get_json()
    data = payload.get("data", {})
    if data.get("event_type") != "message.received" or data.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200
    from_number = data.get("from", {}).get("phone_number", "")
    text = data.get("text", "").strip()
    if not from_number or not text:
        return jsonify({"status": "ignored"}), 200
    conv = get_conversation(from_number)
    conv["messages"].append({"role": "user", "content": text})
    conv["message_count"] += 1
    summarize_if_needed(conv)
    response = call_inference(conv["messages"])
    conv["messages"].append({"role": "assistant", "content": response})
    send_sms(from_number, response)
    return jsonify({"status": "responded"}), 200

@app.route("/conversations", methods=["GET"])
def list_conversations():
    return jsonify({phone: {"message_count": c["message_count"], "created_at": c["created_at"]} for phone, c in conversations.items()}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "conversations": len(conversations)}), 200

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
