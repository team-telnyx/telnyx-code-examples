"""
Customer Support Across Email & WhatsApp — unified dashboard demo.

A customer contacts an online retailer about a damaged order. Support
happens across both Email and WhatsApp channels while a unified dashboard
tracks the entire journey in real time.

Uses Telnyx Email API and Telnyx Messaging API (WhatsApp), SQLite for
persistent cross-channel context, and SSE for live dashboard updates.

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

import logging
import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.DEBUG)
logging.basicConfig(level=logging.DEBUG)

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
TELNYX_EMAIL_API_KEY = os.getenv("TELNYX_EMAIL_API_KEY", "") or TELNYX_API_KEY
TELNYX_WHATSAPP_API_KEY = os.getenv("TELNYX_WHATSAPP_API_KEY", "") or TELNYX_API_KEY
TELNYX_EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "harpreet@telnyx.com")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
PORT = int(os.getenv("PORT", "5050"))
DB_PATH = os.getenv("DB_PATH", "support.db")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")


# ---------------------------------------------------------------------------
# SQLite — persistent cross-channel context, customer registry, orders
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
    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id                  TEXT PRIMARY KEY,
            customer_id         TEXT NOT NULL,
            product             TEXT,
            status              TEXT,
            tracking            TEXT,
            damage_photo_url    TEXT,
            replacement_tracking TEXT
        )
    """)
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
# Order helpers
# ---------------------------------------------------------------------------
def create_order(order_id, customer_id, product, status="delivered", tracking=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO orders (id, customer_id, product, status, tracking) "
        "VALUES (?, ?, ?, ?, ?)",
        (order_id, customer_id, product, status, tracking),
    )
    conn.commit()
    conn.close()


def update_order(order_id, **fields):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [order_id]
    cur.execute(f"UPDATE orders SET {sets} WHERE id = ?", vals)
    conn.commit()
    conn.close()


def get_order(order_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_orders_for_customer(customer_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM orders WHERE customer_id = ? ORDER BY id", (customer_id,))
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
# Channel helpers — Email and WhatsApp
# ---------------------------------------------------------------------------
def send_email(to_email, subject, body):
    """Send an email via the Telnyx Email API."""
    resp = requests.post(
        "https://api.telnyx.com/v2/emails",
        headers={
            "Authorization": f"Bearer {TELNYX_EMAIL_API_KEY}",
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


def send_whatsapp(to_number, text, template=None, template_params=None, media_url=None):
    """Send a WhatsApp message via the Telnyx WhatsApp API.

    For business-initiated conversations (no active 24-hour window), use
    template= with an approved template name and template_params= for
    the positional parameters.  Once the customer replies the 24-hour
    freeform window opens and plain text/image messages work.
    """
    payload = {
        "from": WHATSAPP_NUMBER,
        "to": to_number,
    }

    if template:
        # Business-initiated: use an approved template
        components = []
        if template_params:
            components.append({
                "type": "body",
                "parameters": [
                    {"type": "text", "text": str(p)} for p in template_params
                ],
            })
        payload["whatsapp_message"] = {
            "type": "template",
            "template": {
                "name": template,
                "language": {"policy": "deterministic", "code": "en_US"},
                "components": components,
            },
        }
    elif media_url:
        payload["whatsapp_message"] = {
            "type": "image",
            "image": {"link": media_url, "caption": text},
        }
    else:
        payload["whatsapp_message"] = {"type": "text", "text": {"body": text}}

    resp = requests.post(
        "https://api.telnyx.com/v2/messages/whatsapp",
        headers={
            "Authorization": f"Bearer {TELNYX_WHATSAPP_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Phone masking
# ---------------------------------------------------------------------------
def mask_phone(phone):
    """Mask a phone number for dashboard display: +31••••••1895."""
    if not phone or len(phone) < 6:
        return phone
    return phone[:3] + "\u2022" * (len(phone) - 7) + phone[-4:]


# ---------------------------------------------------------------------------
# AI Agentic Loop — system prompt, tools, inference
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are an AI customer support agent for TelnyxDemo Corp, handling damaged-order support across Email and WhatsApp channels.

You have access to the customer's full conversation history across both channels. Use this context to provide seamless, cross-channel support.

Guidelines:
- Use EMAIL for: formal acknowledgments, shipping confirmations with tracking numbers, case summaries
- Use WHATSAPP for: quick updates, requesting photos of damage, short confirmations
- Always reference the customer by name
- When a customer reports damage via email, acknowledge by email AND reach out on WhatsApp to request a damage photo
- When you receive a damage photo via WhatsApp, confirm replacement approval on WhatsApp, then send shipping confirmation via email
- Use update_order to track status changes through the pipeline: damage_reported → replacement_shipping → resolved
- Call resolve_case when the issue is fully resolved

WhatsApp messaging rules:
- Send plain text WhatsApp messages (do NOT use templates). The customer has already initiated the conversation.
- If a template is needed in the future, available templates are: 'support_damage_photo' (params: customer_name, order_id) and 'support_replacement_confirm' (params: customer_name, order_id, tracking_number).

Order status pipeline: delivered → damage_reported → replacement_shipping → resolved"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Send a formal email to the customer. Use for acknowledgments, shipping confirmations, and case summaries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_email": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject line"},
                    "body": {"type": "string", "description": "Email body text"},
                },
                "required": ["to_email", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_whatsapp",
            "description": (
                "Send a WhatsApp message to the customer. "
                "For the FIRST outbound message to a customer you MUST use a template to initiate the conversation. "
                "Available templates: "
                "'support_damage_photo' (params: customer_name, order_id) — request a damage photo. "
                "'support_replacement_confirm' (params: customer_name, order_id, tracking_number) — confirm replacement shipment. "
                "After the customer replies, you may send plain text messages without a template."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to_number": {"type": "string", "description": "Recipient phone number in E.164 format"},
                    "text": {"type": "string", "description": "Message text (used for plain text messages, ignored when template is set)"},
                    "template": {"type": "string", "description": "Template name for business-initiated messages: 'support_damage_photo' or 'support_replacement_confirm'"},
                    "template_params": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Positional parameters for the template (e.g. [customer_name, order_id])",
                    },
                },
                "required": ["to_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_order",
            "description": "Update an order's status or details. Use to track damage reports, attach photos, add replacement tracking, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "The order ID to update"},
                    "status": {"type": "string", "description": "New status: damage_reported, replacement_shipping, or resolved"},
                    "damage_photo_url": {"type": "string", "description": "URL of the damage photo"},
                    "replacement_tracking": {"type": "string", "description": "Tracking number for the replacement shipment"},
                },
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_case",
            "description": "Mark the support case as resolved. Call this when the issue is fully handled.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Brief summary of how the case was resolved"},
                },
                "required": ["summary"],
            },
        },
    },
]


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


def execute_tool(tool_name, tool_input, customer):
    """Route an AI tool call to the appropriate channel function."""
    if tool_name == "send_email":
        to_email = tool_input.get("to_email", customer.get("email", ""))
        subject = tool_input.get("subject", "")
        body = tool_input.get("body", "")
        send_email(to_email, subject, body)
        store_message(customer["id"], "email", "assistant", f"Subject: {subject}\n{body}")
        sse_publish("channel.email", {
            "direction": "outbound",
            "from": TELNYX_EMAIL_FROM,
            "subject": subject,
            "body": body,
            "customer": customer,
        })
        return json.dumps({"status": "sent", "channel": "email", "to": to_email})

    if tool_name == "send_whatsapp":
        to_number = tool_input.get("to_number", customer.get("phone", ""))
        text = tool_input.get("text", "")
        template = tool_input.get("template")
        template_params = tool_input.get("template_params")
        try:
            send_whatsapp(to_number, text, template=template, template_params=template_params)
        except requests.HTTPError:
            # Template may not be approved yet or window issue — fall back to plain text
            if template and text:
                app.logger.warning("Template '%s' failed, falling back to plain text", template)
                send_whatsapp(to_number, text)
            elif template and template_params:
                # Build a plain text version from the template params
                fallback = f"Hi {template_params[0]}, " + " ".join(str(p) for p in template_params[1:])
                app.logger.warning("Template '%s' failed, sending fallback text", template)
                send_whatsapp(to_number, fallback)
            else:
                raise
        display_text = text if not template else f"[Template: {template}] params={template_params}"
        store_message(customer["id"], "whatsapp", "assistant", display_text)
        sse_publish("channel.whatsapp", {
            "direction": "outbound",
            "text": text,
            "customer": customer,
            "customer_name": customer.get("name", ""),
        })
        return json.dumps({"status": "sent", "channel": "whatsapp", "to": to_number})

    if tool_name == "update_order":
        order_id = tool_input.get("order_id", "")
        fields = {k: v for k, v in tool_input.items() if k != "order_id" and v is not None}
        if fields:
            update_order(order_id, **fields)
        order = get_order(order_id)
        if order:
            sse_publish("order.update", {"order": order})
        return json.dumps({"status": "updated", "order": order})

    if tool_name == "resolve_case":
        summary = tool_input.get("summary", "Case resolved")
        sse_publish("journey.complete", {"summary": summary})
        return json.dumps({"status": "resolved", "summary": summary})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


def process_inbound_email(customer, from_email, subject, body):
    """Process an inbound email: run the AI agentic loop to generate responses."""
    history = get_conversation_history(customer["id"])
    history_text = "\n".join(
        f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
    )

    orders = get_orders_for_customer(customer["id"])
    orders_text = "\n".join(
        f"Order {o['id']}: {o['product']} — status: {o['status']}" for o in orders
    ) if orders else "No orders found."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Customer: {customer['name']} (email: {customer['email']}, "
                f"phone: {customer.get('phone', 'N/A')})\n\n"
                f"Customer orders:\n{orders_text}\n\n"
                f"Inbound email from customer:\nSubject: {subject}\n{body}\n\n"
                f"Full conversation history:\n{history_text}\n\n"
                "Handle this customer email. Acknowledge via email, update order status, "
                "and reach out on WhatsApp if you need a damage photo."
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
            sse_publish("agent.tool_result", {"tool": tool_name, "result": result})

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })


def process_inbound_whatsapp(customer, from_number, text, media_urls):
    """Process an inbound WhatsApp message: run the AI agentic loop to generate responses."""
    history = get_conversation_history(customer["id"])
    history_text = "\n".join(
        f"[{msg['channel']}] {msg['role']}: {msg['content']}" for msg in history
    )

    orders = get_orders_for_customer(customer["id"])
    orders_text = "\n".join(
        f"Order {o['id']}: {o['product']} — status: {o['status']}" for o in orders
    ) if orders else "No orders found."

    media_info = ""
    if media_urls:
        media_info = f"\nAttached media: {', '.join(media_urls)}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Customer: {customer['name']} (email: {customer['email']}, "
                f"phone: {customer.get('phone', 'N/A')})\n\n"
                f"Customer orders:\n{orders_text}\n\n"
                f"Inbound WhatsApp message from customer:\n{text}{media_info}\n\n"
                f"Full conversation history:\n{history_text}\n\n"
                "Handle this WhatsApp message. If a damage photo was received, "
                "update the order with the photo URL, confirm replacement on WhatsApp, "
                "and send shipping confirmation via email."
            ),
        },
    ]

    sse_publish("agent.thinking", {"content": "Processing inbound WhatsApp message..."})

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
            sse_publish("agent.tool_result", {"tool": tool_name, "result": result})

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })


# ---------------------------------------------------------------------------
# Webhook handlers
# ---------------------------------------------------------------------------
@app.route("/webhooks/email", methods=["POST"])
def handle_email():
    """Handle inbound email: resolve customer, store, publish SSE."""
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

    customer = resolve_customer(email=from_email)
    if not customer:
        return jsonify({"status": "unknown_customer"}), 200

    sse_publish("status.update", {"status": "running"})
    sse_publish("customer.registered", {"customer": customer})
    sse_publish("agent.identity_resolved", {
        "channel": "email",
        "customer": customer,
        "identifier": from_email,
    })

    # Publish order info if available
    orders = get_orders_for_customer(customer["id"])
    if orders:
        sse_publish("order.update", {"order": orders[0]})

    store_message(
        customer["id"], "email", "user",
        f"Subject: {subject}\n{body}",
    )
    sse_publish("channel.email", {
        "direction": "inbound",
        "from": from_email,
        "subject": subject,
        "body": body,
        "customer": customer,
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


@app.route("/webhooks/whatsapp", methods=["POST"])
def handle_whatsapp():
    """Handle inbound WhatsApp message: resolve customer, store, publish SSE."""
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
    body = p.get("body", {})
    msg_type = body.get("type", "text")

    # Extract text — location depends on message type
    if msg_type == "text":
        text = body.get("text", {}).get("body", "") if isinstance(body.get("text"), dict) else body.get("text", "")
    else:
        text = body.get("caption", "") or body.get(msg_type, {}).get("caption", "") or ""

    # Extract media URL from image/video/document/audio types
    media_urls = []
    for mtype in ("image", "video", "document", "audio"):
        media_obj = body.get(mtype, {})
        if isinstance(media_obj, dict) and media_obj.get("url"):
            media_urls.append(media_obj["url"])

    if not from_number:
        return jsonify({"status": "ignored"}), 200

    customer = resolve_customer(phone=from_number)
    if not customer:
        return jsonify({"status": "unknown_customer"}), 200

    sse_publish("status.update", {"status": "running"})
    sse_publish("customer.registered", {"customer": customer})
    sse_publish("agent.identity_resolved", {
        "channel": "whatsapp",
        "customer": customer,
        "identifier": from_number,
    })

    content = text
    if media_urls:
        content += ("\n" if content else "") + "[Attachments: " + ", ".join(media_urls) + "]"
    if not content:
        content = f"[{msg_type} message received]"

    store_message(customer["id"], "whatsapp", "user", content)
    display_text = text or (f"[Photo attached]" if media_urls else f"[{msg_type} message]")
    sse_publish("channel.whatsapp", {
        "direction": "inbound",
        "from": from_number,
        "text": display_text,
        "media_url": media_urls[0] if media_urls else None,
        "media_urls": media_urls,
        "customer": customer,
    })

    # Process in background thread so webhook returns fast
    def _process():
        try:
            process_inbound_whatsapp(customer, from_number, text, media_urls)
        except Exception as exc:
            app.logger.error("WhatsApp processing failed: %s", exc)
            sse_publish("agent.error", {"error": str(exc)})

    threading.Thread(target=_process, daemon=True).start()
    return jsonify({"status": "processing"}), 200


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "mode": os.getenv("DEMO_MODE", "live"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/customers", methods=["GET"])
def api_list_customers():
    return jsonify(list_customers())


@app.route("/customers/register", methods=["POST"])
def api_register_customer():
    """Register a new customer via API."""
    data = request.get_json()
    if not data or not data.get("id") or not data.get("name"):
        return jsonify({"error": "id and name are required"}), 400
    customer = register_customer(
        data["id"], data["name"],
        email=data.get("email"), phone=data.get("phone"),
    )
    return jsonify(customer), 201


@app.route("/conversations", methods=["GET"])
def api_conversations():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "SELECT customer_id, channel, role, content, timestamp "
        "FROM conversations ORDER BY timestamp"
    )
    rows = cur.fetchall()
    conn.close()
    result = {}
    for row in rows:
        cid = row["customer_id"]
        if cid not in result:
            result[cid] = []
        result[cid].append({
            "channel": row["channel"],
            "role": row["role"],
            "content": row["content"],
            "timestamp": row["timestamp"],
        })
    return jsonify(result)


@app.route("/orders", methods=["GET"])
def api_orders():
    customer_id = request.args.get("customer_id")
    if customer_id:
        return jsonify(get_orders_for_customer(customer_id))
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM orders ORDER BY id")
    rows = cur.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/orders/<order_id>", methods=["GET"])
def api_order(order_id):
    order = get_order(order_id)
    if not order:
        return jsonify({"error": "Not found"}), 404
    return jsonify(order)


# ---------------------------------------------------------------------------
# Dashboard & SSE endpoints
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def dashboard():
    return render_template("index.html")


@app.route("/stream", methods=["GET"])
def sse_stream():
    """SSE endpoint — streams events to the browser."""
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


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=PORT, debug=False)
