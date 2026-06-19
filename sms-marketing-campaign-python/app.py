#!/usr/bin/env python3
"""Production-ready SMS marketing platform with Flask and Telnyx."""

import os
import json
import time
import sqlite3
import uuid
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request
import telnyx

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# Rate limiting configuration
RATE_LIMIT_DELAY = 0.1  # 100ms between messages to stay under API limits
MAX_MESSAGES_PER_SECOND = 10


def get_db():
    """Get database connection with row factory for dict-like access."""
    conn = sqlite3.connect("marketing.db")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database schema on startup."""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending'
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS campaign_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            message_id TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS message_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def validate_phone_number(phone: str) -> bool:
    """Validate phone number is in E.164 format."""
    return phone.startswith("+") and len(phone) >= 10 and phone[1:].isdigit()


def send_sms_message(to_number: str, message: str, campaign_id: str = None) -> dict:
    """Send SMS via Telnyx and return JSON-serializable response data."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    if not validate_phone_number(to_number):
        raise ValueError(f"Invalid phone number format: {to_number}. Use E.164 format.")
    
    # Create message with optional campaign tracking
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=message,
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "message_id": response.data.id,
        "status": response.data.to[0].status if response.data.to else "queued",
        "from": from_number,
        "to": to_number,
        "campaign_id": campaign_id,
    }


def create_campaign(name: str, message: str, recipients: list) -> dict:
    """Create a new marketing campaign and queue messages for delivery."""
    campaign_id = str(uuid.uuid4())
    conn = get_db()
    
    try:
        # Insert campaign record
        conn.execute(
            "INSERT INTO campaigns (id, name, message, status) VALUES (?, ?, ?, ?)",
            (campaign_id, name, message, "queued")
        )
        
        # Insert recipient records
        for recipient in recipients:
            if not validate_phone_number(recipient):
                continue  # Skip invalid numbers
            conn.execute(
                "INSERT INTO campaign_recipients (campaign_id, phone_number) VALUES (?, ?)",
                (campaign_id, recipient)
            )
        
        conn.commit()
        
        return {
            "campaign_id": campaign_id,
            "name": name,
            "recipient_count": len([r for r in recipients if validate_phone_number(r)]),
            "status": "queued",
        }
    finally:
        conn.close()


def send_campaign_batch(campaign_id: str, batch_size: int = 100) -> dict:
    """Send queued messages for a campaign with rate limiting."""
    conn = get_db()
    
    try:
        # Get campaign details
        campaign = conn.execute(
            "SELECT * FROM campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()
        
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")
        
        # Get pending recipients
        recipients = conn.execute(
            "SELECT id, phone_number FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' LIMIT ?",
            (campaign_id, batch_size)
        ).fetchall()
        
        sent_count = 0
        failed_count = 0
        
        for recipient in recipients:
            try:
                # Apply rate limiting to avoid hitting API limits
                time.sleep(RATE_LIMIT_DELAY)
                
                result = send_sms_message(
                    recipient["phone_number"],
                    campaign["message"],
                    campaign_id
                )
                
                # Update recipient with message ID and status
                conn.execute(
                    "UPDATE campaign_recipients SET message_id = ?, status = ? WHERE id = ?",
                    (result["message_id"], result["status"], recipient["id"])
                )
                sent_count += 1
                
            except (telnyx.APIStatusError, ValueError) as e:
                # Mark recipient as failed and continue with next
                conn.execute(
                    "UPDATE campaign_recipients SET status = 'failed' WHERE id = ?",
                    (recipient["id"],)
                )
                failed_count += 1
        
        # Update campaign status if all messages sent
        pending_count = conn.execute(
            "SELECT COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'",
            (campaign_id,)
        ).fetchone()["count"]
        
        if pending_count == 0:
            conn.execute(
                "UPDATE campaigns SET status = 'sent' WHERE id = ?",
                (campaign_id,)
            )
        
        conn.commit()
        
        return {
            "campaign_id": campaign_id,
            "sent": sent_count,
            "failed": failed_count,
            "remaining": pending_count,
        }
    finally:
        conn.close()


def get_campaign_status(campaign_id: str) -> dict:
    """Get detailed status of a campaign."""
    conn = get_db()
    
    try:
        campaign = conn.execute(
            "SELECT * FROM campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()
        
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")
        
        # Count recipients by status
        stats = conn.execute(
            """
            SELECT 
                status,
                COUNT(*) as count
            FROM campaign_recipients
            WHERE campaign_id = ?
            GROUP BY status
            """,
            (campaign_id,)
        ).fetchall()
        
        status_breakdown = {row["status"]: row["count"] for row in stats}
        
        return {
            "campaign_id": campaign_id,
            "name": campaign["name"],
            "status": campaign["status"],
            "created_at": campaign["created_at"],
            "total_recipients": sum(status_breakdown.values()),
            "breakdown": status_breakdown,
        }
    finally:
        conn.close()


# Flask Routes

@app.route("/campaigns", methods=["POST"])
def create_campaign_endpoint():
    """Create a new SMS marketing campaign."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    name = data.get("name")
    message = data.get("message")
    recipients = data.get("recipients", [])
    
    if not name or not message or not recipients:
        return jsonify({"error": "Missing required fields: 'name', 'message', 'recipients'"}), 400
    
    if not isinstance(recipients, list) or len(recipients) == 0:
        return jsonify({"error": "Recipients must be a non-empty list of phone numbers"}), 400
    
    if len(message) > 160:
        return jsonify({"error": "Message exceeds 160 characters (will be split into multiple segments)"}), 400
    
    try:
        result = create_campaign(name, message, recipients)
        return jsonify(result), 201
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/campaigns/<campaign_id>/send", methods=["POST"])
def send_campaign_endpoint(campaign_id):
    """Send queued messages for a campaign."""
    data = request.get_json() or {}
    batch_size = data.get("batch_size", 100)
    
    if batch_size < 1 or batch_size > 1000:
        return jsonify({"error": "batch_size must be between 1 and 1000"}), 400
    
    try:
        result = send_campaign_batch(campaign_id, batch_size)
        return jsonify(result), 200
        
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded. Reduce batch_size or wait before retrying."}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/campaigns/<campaign_id>", methods=["GET"])
def get_campaign_endpoint(campaign_id):
    """Get campaign status and delivery statistics."""
    try:
        result = get_campaign_status(campaign_id)
        return jsonify(result), 200

    except ValueError as e:
        return jsonify({"error": "Resource not found"}), 404
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/webhooks/message-status", methods=["POST"])
def webhook_message_status():
    """Handle Telnyx webhook events for message delivery status."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No webhook data"}), 400
    
    # Telnyx sends events in a 'data' array
    events = data.get("data", [])
    
    conn = get_db()
    
    try:
        for event in events:
            event_type = event.get("type")
            message_id = event.get("payload", {}).get("id")
            status = event.get("payload", {}).get("to", [{}])[0].get("status")
            
            if message_id and status:
                # Record event
                conn.execute(
                    "INSERT INTO message_events (message_id, event_type, status) VALUES (?, ?, ?)",
                    (message_id, event_type, status)
                )
                
                # Update recipient status
                conn.execute(
                    "UPDATE campaign_recipients SET status = ? WHERE message_id = ?",
                    (status, message_id)
                )
        
        conn.commit()
        return jsonify({"status": "received"}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500
    finally:
        conn.close()


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


if __name__ == "__main__":
    init_db()
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
