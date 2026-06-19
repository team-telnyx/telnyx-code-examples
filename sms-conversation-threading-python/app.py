#!/usr/bin/env python3
"""Production-ready Flask application for SMS conversation threading."""

import os
import uuid
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, jsonify, request
import telnyx
from sqlalchemy import create_engine, Column, String, Text, DateTime, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

load_dotenv()

# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///conversations.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)
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


Base.metadata.create_all(bind=engine)

# Flask app setup
app = Flask(__name__)
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
    
    conversation_id = get_or_create_conversation(to_number)
    
    response = client.messages.create(
        from_=from_number,
        to=to_number,
        text=body,
    )
    
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
    
    if payload.get("type") != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    from_number = event_data.get("from", {}).get("phone_number")
    to_number = event_data.get("to", [{}])[0].get("phone_number")
    message_body = event_data.get("text", "")
    message_id = event_data.get("id")
    
    if not from_number or not to_number:
        return jsonify({"error": "Missing phone numbers in webhook"}), 400
    
    try:
        conversation_id = get_or_create_conversation(from_number)
        
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
