#!/usr/bin/env python3
"""Production-ready Flask SMS survey application using Telnyx."""

import os
import json
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")

# Survey configuration
SURVEY_QUESTIONS = [
    {
        "id": 1,
        "text": "How satisfied are you with our service? Reply: 1=Very Unsatisfied, 2=Unsatisfied, 3=Neutral, 4=Satisfied, 5=Very Satisfied",
        "valid_responses": ["1", "2", "3", "4", "5"],
    },
    {
        "id": 2,
        "text": "Would you recommend us to a friend? Reply: Y=Yes, N=No",
        "valid_responses": ["Y", "N", "y", "n"],
    },
    {
        "id": 3,
        "text": "How likely are you to use our service again? Reply: 1=Very Unlikely, 2=Unlikely, 3=Neutral, 4=Likely, 5=Very Likely",
        "valid_responses": ["1", "2", "3", "4", "5"],
    },
]

# In-memory storage for survey responses (use a database in production)
survey_responses = {}


def start_survey(to_number: str) -> dict:
    """Initiate a survey by sending the first question to a participant."""
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    # Initialize survey state for this participant
    survey_responses[to_number] = {
        "current_question": 0,
        "responses": [],
        "status": "in_progress",
    }
    
    # Send the first question
    first_question = SURVEY_QUESTIONS[0]
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        text=first_question["text"],
    )
    
    return {
        "participant": to_number,
        "message_id": response.data.id,
        "question_number": 1,
        "total_questions": len(SURVEY_QUESTIONS),
        "status": "survey_started",
    }


def process_survey_response(from_number: str, message_text: str) -> dict:
    """Process inbound survey response and advance to next question or complete survey."""
    if from_number not in survey_responses:
        return {
            "status": "error",
            "message": "No active survey found for this number. Reply START to begin.",
        }
    
    participant_state = survey_responses[from_number]
    
    if participant_state["status"] != "in_progress":
        return {
            "status": "error",
            "message": "Survey already completed for this participant.",
        }
    
    current_q_index = participant_state["current_question"]
    current_question = SURVEY_QUESTIONS[current_q_index]
    
    # Validate response against allowed options
    if message_text.strip() not in current_question["valid_responses"]:
        response = client.messages.create(
            from_=TELNYX_PHONE_NUMBER,
            to=from_number,
            text=f"Invalid response. {current_question['text']}",
        )
        return {
            "status": "invalid_response",
            "message_id": response.data.id,
            "message": "Response rejected. Resending question.",
        }
    
    # Record valid response
    participant_state["responses"].append({
        "question_id": current_question["id"],
        "question_text": current_question["text"],
        "response": message_text.strip(),
    })
    
    # Check if survey is complete
    if current_q_index + 1 >= len(SURVEY_QUESTIONS):
        participant_state["status"] = "completed"
        completion_message = (
            f"Thank you for completing the survey! Your responses have been recorded. "
            f"Total questions answered: {len(participant_state['responses'])}"
        )
        response = client.messages.create(
            from_=TELNYX_PHONE_NUMBER,
            to=from_number,
            text=completion_message,
        )
        return {
            "status": "survey_completed",
            "message_id": response.data.id,
            "participant": from_number,
            "responses_count": len(participant_state["responses"]),
        }
    
    # Send next question
    next_q_index = current_q_index + 1
    next_question = SURVEY_QUESTIONS[next_q_index]
    participant_state["current_question"] = next_q_index
    
    response = client.messages.create(
        from_=TELNYX_PHONE_NUMBER,
        to=from_number,
        text=next_question["text"],
    )
    
    return {
        "status": "question_sent",
        "message_id": response.data.id,
        "question_number": next_q_index + 1,
        "total_questions": len(SURVEY_QUESTIONS),
    }


@app.route("/survey/start", methods=["POST"])
def start_survey_endpoint():
    """HTTP endpoint to initiate a survey for a participant."""
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "Request body required"}), 400
    
    to_number = data.get("to")
    
    if not to_number:
        return jsonify({"error": "Missing required field: 'to'"}), 400
    
    try:
        result = start_survey(to_number)
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


@app.route("/webhook/sms", methods=["POST"])
def webhook_sms():
    """Webhook endpoint to receive inbound SMS messages from Telnyx."""
    payload = request.get_json()
    
    if not payload:
        return jsonify({"error": "No payload"}), 400
    
    # Extract event data from Telnyx webhook
    event_type = payload.get("data", {}).get("event_type")
    
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200
    
    message_data = payload.get("data", {})
    from_number = message_data.get("from", {}).get("phone_number")
    message_text = message_data.get("text", "").strip()
    
    if not from_number or not message_text:
        return jsonify({"error": "Missing from or text"}), 400
    
    try:
        # Handle special commands
        if message_text.upper() == "START":
            result = start_survey(from_number)
            return jsonify(result), 200
        
        # Process survey response
        result = process_survey_response(from_number, message_text)
        return jsonify(result), 200
        
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.RateLimitError:
        return jsonify({"error": "Rate limit exceeded"}), 429
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/survey/results", methods=["GET"])
def get_survey_results():
    """HTTP endpoint to retrieve survey results for all participants."""
    results = []
    
    for participant, state in survey_responses.items():
        results.append({
            "participant": participant,
            "status": state["status"],
            "responses_count": len(state["responses"]),
            "responses": state["responses"],
        })
    
    return jsonify({
        "total_participants": len(results),
        "results": results,
    }), 200


@app.route("/survey/participant/<participant>", methods=["GET"])
def get_participant_results(participant):
    """HTTP endpoint to retrieve survey results for a specific participant."""
    if participant not in survey_responses:
        return jsonify({"error": "Participant not found"}), 404
    
    state = survey_responses[participant]
    
    return jsonify({
        "participant": participant,
        "status": state["status"],
        "responses_count": len(state["responses"]),
        "responses": state["responses"],
    }), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
