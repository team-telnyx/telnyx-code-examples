# Delivery Receipts with Python and Flask

## What Does This Example Do?

Build a production-ready Flask application that tracks SMS delivery status using Telnyx webhooks. This tutorial demonstrates how to receive and process `message.finalized` webhook events, store delivery receipts in a database, and query message status via HTTP endpoints. You'll learn to handle asynchronous delivery notifications, validate webhook signatures, and implement idempotent processing for production resilience.

## Who Is This For?

- **Python developers** building sms features with Flask.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Python 3.8 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- A publicly accessible URL (ngrok, Heroku, or similar) to receive webhooks.
- pip (Python package manager).
- SQLite3 (included with Python).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with database initialization, message sending, and webhook handling:

```python
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
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | POST requests to `/webhooks/message` are not arriving from Telnyx. | Verify the webhook URL is publicly accessible and matches the URL configured in your Telnyx Messaging Profile. Use ngrok (`ngrok http 5000`) to expose your local Flask server and update the webhook URL in the Telnyx Portal. Check Flask logs for incoming requests. Ensure your firewall allows inbound traffic on port 5000 (or your configured port). |
| Database locked error | SQLite returns "database is locked" when multiple requests try to write simultaneously. | SQLite has limited concurrent write support. For production, migrate to PostgreSQL or MySQL. For development, add a small retry delay in the webhook handler: `import time; time.sleep(0.1)` before database operations. Ensure all database connections are properly closed with `conn.close()`. |
| Message status stuck on "queued" | Messages never transition to "delivered" or "failed" status. | Confirm your Telnyx Messaging Profile has the webhook URL configured for `message.finalized` events. Check the Telnyx Portal logs to verify events are being generated. Ensure the Flask server is running and accessible at the webhook URL. Test with `curl -X POST http://localhost:5000/webhooks/message -H "Content-Type: application/json" -d '{"data": {"event_type": "message.finalized", "payload": {"id": "test-id", "to": [{"status": "delivered"}]}}}'` to simulate a webhook. |
| Duplicate receipt processing | The same delivery receipt is processed multiple times, creating duplicate database entries. | The code includes idempotency checks using `UNIQUE` constraint on `message_id` in the `delivery_receipts` table. If duplicates still occur, verify the webhook handler returns HTTP 200 to acknowledge receipt. Telnyx will retry failed webhooks (non-2xx responses), so ensure the handler always returns 200 even if processing fails. |
| Authentication error on message send | POST to `/sms/send` returns `{"error": "Invalid API key"}` with HTTP 401. | Verify `TELNYX_API_KEY` in `.env` matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Flask server after updating `.env`. Check that `load_dotenv()` is called before `os.getenv()`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Python version do I need?**

Python 3.8 or higher. Python 3.12+ is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Python SDK](https://developers.telnyx.com/development/sdk/python)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
