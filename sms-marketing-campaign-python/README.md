# SMS Marketing with Python and Flask

## What Does This Example Do?

Build a production-ready SMS marketing platform using Flask and the Telnyx Python SDK. This tutorial covers sending targeted campaigns to contact lists, managing delivery status, rate limiting for bulk sends, and webhook integration for real-time delivery tracking. You'll learn how to structure a scalable marketing application that handles hundreds of messages while respecting API rate limits and maintaining compliance with telecom regulations.

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
- A Telnyx phone number or alphanumeric sender ID enabled for outbound SMS.
- pip (Python package manager).
- A publicly accessible URL for webhook testing (ngrok or similar for local development).
- Basic understanding of REST APIs and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-marketing-campaign-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-marketing-campaign-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.py` with the complete marketing platform:

```python
import os
import json
import time
import sqlite3
import uuid
from datetime import datetime
from functools import wraps
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
    with open("schema.sql") as f:
        conn.executescript(f.read())
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
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/campaigns/<campaign_id>", methods=["GET"])
def get_campaign_endpoint(campaign_id):
    """Get campaign status and delivery statistics."""
    try:
        result = get_campaign_status(campaign_id)
        return jsonify(result), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
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
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded..."}` with HTTP 429 after sending a few messages. | The Telnyx API enforces rate limits on message throughput. Increase the `RATE_LIMIT_DELAY` value in `app.py` (currently 0.1 seconds) to space out requests further. For example, change it to `0.2` for 200ms delays. Alternatively, reduce the `batch_size` parameter when calling the `/send` endpoint. Monitor your account's rate limit tier in the [Telnyx Portal](https://portal.telnyx.com). |
| Invalid Phone Number Format | Recipients are marked as failed with error "Invalid phone number format". | Ensure all phone numbers in the `recipients` list use E.164 format: start with `+`, followed by country code and number without spaces, dashes, or parentheses. Example: `+15551234567` (US) or `+447700900123` (UK). The validation function `validate_phone_number()` will skip invalid numbers silently; check your input data before creating the campaign. |
| Webhook Not Receiving Events | Campaign status shows "sent" but delivery status never updates to "delivered" or "failed". | Verify that your `WEBHOOK_URL` in `.env` is publicly accessible and points to your `/webhooks/message-status` endpoint. Use ngrok (`ngrok http 5000`) for local testing and update `WEBHOOK_URL` to the ngrok URL. Configure the webhook URL in your [Telnyx Messaging Profile](https://portal.telnyx.com) under Settings > Webhooks. Test the webhook manually by sending a POST request with sample Telnyx event data to ensure your endpoint is reachable. |
| Database Lock Error | Application crashes with "database is locked" when sending large campaigns. | SQLite has limited concurrency. For production use with high message volumes, migrate to PostgreSQL or MySQL. For testing, reduce the `batch_size` parameter and increase delays between batch sends. Ensure only one Flask process is running (set `threaded=False` in `app.run()` if needed). |
| Campaign Not Found (404) | Requesting campaign status returns `{"error": "Campaign ... not found"}`. | Verify the `campaign_id` in the URL matches the ID returned when you created the campaign. Check that the database file `marketing.db` exists in your project directory and contains the campaign record. If the database was deleted or reset, recreate the campaign. |

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

- [Receive SMS Webhooks with Python](/tutorials/sms/python/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
- [Build Two-Way SMS Conversations](/tutorials/sms/python/two-way-sms).
