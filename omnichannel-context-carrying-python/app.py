"""
Omnichannel Context-Carrying AI Agent — customer context follows across
email, voice, and SMS so the customer never repeats themselves.

The key "wow moment": a customer emails about a booking change, then calls
from their registered phone. The AI greets them with:
"I see you contacted us about changing your booking. Are you calling about
the same request?"

Uses Telnyx Inference API (OpenAI-compatible) with tool-calling, Telnyx
Email/SMS/Voice APIs for delivery, and SQLite for persistent cross-channel
conversation context plus a customer identity registry.

Run with real credentials:
    python app.py

Run the demo (no credentials needed):
    python demo/demo_server.py
"""

import json
import os
import queue
import sqlite3
import threading
import time
from datetime import datetime, timezone

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# SSE — real-time event streaming to browser clients
# ---------------------------------------------------------------------------
_sse_subscribers = []
_sse_lock = threading.Lock()


def sse_publish(event_type, data):
    """Push an SSE event to all connected browser clients."""
    payload = json.dumps({"type": event_type, "ts": datetime.now(timezone.utc).isoformat(), **data})
    with _sse_lock:
        dead = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_subscribers.remove(q)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "")
TELNYX_EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
CONNECTION_ID = os.getenv("CONNECTION_ID", "")
PORT = int(os.getenv("PORT", "5000"))
DB_PATH = os.getenv("DB_PATH", "conversations.db")

INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY)

# ---------------------------------------------------------------------------
# SQLite — persistent cross-channel conversation context + customer registry
# ---------------------------------------------------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id TEXT    NOT NULL,
            channel     TEXT    NOT NULL,
            role        TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            timestamp   TEXT    NOT NULL
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_conv_customer ON conversations (customer_id)"
    )
    cur.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            email      TEXT,
            phone      TEXT,
            created_at TEXT NOT NULL
        )
    """)
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cust_email ON customers (email) WHERE email IS NOT NULL"
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cust_phone ON customers (phone) WHERE phone IS NOT NULL"
    )
    conn.commit()
    conn.close()


def store_message(customer_id, channel, role, content):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO conversations (customer_id, channel, role, content, timestamp) "
        "VALUES (?, ?, ?, ?, ?)",
        (customer_id, channel, role, content, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


def get_conversation_history(customer_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT channel, role, content, timestamp FROM conversations "
        "WHERE customer_id = ? ORDER BY timestamp",
        (customer_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Customer Identity Registry
# ---------------------------------------------------------------------------
def register_customer(customer_id, name, email=None, phone=None):
    """Register a customer identity for cross-channel resolution."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO customers (id, name, email, phone, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (customer_id, name, email, phone, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return {"id": customer_id, "name": name, "email": email, "phone": phone}


def lookup_customer_by_email(email):
    """Look up a customer by email address. Returns dict or None."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, phone FROM customers WHERE email = ?", (email,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def lookup_customer_by_phone(phone):
    """Look up a customer by phone number. Returns dict or None."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, phone FROM customers WHERE phone = ?", (phone,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def resolve_customer(email=None, phone=None):
    """Resolve a customer by email or phone. Returns customer dict or None."""
    if email:
        customer = lookup_customer_by_email(email)
        if customer:
            return customer
    if phone:
        customer = lookup_customer_by_phone(phone)
        if customer:
            return customer
    return None


def list_customers():
    """Return all registered customers."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, phone, created_at FROM customers ORDER BY created_at")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Telnyx channel functions
# ---------------------------------------------------------------------------
def send_email(to_email, subject, body):
    """Send an email via the Telnyx Email API."""
    resp = requests.post(
        "https://api.telnyx.com/v2/emails",
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": TELNYX_EMAIL_FROM,
            "to": [to_email],
            "subject": subject,
            "text_body": body,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def send_sms(to_number, text):
    """Send an SMS via the Telnyx Messaging API."""
    payload = {
        "from": TELNYX_FROM_NUMBER,
        "to": to_number,
        "text": text,
    }
    if MESSAGING_PROFILE_ID:
        payload["messaging_profile_id"] = MESSAGING_PROFILE_ID
    resp = requests.post(
        "https://api.telnyx.com/v2/messages",
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def make_call(to_number, speak_text):
    """Initiate an outbound call via the Telnyx Call Control API."""
    truncated = speak_text[:400] if speak_text else speak_text
    resp = requests.post(
        "https://api.telnyx.com/v2/calls",
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "connection_id": CONNECTION_ID,
            "to": to_number,
            "from": TELNYX_FROM_NUMBER,
            "webhook_url": f"http://localhost:{PORT}/webhooks/voice",
            "client_state": json.dumps({"speak_text": truncated}).encode().hex()
            if truncated
            else None,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# AI brain — tool definitions (OpenAI-compatible format for Telnyx Inference)
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": (
                "Send a detailed email to the customer. Use for formal "
                "acknowledgments, detailed explanations, or when a written "
                "record is needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {
                        "type": "string",
                        "description": "Email subject line",
                    },
                    "body": {
                        "type": "string",
                        "description": "Email body text",
                    },
                },
                "required": ["subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_sms",
            "description": (
                "Send a short SMS text message to the customer. Use for quick "
                "status updates, confirmations, or time-sensitive notifications."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "SMS message text (keep under 160 chars when possible)",
                    },
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "make_call",
            "description": (
                "Call the customer and speak a message. Use for complex "
                "resolution, urgent matters, or when a personal touch is needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "speak_text": {
                        "type": "string",
                        "description": "Text to speak when the call is answered",
                    },
                },
                "required": ["speak_text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_issue",
            "description": "Mark the customer issue as resolved. Use when the issue has been fully addressed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Brief summary of how the issue was resolved",
                    },
                },
                "required": ["summary"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are an AI customer service agent for TelnyxDemo Corp that carries context across communication channels (email, SMS, voice).

CRITICAL CAPABILITY — CONTEXT CARRYING:
When a customer contacts you on a new channel, you MUST reference their prior interactions:
- If a customer emailed about an issue and then calls, greet them by name and reference their email.
- If a customer called and then texts, reference what was discussed on the call.
- Never ask the customer to repeat information they already provided on another channel.

The conversation history below includes messages from ALL channels (email, SMS, voice). Use this history to:
1. Address the customer by name immediately
2. Reference their specific issue details (booking numbers, dates, amounts)
3. Continue the resolution seamlessly without re-asking questions
4. Proactively confirm what they likely need based on prior context

Channel guidelines:
- **Email**: Formal acknowledgments, detailed explanations, records that need a paper trail
- **SMS**: Quick status updates, confirmations, time-sensitive alerts
- **Voice**: Contextual greetings that reference prior channels, complex resolution, personal touch

When greeting a caller who has prior history, use a warm, contextual greeting like:
"Hi [Name]! I see you [emailed/texted] us about [specific issue]. Are you calling about the same request?"

Mark the issue as resolved only after all necessary communications are complete."""


def execute_tool(tool_name, tool_input, customer):
    """Execute a tool call and return the result string."""
    if tool_name == "send_email":
        send_email(customer["email"], tool_input["subject"], tool_input["body"])
        store_message(
            customer["id"], "email", "assistant",
            f"[Email sent] Subject: {tool_input['subject']}\n{tool_input['body']}",
        )
        return f"Email sent to {customer['email']} with subject: {tool_input['subject']}"

    elif tool_name == "send_sms":
        send_sms(customer["phone"], tool_input["text"])
        store_message(
            customer["id"], "sms", "assistant", f"[SMS sent] {tool_input['text']}",
        )
        return f"SMS sent to {customer['phone']}: {tool_input['text']}"

    elif tool_name == "make_call":
        make_call(customer["phone"], tool_input["speak_text"])
        store_message(
            customer["id"], "voice", "assistant",
            f"[Call initiated] Will speak: {tool_input['speak_text']}",
        )
        return f"Call initiated to {customer['phone']}"

    elif tool_name == "resolve_issue":
        store_message(
            customer["id"], "system", "assistant",
            f"[Issue resolved] {tool_input['summary']}",
        )
        return f"Issue resolved: {tool_input['summary']}"

    return f"Unknown tool: {tool_name}"


def call_inference(messages):
    """Call the Telnyx AI Inference API and return the raw JSON response."""
    resp = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": AI_MODEL,
            "messages": messages,
            "tools": TOOLS,
            "max_tokens": 4096,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def generate_contextual_greeting(customer_id):
    """Generate a contextual greeting that references prior cross-channel interactions.

    This is the core context-carrying feature. It retrieves the customer's full
    conversation history across all channels and asks the AI to generate a greeting
    that demonstrates awareness of prior interactions.
    """
    history = get_conversation_history(customer_id)
    if not history:
        return "Hello! Thank you for contacting TelnyxDemo Corp. How can I help you today?"

    history_text = "\n".join(
        f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an AI customer service agent. A customer is contacting you "
                "on a new channel. Generate a warm, contextual greeting that:\n"
                "1. Addresses them by name if known\n"
                "2. References their specific prior interaction (channel, topic, details)\n"
                "3. Asks if they're contacting about the same issue\n"
                "Keep it to 1-2 sentences. Be specific — mention booking numbers, dates, "
                "or other details from the history."
            ),
        },
        {
            "role": "user",
            "content": f"Prior conversation history:\n{history_text}\n\nGenerate a contextual greeting.",
        },
    ]

    resp = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": AI_MODEL,
            "messages": messages,
            "max_tokens": 256,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def process_inbound_email(customer, from_email, subject, body):
    """Process an inbound email: store it, generate an AI reply, and send it."""
    sse_publish("channel.inbound", {
        "channel": "email",
        "from": from_email,
        "subject": subject,
        "customer": customer,
    })

    store_message(
        customer["id"], "email", "user",
        f"[Inbound email] Subject: {subject}\n{body}",
    )
    sse_publish("journey.step", {
        "step": "email_received",
        "customer_id": customer["id"],
        "detail": f"Email from {customer['name']}: {subject}",
    })

    # Build messages for AI reply
    history = get_conversation_history(customer["id"])
    history_text = "\n".join(
        f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Customer: {customer['name']} (email: {customer['email']}, "
                f"phone: {customer.get('phone', 'N/A')})\n\n"
                f"Inbound email from customer:\nSubject: {subject}\n{body}\n\n"
                f"Full conversation history:\n{history_text}\n\n"
                "Reply to this email. Use the send_email tool to send your reply."
            ),
        },
    ]

    sse_publish("agent.thinking", {"content": "Processing inbound email and generating reply..."})

    # Agentic loop
    while True:
        data = call_inference(messages)
        choice = data["choices"][0]
        msg = choice["message"]

        if msg.get("content"):
            sse_publish("agent.thinking", {"content": msg["content"]})

        if not msg.get("tool_calls"):
            if msg.get("content"):
                sse_publish("agent.done", {"content": msg["content"]})
            break

        messages.append(msg)

        for tc in msg["tool_calls"]:
            fn = tc["function"]
            tool_name = fn["name"]
            tool_input = json.loads(fn.get("arguments", "{}"))

            sse_publish("agent.tool_call", {"tool": tool_name, "input": tool_input})
            result = execute_tool(tool_name, tool_input, customer)

            if tool_name == "resolve_issue":
                sse_publish("agent.resolved", {"summary": tool_input.get("summary", ""), "result": result})
            else:
                sse_publish("agent.tool_result", {"tool": tool_name, "result": result, "_input": tool_input})

            if tool_name == "send_email":
                sse_publish("journey.step", {
                    "step": "email_reply_sent",
                    "customer_id": customer["id"],
                    "detail": f"AI replied to {customer['name']}'s email",
                })

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })


def process_inbound_sms(customer, from_number, text):
    """Process an inbound SMS: store it, generate an AI reply, and send it."""
    sse_publish("channel.inbound", {
        "channel": "sms",
        "from": from_number,
        "text": text,
        "customer": customer,
    })

    store_message(customer["id"], "sms", "user", f"[Inbound SMS] {text}")
    sse_publish("journey.step", {
        "step": "sms_received",
        "customer_id": customer["id"],
        "detail": f"SMS from {customer['name']}: {text}",
    })

    history = get_conversation_history(customer["id"])
    history_text = "\n".join(
        f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Customer: {customer['name']} (email: {customer.get('email', 'N/A')}, "
                f"phone: {customer['phone']})\n\n"
                f"Inbound SMS from customer: {text}\n\n"
                f"Full conversation history:\n{history_text}\n\n"
                "Reply to this SMS. Use the send_sms tool to send your reply. "
                "Reference any prior interactions from other channels."
            ),
        },
    ]

    sse_publish("agent.thinking", {"content": "Processing inbound SMS and generating reply..."})

    while True:
        data = call_inference(messages)
        choice = data["choices"][0]
        msg = choice["message"]

        if msg.get("content"):
            sse_publish("agent.thinking", {"content": msg["content"]})

        if not msg.get("tool_calls"):
            if msg.get("content"):
                sse_publish("agent.done", {"content": msg["content"]})
            break

        messages.append(msg)

        for tc in msg["tool_calls"]:
            fn = tc["function"]
            tool_name = fn["name"]
            tool_input = json.loads(fn.get("arguments", "{}"))

            sse_publish("agent.tool_call", {"tool": tool_name, "input": tool_input})
            result = execute_tool(tool_name, tool_input, customer)

            if tool_name == "resolve_issue":
                sse_publish("agent.resolved", {"summary": tool_input.get("summary", ""), "result": result})
            else:
                sse_publish("agent.tool_result", {"tool": tool_name, "result": result, "_input": tool_input})

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })


# ---------------------------------------------------------------------------
# Webhook endpoints — inbound-first handlers
# ---------------------------------------------------------------------------
@app.route("/webhooks/email", methods=["POST"])
def handle_email():
    """Handle inbound email: resolve customer, store, and trigger AI reply."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")

    if event_type != "email.received":
        return jsonify({"status": "ignored"}), 200

    from_email = p.get("from", {}).get("email", "")
    subject = p.get("subject", "")
    body = p.get("body", "") or p.get("text_body", "")

    if not from_email:
        return jsonify({"status": "ignored"}), 200

    # Resolve customer identity
    customer = resolve_customer(email=from_email)
    if not customer:
        return jsonify({"status": "unknown_customer"}), 200

    sse_publish("agent.identity_resolved", {
        "channel": "email",
        "customer": customer,
        "identifier": from_email,
    })

    # Process in background thread so webhook returns fast
    def _process():
        try:
            process_inbound_email(customer, from_email, subject, body)
        except Exception as exc:
            app.logger.error("Email processing failed: %s", exc)
            sse_publish("agent.error", {"error": str(exc)})

    threading.Thread(target=_process, daemon=True).start()
    return jsonify({"status": "processing"}), 200


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle inbound voice call: resolve customer, answer, greet with context."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    call_control_id = p.get("call_control_id")

    if event_type == "call.initiated" and p.get("direction") == "incoming":
        from_number = p.get("from", "")
        if isinstance(from_number, dict):
            from_number = from_number.get("phone_number", "")

        customer = resolve_customer(phone=from_number)
        if customer:
            sse_publish("agent.identity_resolved", {
                "channel": "voice",
                "customer": customer,
                "identifier": from_number,
            })
            sse_publish("journey.step", {
                "step": "call_received",
                "customer_id": customer["id"],
                "detail": f"Incoming call from {customer['name']}",
            })

        # Answer the call
        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/answer",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={},
            timeout=10,
        )
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        from_number = p.get("from", "")
        if isinstance(from_number, dict):
            from_number = from_number.get("phone_number", "")

        customer = resolve_customer(phone=from_number)
        if customer:
            # Generate contextual greeting from cross-channel history
            sse_publish("agent.context_carry", {
                "customer": customer,
                "action": "loading_cross_channel_history",
            })
            greeting = generate_contextual_greeting(customer["id"])
            store_message(customer["id"], "voice", "assistant", f"[Contextual greeting] {greeting}")
            sse_publish("journey.step", {
                "step": "contextual_greeting",
                "customer_id": customer["id"],
                "detail": greeting,
            })
        else:
            greeting = "Hello! Thank you for calling TelnyxDemo Corp. How can I help you today?"

        # Speak the greeting
        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"payload": greeting, "voice": "female", "language_code": "en-US"},
            timeout=10,
        )
        return jsonify({"status": "greeting"}), 200

    elif event_type == "call.speak.ended":
        # After speaking, gather customer speech
        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/gather",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "input_type": "speech",
                "end_silence_timeout_secs": 2,
                "timeout_secs": 15,
                "language_code": "en-US",
            },
            timeout=10,
        )
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.gather.ended":
        speech = p.get("speech", {}).get("result", "")
        from_number = p.get("from", "")
        if isinstance(from_number, dict):
            from_number = from_number.get("phone_number", "")

        customer = resolve_customer(phone=from_number)

        if not speech:
            requests.post(
                f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak",
                headers={
                    "Authorization": f"Bearer {TELNYX_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "payload": "I didn't catch that. Could you please repeat?",
                    "voice": "female",
                    "language_code": "en-US",
                },
                timeout=10,
            )
            return jsonify({"status": "reprompting"}), 200

        if customer:
            store_message(customer["id"], "voice", "user", f"[Voice] {speech}")

            # Build AI response with full cross-channel history
            history = get_conversation_history(customer["id"])
            history_text = "\n".join(
                f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
            )

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Customer: {customer['name']} (email: {customer.get('email', 'N/A')}, "
                        f"phone: {customer['phone']})\n\n"
                        f"Full cross-channel history:\n{history_text}\n\n"
                        f"Customer just said on the phone: \"{speech}\"\n\n"
                        "Respond to the customer. Keep voice responses under 2 sentences. "
                        "If the customer confirms a request from a prior channel, proceed with "
                        "resolving it. Use send_sms to send a confirmation if appropriate."
                    ),
                },
            ]

            sse_publish("agent.thinking", {"content": f"Processing voice input: {speech}"})

            data_resp = call_inference(messages)
            choice = data_resp["choices"][0]
            msg = choice["message"]
            response_text = msg.get("content", "")

            # Handle tool calls (e.g., send_sms for confirmation)
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    fn = tc["function"]
                    tool_name = fn["name"]
                    tool_input = json.loads(fn.get("arguments", "{}"))
                    sse_publish("agent.tool_call", {"tool": tool_name, "input": tool_input})
                    result = execute_tool(tool_name, tool_input, customer)
                    sse_publish("agent.tool_result", {"tool": tool_name, "result": result, "_input": tool_input})

                    if tool_name == "send_sms":
                        sse_publish("journey.step", {
                            "step": "sms_confirmation_sent",
                            "customer_id": customer["id"],
                            "detail": f"Confirmation SMS sent to {customer['name']}",
                        })

            if not response_text:
                response_text = "I've processed your request. Is there anything else I can help with?"

            store_message(customer["id"], "voice", "assistant", f"[Voice response] {response_text}")
        else:
            response_text = "Thank you for calling. How can I help you today?"

        # Speak the response
        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"payload": response_text, "voice": "female", "language_code": "en-US"},
            timeout=10,
        )
        return jsonify({"status": "responding"}), 200

    elif event_type == "call.hangup":
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/webhooks/messaging", methods=["POST"])
def handle_messaging():
    """Handle inbound SMS: resolve customer, store, and trigger AI reply."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")

    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200

    if p.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200

    from_number = p.get("from", {}).get("phone_number", "")
    text = p.get("text", "")

    if not from_number or not text:
        return jsonify({"status": "ignored"}), 200

    customer = resolve_customer(phone=from_number)
    if not customer:
        return jsonify({"status": "unknown_customer"}), 200

    sse_publish("agent.identity_resolved", {
        "channel": "sms",
        "customer": customer,
        "identifier": from_number,
    })

    def _process():
        try:
            process_inbound_sms(customer, from_number, text)
        except Exception as exc:
            app.logger.error("SMS processing failed: %s", exc)
            sse_publish("agent.error", {"error": str(exc)})

    threading.Thread(target=_process, daemon=True).start()
    return jsonify({"status": "processing"}), 200


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.route("/customers/register", methods=["POST"])
def api_register_customer():
    """Register a customer identity for cross-channel resolution."""
    body = request.get_json()
    if not body:
        return jsonify({"error": "Request body required"}), 400

    customer_id = body.get("id")
    name = body.get("name")
    if not customer_id or not name:
        return jsonify({"error": "id and name required"}), 400

    customer = register_customer(
        customer_id, name,
        email=body.get("email"),
        phone=body.get("phone"),
    )
    return jsonify({"status": "registered", "customer": customer}), 201


@app.route("/customers", methods=["GET"])
def api_list_customers():
    """List all registered customers."""
    return jsonify(list_customers())


@app.route("/customers/<customer_id>/context", methods=["GET"])
def api_customer_context(customer_id):
    """View cross-channel context for a customer."""
    history = get_conversation_history(customer_id)
    channels = list({msg["channel"] for msg in history})
    return jsonify({
        "customer_id": customer_id,
        "channels_used": channels,
        "message_count": len(history),
        "history": history,
    })


@app.route("/conversations", methods=["GET"])
def api_conversations():
    """View all cross-channel conversation history."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT customer_id, channel, role, content, timestamp "
        "FROM conversations ORDER BY timestamp"
    )
    rows = cur.fetchall()
    conn.close()

    customers = {}
    for row in rows:
        cid = row["customer_id"]
        if cid not in customers:
            customers[cid] = []
        customers[cid].append({
            "channel": row["channel"],
            "role": row["role"],
            "content": row["content"],
            "timestamp": row["timestamp"],
        })

    return jsonify(customers)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------------------
# Dashboard & SSE endpoints
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def dashboard():
    """Serve the web dashboard."""
    return render_template("index.html")


@app.route("/stream", methods=["GET"])
def sse_stream():
    """SSE endpoint — streams agent events to the browser."""
    q = queue.Queue(maxsize=200)
    with _sse_lock:
        _sse_subscribers.append(q)

    def generate():
        try:
            while True:
                try:
                    payload = q.get(timeout=30)
                    yield f"data: {payload}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_subscribers:
                    _sse_subscribers.remove(q)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/context/count", methods=["GET"])
def context_count():
    """Return the total number of stored interactions."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM conversations")
    count = cur.fetchone()[0]
    conn.close()
    return jsonify({"count": count})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=PORT, debug=False)
