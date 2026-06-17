#!/usr/bin/env python3
"""Production-ready Flask endpoint for chatting with Telnyx AI Assistants."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


def chat_with_assistant(assistant_id: str, user_message: str) -> dict:
    """Send a message to an AI Assistant and return the response."""
    if not assistant_id:
        raise ValueError("Assistant ID is required")
    
    if not user_message or not user_message.strip():
        raise ValueError("Message cannot be empty")
    
    # Use client.ai_assistants.chat() to send a message to the assistant
    response = client.ai_assistants.chat(
        assistant_id=assistant_id,
        messages=[
            {
                "role": "user",
                "content": user_message,
            }
        ],
    )
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    # The response contains the assistant's reply in the messages array
    assistant_message = None
    if response.data.messages:
        for msg in response.data.messages:
            if msg.role == "assistant":
                assistant_message = msg.content
                break
    
    return {
        "user_message": user_message,
        "assistant_response": assistant_message or "No response generated",
        "assistant_id": assistant_id,
    }


@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """HTTP endpoint to chat with an AI Assistant."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    user_message = data.get("message")
    assistant_id = data.get("assistant_id") or os.getenv("AI_ASSISTANT_ID")
    
    if not user_message:
        return jsonify({"error": "Missing required field: 'message'"}), 400
    
    if not assistant_id:
        return jsonify({"error": "Missing required field: 'assistant_id' or AI_ASSISTANT_ID env var"}), 400
    
    try:
        result = chat_with_assistant(assistant_id, user_message)
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


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
