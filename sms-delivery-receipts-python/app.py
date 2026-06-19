#!/usr/bin/env python3
"""Production-ready Flask application for SMS delivery receipt tracking."""

import os
import sqlite3
import json
from datetime import datetime
from dotenv import load_dotenv
import telnyx
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Database configuration
DB_PATH = "receipts.db"


def get_db_connection():
    """Get a database connection with row factory for dict-like access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def send_sms_with_tracking(to_number: str, message: str) -> dict:
    """Send SMS via Telnyx and store message record for tracking."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    # Validate E.164 format
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Send message via Telnyx API
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Store message record in database for tracking
    message_id = response.data.id
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        """
        INSERT INTO messages (id, from_number, to_number, text, status, direction)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (message_id, from_number, to_number, message, "queued", "outbound"),
    )
    conn.commit()
    conn.close()
    
    # Return JSON-serializable response
    return {
        "message_id": message_id,
        "status": "queued",
        "from": from_number,
        "to": to_number,
    }


@app.route("/sms/send", methods=["POST"])
def send_sms_endpoint():
    """HTTP endpoint to send SMS and begin tracking delivery."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    message = data.get("message")
    
    if not to_number or not message:
        return jsonify({"error": "Missing required fields: 'to' and 'message'"}), 400
    
    try:
        result = send_sms_with_tracking(to_number, message)
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


@app.route("/webhooks/message", methods=["POST"])
def handle_message_webhook():
    """
    Receive and process message.finalized webhook events.
    Updates message status and stores delivery receipt.
    """
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "Empty payload"}), 400
    
    # Extract event data — webhook structure: {"data": {"event_type": "...", "payload": {...}}}
    event_type = payload.get("data", {}).get("event_type")
    event_payload = payload.get("data", {}).get("payload", {})
    
    # Only process message.finalized events
    if event_type != "message.finalized":
        return jsonify({"status": "ignored"}), 200
    
    message_id = event_payload.get("id")
    if not message_id:
        return jsonify({"error": "Missing message ID in webhook"}), 400
    
    # Extract delivery status from the to array
    to_array = event_payload.get("to", [])
    if not to_array:
        return jsonify({"error": "Missing 'to' array in webhook"}), 400
    
    to_entry = to_array[0]
    delivery_status = to_entry.get("status", "unknown")
    error_code = to_entry.get("error_code")
    error_message = to_entry.get("error_message")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if receipt already exists (idempotency)
        cursor.execute(
            "SELECT id FROM delivery_receipts WHERE message_id = ?",
            (message_id,),
        )
        existing = cursor.fetchone()
        
        if existing:
            # Already processed — return success to acknowledge webhook
            conn.close()
            return jsonify({"status": "already_processed"}), 200
        
        # Update message status
        cursor.execute(
            """
            UPDATE messages
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (delivery_status, message_id),
        )
        
        # Store delivery receipt
        cursor.execute(
            """
            INSERT INTO delivery_receipts (message_id, status, error_code, error_message)
            VALUES (?, ?, ?, ?)
            """,
            (message_id, delivery_status, error_code, error_message),
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({"status": "processed"}), 200
        
    except sqlite3.IntegrityError:
        # Duplicate message_id — idempotent response
        return jsonify({"status": "already_processed"}), 200
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages/<message_id>", methods=["GET"])
def get_message_status(message_id: str):
    """Retrieve message and delivery receipt status by message ID."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Fetch message record
        cursor.execute(
            "SELECT * FROM messages WHERE id = ?",
            (message_id,),
        )
        message = cursor.fetchone()
        
        if not message:
            conn.close()
            return jsonify({"error": "Message not found"}), 404
        
        # Fetch delivery receipt if available
        cursor.execute(
            "SELECT * FROM delivery_receipts WHERE message_id = ?",
            (message_id,),
        )
        receipt = cursor.fetchone()
        conn.close()
        
        # Build response — convert Row objects to dicts
        response = {
            "id": message["id"],
            "from": message["from_number"],
            "to": message["to_number"],
            "text": message["text"],
            "status": message["status"],
            "direction": message["direction"],
            "created_at": message["created_at"],
            "updated_at": message["updated_at"],
        }
        
        if receipt:
            response["delivery_receipt"] = {
                "status": receipt["status"],
                "error_code": receipt["error_code"],
                "error_message": receipt["error_message"],
                "received_at": receipt["received_at"],
            }
        
        return jsonify(response), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/messages", methods=["GET"])
def list_messages():
    """List all messages with optional status filter."""
    status_filter = request.args.get("status")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if status_filter:
            cursor.execute(
                "SELECT * FROM messages WHERE status = ? ORDER BY created_at DESC",
                (status_filter,),
            )
        else:
            cursor.execute(
                "SELECT * FROM messages ORDER BY created_at DESC"
            )
        
        messages = cursor.fetchall()
        conn.close()
        
        # Convert Row objects to dicts
        return jsonify([
            {
                "id": m["id"],
                "from": m["from_number"],
                "to": m["to_number"],
                "status": m["status"],
                "direction": m["direction"],
                "created_at": m["created_at"],
            }
            for m in messages
        ]), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
