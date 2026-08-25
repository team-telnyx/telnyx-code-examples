import os
import time
import json
import hashlib
import sqlite3
from datetime import datetime, timezone
from collections import defaultdict

import telnyx
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Configure Telnyx SDK
telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.public_key = os.getenv("TELNYX_PUBLIC_KEY")

# In-memory KV store for deduplication (TTL-based)
# Structure: {event_id: (timestamp, payload_hash)}
dedup_store = {}
DEDUP_TTL_SECONDS = int(os.getenv("DEDUP_TTL_SECONDS", "300"))

# SQLite database for event logging
DB_PATH = os.getenv("DB_PATH", "webhook_events.db")

# Action queues (in-memory fanout queues)
action_queues = defaultdict(list)
ACTION_TYPES = ["call", "sms"]


def init_db():
    """Initialize SQLite database for event logging."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS webhook_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE,
            event_type TEXT,
            payload TEXT,
            received_at TEXT,
            processed_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def log_event(event_id, event_type, payload):
    """Log event to SQL database."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO webhook_events (event_id, event_type, payload, received_at, processed_at) VALUES (?, ?, ?, ?, ?)",
            (event_id, event_type, json.dumps(payload), datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        conn.close()
        app.logger.info(f"Event {event_id} logged to database")
    except Exception as e:
        app.logger.exception(f"Failed to log event {event_id} to database")


def is_duplicate(event_id):
    """Check if event is a duplicate using TTL-based KV store."""
    current_time = time.time()
    
    # Clean up expired entries
    expired_keys = [k for k, (ts, _) in dedup.items() if current_time - ts > DEDUP_TTL_SECONDS]
    for key in expired_keys:
        del dedup[key]
    
    if event_id in dedup:
        app.logger.info(f"Duplicate event detected: {event_id}")
        return True
    
    # Store event with timestamp
    dedup[event_id] = (current_time, current_time)
    return False


def generate_event_id(payload):
    """Generate a unique event ID from payload."""
    payload_str = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(payload_str.encode()).hexdigest()


def enqueue_action(action_type, event_data):
    """Add action to the appropriate queue."""
    if action_type not in MAX_TYPES:
        app.logger.warning(f"Unknown action type: {action_type}")
        return False
    
    action_queues[action_type].append(event_data)
    app.logger.info(f"Event queued for {action_type} action")
    return True


def process_call_action(event_data):
    """Process a call action from the queue."""
    try:
        payload = event_data.get("payload", {})
        call_control_id = payload.get("call_control_id")
        if not call_control_id:
            app.logger.warning("No call_control_id in call event")
            return
        
        # Example: Answer the call
        telnyx.CallControl.Answer(call_control_id=call_control_id)
        app.logger.info(f"Answered call: {call_control_id}")
        
        # Example: Play a greeting
        telnyx.CallControl.PlayAudio(
            call_control_id=call_control_id,
            audio_url="https://example.com/greeting.mp3"
        )
        app.logger.info(f"Playing greeting for call: {call_control_id}")
        
    except Exception as e:
        app.logger.exception(f"Failed to process call action")


def process_sms_action(event_data):
    """Process SMS actions from the queue."""
    try:
        payload = event_data.get("payload", {})
        from_number = payload.get("from")
        to_number = payload.get("to")
        text = payload.get("text", "")
        
        if not from_number or not to_number:
            app.logger.warning("Missing from/to numbers in SMS event")
            return
        
        # Example: Send auto-reply
        telnyx.Message.create(
            from_=to_number,  # Reply to the sender
            to=from_number,
            text=f"Thanks for your message! We received: {text[:50]}..."
        )
        app.logger.info(f"Sent auto-reply to {from_number}")
        
    except Exception as e:
        app.logger.exception(f"Failed to process SMS action")


def process_queues():
    """Process all action queues."""
    for action_type in MAX_TYPES:
        while action_queues[action_type]:
            event_data = action_queues[action_type].pop(0)
            if action_type == "call":
                process_call_action(event_data)
            elif action_type == "sms":
                process_sms_action(event_data)


@app.route("/webhooks", methods=["POST"])
def webhook_handler():
    """Handle incoming Telnyx webhooks."""
    try:
        # Verify webhook signature
        event = telnyx.webhooks.unwrap(request.data, request.headers.get("X-Telnyx-Signature-Ed25519"), request.headers.get("X-Telnyx-Timestamp"))
        
        # Extract event data
        event_type = event.get("data", {}).get("event_type", "")
        payload = event.get("data", {}).get("payload", {})
        
        # Generate event ID for deduplication
        event_id = event.get("data", {}).get("id") or generate_event_id(payload)
        
        # Check for duplicates
        if is_duplicate(event_id):
            return jsonify({"status": "duplicate"}), 200
        
        # Log event to database
        init_db()
        log_event(event_id, event_type, payload)
        
        # Fanout to action queues based on event type
        if "call" in event_type.lower():
            enqueue_action("call", event)
        elif "message" in event_type.lower() or "sms" in event_type.lower():
            enqueue_action("sms", event)
        else:
            app.logger.info(f"Unhandled event type: {event_type}")
        
        # Process queues (in production, this would be a separate worker process)
        process_queues()
        
        return jsonify({"status": "success", "event_id": event_id}), 200
        
    except Exception as e:
        app.logger.exception("Webhook processing failed")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "queues": {action_type: len(action_queues[action_type]) for action_type in ACTION_QUEUES}
    }), 200


@app.route("/events", methods=["GET"])
def get_events():
    """Retrieve logged events from database."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM webhook_events ORDER BY id DESC LIMIT 100")
        rows = cursor.fetchall()
        conn.close()
        
        events = []
        for row in rows:
            events.append({
                "id": row[0],
                "event_id": row[1],
                "event_type": row[2],
                "payload": json.loads(row[3]),
                "received_at": row[4],
                "processed_at": row[5]
            })
        
        return jsonify({"events": events}), 200
        
    except Exception as e:
        app.logger.exception("Failed to fetch events")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/queues", methods=["GET"])
def get_queues():
    """Get current queue status."""
    return jsonify({
        "queues": {
            action_type: {
                "size": len(action_queues[action_type]),
                "items": action_queues[action_type][-10:]  # Last 10 items
            }
            for action_type in ACTION_QUEUES
        }
    }), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
