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
TELNYX_EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "")
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
PORT = int(os.getenv("PORT", "5050"))
DB_PATH = os.getenv("DB_PATH", "support.db")


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


def send_whatsapp(to_number, text, template=None, media_url=None):
    """Send a WhatsApp message via the Telnyx Messaging API."""
    payload = {
        "from": WHATSAPP_NUMBER,
        "to": to_number,
        "text": text,
        "messaging_profile_id": MESSAGING_PROFILE_ID,
        "type": "whatsapp",
    }
    if media_url:
        payload["media_urls"] = [media_url]
    if template:
        payload["template"] = template

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

    sse_publish("agent.identity_resolved", {
        "channel": "email",
        "customer": customer,
        "identifier": from_email,
    })

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

    return jsonify({"status": "received"}), 200


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
    text = p.get("text", "")
    media = p.get("media", [])

    if not from_number:
        return jsonify({"status": "ignored"}), 200

    customer = resolve_customer(phone=from_number)
    if not customer:
        return jsonify({"status": "unknown_customer"}), 200

    sse_publish("agent.identity_resolved", {
        "channel": "whatsapp",
        "customer": customer,
        "identifier": from_number,
    })

    media_urls = [m.get("url", "") for m in media if m.get("url")]
    content = text
    if media_urls:
        content += "\n[Attachments: " + ", ".join(media_urls) + "]"

    store_message(customer["id"], "whatsapp", "user", content)
    sse_publish("channel.whatsapp", {
        "direction": "inbound",
        "from": from_number,
        "text": text,
        "media_urls": media_urls,
        "customer": customer,
    })

    return jsonify({"status": "received"}), 200


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
