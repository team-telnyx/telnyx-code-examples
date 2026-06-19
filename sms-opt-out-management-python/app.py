#!/usr/bin/env python3
"""Production-ready Flask application for SMS opt-out management via Telnyx."""

import os
import sqlite3
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from datetime import datetime

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

DB_PATH = os.getenv("DB_PATH", "optout.db")


def init_db():
    """Initialize the opt-out database with required schema."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS optouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT UNIQUE NOT NULL,
            opted_out_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reason TEXT,
            source TEXT
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS message_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            from_number TEXT,
            to_number TEXT,
            direction TEXT,
            status TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    conn.close()


def is_opted_out(phone_number: str) -> bool:
    """Check if a phone number is in the opt-out list."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM optouts WHERE phone_number = ?", (phone_number,))
    result = cursor.fetchone()
    conn.close()
    
    return result is not None


def add_optout(phone_number: str, reason: str = None, source: str = "api") -> dict:
    """Add a phone number to the opt-out list."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            "INSERT INTO optouts (phone_number, reason, source) VALUES (?, ?, ?)",
            (phone_number, reason, source)
        )
        conn.commit()
        conn.close()
        return {"phone_number": phone_number, "status": "opted_out"}
    except sqlite3.IntegrityError:
        conn.close()
        return {"phone_number": phone_number, "status": "already_opted_out"}


def remove_optout(phone_number: str) -> dict:
    """Remove a phone number from the opt-out list."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM optouts WHERE phone_number = ?", (phone_number,))
    conn.commit()
    conn.close()
    
    return {"phone_number": phone_number, "status": "opted_in"}


def get_optout_list() -> list:
    """Retrieve all opted-out phone numbers."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT phone_number, opted_out_at, reason, source FROM optouts ORDER BY opted_out_at DESC")
    rows = cursor.fetchall()
    conn.close()
    
    return [
        {
            "phone_number": row[0],
            "opted_out_at": row[1],
            "reason": row[2],
            "source": row[3],
        }
        for row in rows
    ]


def log_message(message_id: str, from_number: str, to_number: str, direction: str, status: str):
    """Log a message for audit purposes."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            "INSERT INTO message_log (message_id, from_number, to_number, direction, status) VALUES (?, ?, ?, ?, ?)",
            (message_id, from_number, to_number, direction, status)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    finally:
        conn.close()


def send_sms(to_number: str, message: str) -> dict:
    """
    Send SMS via Telnyx after checking opt-out status.
    Raises ValueError if recipient is opted out.
    """
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Check opt-out status before sending
    if is_opted_out(to_number):
        raise ValueError(f"Recipient {to_number} has opted out of SMS messages")
    
    # Send message via Telnyx
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Log the message
    status = response.data.to[0].status if response.data.to else "unknown"
    log_message(
        message_id=response.data.id,
        from_number=from_number,
        to_number=to_number,
        direction="outbound",
        status=status
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": status,
        "from": from_number,
        "to": to_number,
    }


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send SMS with opt-out checking."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_sms(to_number, message)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/optout/add", methods=["POST"])
def add_optout_endpoint():
    """Manually add a phone number to the opt-out list."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    reason = data.get("reason")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    if not phone_number.startswith("+"):
        return jsonify({"error": "Phone number must be in E.164 format"}), 400
    
    result = add_optout(phone_number, reason=reason, source="manual")
    return jsonify(result), 200


@app.route("/optout/remove", methods=["POST"])
def remove_optout_endpoint():
    """Remove a phone number from the opt-out list."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    result = remove_optout(phone_number)
    return jsonify(result), 200


@app.route("/optout/list", methods=["GET"])
def list_optouts_endpoint():
    """Retrieve all opted-out phone numbers."""
    optouts = get_optout_list()
    return jsonify({"optouts": optouts, "count": len(optouts)}), 200


@app.route("/optout/check", methods=["POST"])
def check_optout_endpoint():
    """Check if a phone number is opted out."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    phone_number = data.get("phone_number")
    
    if not phone_number:
        return jsonify({"error": "Missing required field: 'phone_number'"}), 400
    
    opted_out = is_opted_out(phone_number)
    return jsonify({"phone_number": phone_number, "opted_out": opted_out}), 200


@app.route("/webhooks/sms", methods=["POST"])
def handle_sms_webhook():
    """
    Handle inbound SMS webhooks from Telnyx.
    Automatically opt out users who reply with 'STOP' or 'UNSUBSCRIBE'.
    """
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    # Extract webhook event data
    event_type = data.get("data", {}).get("event_type")
    
    # Only process message.received events
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    message_data = data.get("data", {})
    from_number = message_data.get("from", {}).get("phone_number")
    text = message_data.get("text", "").upper().strip()
    message_id = message_data.get("id")
    
    # Log the inbound message
    if message_id and from_number:
        log_message(
            message_id=message_id,
            from_number=from_number,
            to_number=os.getenv("TELNYX_PHONE_NUMBER"),
            direction="inbound",
            status="received"
        )
    
    # Check for opt-out keywords
    if from_number and text in ["STOP", "UNSUBSCRIBE", "STOPALL", "QUIT"]:
        add_optout(from_number, reason=f"User replied with: {text}", source="webhook")
        return jsonify({"status": "opted_out", "phone_number": from_number}), 200
    
    return jsonify({"status": "processed"}), 200


if __name__ == "__main__":
    init_db()
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
