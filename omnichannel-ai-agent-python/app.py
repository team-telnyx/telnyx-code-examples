"""
Omnichannel AI Agent — one AI agent that emails, texts, and calls customers.

Uses Claude API with tool-calling to decide which channel to use, Telnyx APIs
for Email, SMS, and Voice delivery, and SQLite for persistent cross-channel
conversation context.

Run with real credentials:
    python app.py

Run the demo (no credentials needed):
    python demo/demo_server.py
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone

import anthropic
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER", "")
TELNYX_EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
CONNECTION_ID = os.getenv("CONNECTION_ID", "")
PORT = int(os.getenv("PORT", "5000"))
DB_PATH = os.getenv("DB_PATH", "conversations.db")

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY)
claude_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ---------------------------------------------------------------------------
# SQLite — persistent cross-channel conversation context
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
# Telnyx channel functions
# ---------------------------------------------------------------------------
def send_email(to_email, subject, body):
    """Send an email via the Telnyx Email API."""
    resp = requests.post(
        "https://api.telnyx.com/v2/email_messages",
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "from": {"email": TELNYX_EMAIL_FROM},
            "to": [{"email": to_email}],
            "subject": subject,
            "body": body,
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
            "client_state": json.dumps({"speak_text": speak_text}).encode().hex()
            if speak_text
            else None,
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Claude AI brain — tool definitions
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "name": "send_email",
        "description": (
            "Send a detailed email to the customer. Use for formal "
            "acknowledgments, detailed explanations, or when a written "
            "record is needed."
        ),
        "input_schema": {
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
    {
        "name": "send_sms",
        "description": (
            "Send a short SMS text message to the customer. Use for quick "
            "status updates, confirmations, or time-sensitive notifications."
        ),
        "input_schema": {
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
    {
        "name": "make_call",
        "description": (
            "Call the customer and speak a message. Use for complex "
            "resolution, urgent matters, or when a personal touch is needed."
        ),
        "input_schema": {
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
    {
        "name": "resolve_issue",
        "description": "Mark the customer issue as resolved. Use when the issue has been fully addressed.",
        "input_schema": {
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
]

SYSTEM_PROMPT = """You are an AI customer service agent for TelnyxDemo Corp. You handle customer issues using email, SMS, and voice calls.

You have access to the full cross-channel conversation history. Choose the right channel for each interaction:

- **Email**: Formal acknowledgments, detailed explanations, records that need a paper trail
- **SMS**: Quick status updates, confirmations, time-sensitive alerts
- **Voice call**: Complex resolution, urgent escalation, personal touch for upset customers

Always reference previous interactions across channels — if you emailed the customer, mention it when you text them. Maintain a coherent, professional tone across all channels.

When resolving a billing dispute:
1. First send an email acknowledging receipt and outlining next steps
2. Follow up with an SMS confirming the email was sent and providing a timeline
3. If resolution is complex, call the customer to explain and confirm

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


def run_agent(customer, scenario):
    """Run the AI agent for a customer scenario using Claude tool-calling."""
    # Build messages from conversation history
    history = get_conversation_history(customer["id"])
    history_text = ""
    if history:
        history_text = "\n\nPrevious conversation history:\n"
        for msg in history:
            history_text += f"[{msg['channel']}] {msg['role']}: {msg['content']}\n"

    messages = [
        {
            "role": "user",
            "content": (
                f"Customer: {customer['name']} (email: {customer['email']}, "
                f"phone: {customer['phone']})\n\n"
                f"Issue: {scenario}\n"
                f"{history_text}\n"
                "Handle this customer issue using the appropriate channels. "
                "Use multiple channels as needed for a complete resolution."
            ),
        }
    ]

    store_message(customer["id"], "system", "user", f"[Scenario] {scenario}")

    actions = []

    # Agentic loop — keep going until Claude stops calling tools
    while True:
        response = claude_client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            # Extract final text
            for block in response.content:
                if block.type == "text" and block.text:
                    actions.append({"type": "text", "content": block.text})
            break

        # Process tool calls
        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for tool in tool_use_blocks:
            result = execute_tool(tool.name, tool.input, customer)
            actions.append({
                "type": "tool_call",
                "tool": tool.name,
                "input": tool.input,
                "result": result,
            })
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool.id,
                "content": result,
            })

        messages.append({"role": "user", "content": tool_results})

    return actions


# ---------------------------------------------------------------------------
# Webhook endpoints
# ---------------------------------------------------------------------------
@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle Call Control webhook events."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    call_control_id = p.get("call_control_id")

    if event_type == "call.answered":
        # Decode client_state to get the speak_text
        client_state_hex = p.get("client_state", "")
        speak_text = "Hello, this is TelnyxDemo Corp calling."
        if client_state_hex:
            try:
                state = json.loads(bytes.fromhex(client_state_hex).decode())
                speak_text = state.get("speak_text", speak_text)
            except (ValueError, json.JSONDecodeError):
                pass

        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"payload": speak_text, "voice": "female", "language_code": "en-US"},
            timeout=10,
        )
        return jsonify({"status": "speaking"}), 200

    elif event_type == "call.speak.ended":
        requests.post(
            f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/hangup",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        return jsonify({"status": "hanging_up"}), 200

    elif event_type == "call.hangup":
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/webhooks/messaging", methods=["POST"])
def handle_messaging():
    """Handle inbound SMS replies."""
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

    if from_number and text:
        store_message(from_number, "sms", "user", f"[Inbound SMS] {text}")

    return jsonify({"status": "received"}), 200


@app.route("/webhooks/email", methods=["POST"])
def handle_email():
    """Handle inbound email replies."""
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
    body = p.get("body", "")

    if from_email:
        store_message(
            from_email, "email", "user",
            f"[Inbound email] Subject: {subject}\n{body}",
        )

    return jsonify({"status": "received"}), 200


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.route("/agent/run", methods=["POST"])
def trigger_agent():
    """Trigger the AI agent for a customer scenario."""
    body = request.get_json()
    if not body:
        return jsonify({"error": "Request body required"}), 400

    customer = body.get("customer", {})
    scenario = body.get("scenario", "")

    if not customer.get("id") or not scenario:
        return jsonify({"error": "customer.id and scenario required"}), 400

    actions = run_agent(customer, scenario)
    return jsonify({"status": "completed", "actions": actions})


@app.route("/conversations", methods=["GET"])
def list_conversations():
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

    # Group by customer
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


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=PORT, debug=False)
