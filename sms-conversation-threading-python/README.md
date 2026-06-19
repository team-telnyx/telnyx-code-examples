# Conversation Threading with Python and Flask

## What Does This Example Do?

Build a conversation threading system that groups related SMS messages by contact and maintains message history. This tutorial demonstrates how to store and retrieve conversation threads, implement proper database schema design for SMS workflows, and expose REST endpoints to manage multi-turn conversations with the Telnyx Python SDK.

By the end, you'll have a Flask application that sends messages, receives inbound SMS via webhooks, and organizes all messages into queryable conversation threads.

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
- A Telnyx phone number enabled for inbound and outbound SMS.
- SQLite3 (included with Python) or PostgreSQL for production.
- pip (Python package manager).
- A publicly accessible URL for webhook testing (ngrok or similar).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-conversation-threading-python
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-conversation-threading-python
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `models.py` to define the database schema for conversation threading:

```python
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Text, DateTime, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///conversations.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Conversation(Base):
    """Represents a conversation thread between a contact and the application."""
    __tablename__ = "conversations"
    
    id = Column(String, primary_key=True, index=True)
    contact_number = Column(String, unique=True, index=True, nullable=False)
    last_message_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    message_count = Column(Integer, default=0)


class Message(Base):
    """Represents a single SMS message within a conversation."""
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, index=True)
    conversation_id = Column(String, index=True, nullable=False)
    direction = Column(String, nullable=False)  # "inbound" or "outbound"
    from_number = Column(String, nullable=False)
    to_number = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String, default="pending")  # pending, sent, delivered, failed
    created_at = Column(DateTime, default=datetime.utcnow)
    telnyx_message_id = Column(String, unique=True, index=True)


# Create tables on module import
Base.metadata.create_all(bind=engine)
```

Create `app.py` with Flask routes and conversation logic:

```python
import os
import uuid
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request
import telnyx
from models import SessionLocal, Conversation, Message

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def get_or_create_conversation(contact_number: str) -> str:
    """Get existing conversation or create new one for contact."""
    db = SessionLocal()
    try:
        conversation = db.query(Conversation).filter(
            Conversation.contact_number == contact_number
        ).first()
        
        if conversation:
            return conversation.id
        
        # Create new conversation
        conversation_id = str(uuid.uuid4())
        new_conversation = Conversation(
            id=conversation_id,
            contact_number=contact_number,
        )
        db.add(new_conversation)
        db.commit()
        return conversation_id
    finally:
        db.close()


def store_message(
    conversation_id: str,
    direction: str,
    from_number: str,
    to_number: str,
    body: str,
    status: str = "pending",
    telnyx_message_id: str = None,
) -> dict:
    """Store message in database and return serializable dict."""
    db = SessionLocal()
    try:
        message_id = str(uuid.uuid4())
        message = Message(
            id=message_id,
            conversation_id=conversation_id,
            direction=direction,
            from_number=from_number,
            to_number=to_number,
            body=body,
            status=status,
            telnyx_message_id=telnyx_message_id,
        )
        db.add(message)
        
        # Update conversation metadata
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()
        if conversation:
            conversation.message_count += 1
            conversation.last_message_at = datetime.utcnow()
        
        db.commit()
        
        return {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "direction": message.direction,
            "from": message.from_number,
            "to": message.to_number,
            "body": message.body,
            "status": message.status,
            "created_at": message.created_at.isoformat(),
        }
    finally:
        db.close()


def send_message_to_contact(to_number: str, body: str) -> dict:
    """Send outbound message and store in conversation thread."""
    from_number = os.getenv("TELNYX_PHONE_NUMBER")
    if not from_number:
        raise ValueError("TELNYX_PHONE_NUMBER environment variable not set")
    
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Get or create conversation
    conversation_id = get_or_create_conversation(to_number)
    
    # Send via Telnyx API
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=body,
    )
    
    # Store in database
    message_data = store_message(
        conversation_id=conversation_id,
        direction="outbound",
        from_number=from_number,
        to_number=to_number,
        body=body,
        status=response.data.to[0].status if response.data.to else "queued",
        telnyx_message_id=response.data.id,
    )
    
    return message_data


@app.route("/conversations", methods=["GET"])
def list_conversations():
    """List all conversation threads."""
    db = SessionLocal()
    try:
        conversations = db.query(Conversation).order_by(
            Conversation.last_message_at.desc()
        ).all()
        
        return jsonify([
            {
                "id": c.id,
                "contact_number": c.contact_number,
                "message_count": c.message_count,
                "last_message_at": c.last_message_at.isoformat(),
                "created_at": c.created_at.isoformat(),
            }
            for c in conversations
        ]), 200
    finally:
        db.close()


@app.route("/conversations/<conversation_id>", methods=["GET"])
def get_conversation(conversation_id: str):
    """Retrieve a specific conversation thread with all messages."""
    db = SessionLocal()
    try:
        conversation = db.query(Conversation).filter(
            Conversation.id == conversation_id
        ).first()
        
        if not conversation:
            return jsonify({"error": "Conversation not found"}), 404
        
        messages = db.query(Message).filter(
            Message.conversation_id == conversation_id
        ).order_by(Message.created_at.asc()).all()
        
        return jsonify({
            "id": conversation.id,
            "contact_number": conversation.contact_number,
            "message_count": conversation.message_count,
            "created_at": conversation.created_at.isoformat(),
            "last_message_at": conversation.last_message_at.isoformat(),
            "messages": [
                {
                    "id": m.id,
                    "direction": m.direction,
                    "from": m.from_number,
                    "to": m.to_number,
                    "body": m.body,
                    "status": m.status,
                    "created_at": m.created_at.isoformat(),
                }
                for m in messages
            ],
        }), 200
    finally:
        db.close()


@app.route("/conversations/<contact_number>/send", methods=["POST"])
def send_to_contact(contact_number: str):
    """Send a message to a contact and add to conversation thread."""
    data = request.get_json()
    
    if not data or "message" not in data:
        return jsonify({"error": "Missing required field: 'message'"}), 400
    
    message_body = data.get("message")
    
    try:
        result = send_message_to_contact(contact_number, message_body)
        return jsonify(result), 201
        
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


@app.route("/webhooks/sms", methods=["POST"])
def handle_inbound_sms():
    """Webhook endpoint to receive inbound SMS and add to conversation thread."""
    payload = request.get_json()
    
    if not payload or "data" not in payload:
        return jsonify({"error": "Invalid webhook payload"}), 400
    
    event_data = payload.get("data", {})
    
    # Only process message.received events
    if payload.get("type") != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    from_number = event_data.get("from", {}).get("phone_number")
    to_number = event_data.get("to", [{}])[0].get("phone_number")
    message_body = event_data.get("text", "")
    message_id = event_data.get("id")
    
    if not from_number or not to_number:
        return jsonify({"error": "Missing phone numbers in webhook"}), 400
    
    try:
        # Get or create conversation for this contact
        conversation_id = get_or_create_conversation(from_number)
        
        # Store inbound message
        store_message(
            conversation_id=conversation_id,
            direction="inbound",
            from_number=from_number,
            to_number=to_number,
            body=message_body,
            status="received",
            telnyx_message_id=message_id,
        )
        
        return jsonify({"status": "stored"}), 200
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
```

## Complete Code

See [`app.py`](./app.py) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Database locked error (SQLite) | You receive `sqlite3.OperationalError: database is locked` when running concurrent requests. | SQLite is not suitable for production multi-threaded applications. For development, disable Flask's threaded mode by setting `threaded=False` in `app.run()`. For production, migrate to PostgreSQL by updating `DATABASE_URL` to `postgresql://user:password@localhost/conversations` and installing `psycopg2-binary`. |
| Webhook not receiving inbound messages | Inbound SMS are not being stored in the conversation thread; the webhook endpoint is not being called. | Verify your Telnyx Messaging Profile is configured with the correct webhook URL. Use ngrok to expose your local Flask server and update the webhook URL in the Telnyx Portal to match your ngrok HTTPS URL (e.g., `https://abc123.ngrok.io/webhooks/sms`). Test the webhook manually using curl with a sample payload to confirm the endpoint is reachable. |
| Conversation not found (404) | Retrieving a conversation returns `{"error": "Conversation not found"}` even though you sent a message. | Verify the conversation ID is correct by first calling `GET /conversations` to list all conversations and copy the exact ID. Ensure the contact number used when sending the message matches the format stored in the database (E.164 format with `+` prefix). Check the database directly using `sqlite3 conversations.db` and query the `conversations` table. |
| Rate limit errors on bulk sends | Sending multiple messages rapidly returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff retry logic in your client code. Add a delay between requests (e.g., 100ms) or use a task queue like Celery to distribute sends over time. Telnyx allows approximately 100 requests per second; adjust your sending rate accordingly. |

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
- [Send Bulk SMS Messages](/tutorials/sms/python/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/python/otp-2fa).
