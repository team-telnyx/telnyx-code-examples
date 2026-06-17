#!/usr/bin/env python3
"""Production-ready IVR system using Telnyx Voice API and Flask."""

import os
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

# In-memory store for call state (use Redis or database in production)
call_state = {}

# IVR menu configuration
MENU_CONFIG = {
    "main": {
        "prompt": "Thank you for calling. Press 1 for sales, 2 for support, or 3 to hear this menu again.",
        "options": {
            "1": "sales",
            "2": "support",
            "3": "main",
        }
    },
    "sales": {
        "prompt": "You have selected sales. Press 1 to speak with a representative, or 2 to return to the main menu.",
        "options": {
            "1": "transfer_sales",
            "2": "main",
        }
    },
    "support": {
        "prompt": "You have selected support. Press 1 for technical support, 2 for billing, or 3 to return to the main menu.",
        "options": {
            "1": "tech_support",
            "2": "billing",
            "3": "main",
        }
    },
    "transfer_sales": {
        "prompt": "Transferring you to a sales representative. Please hold.",
        "options": {}
    },
    "tech_support": {
        "prompt": "Transferring you to technical support. Please hold.",
        "options": {}
    },
    "billing": {
        "prompt": "Transferring you to billing. Please hold.",
        "options": {}
    },
}


def play_prompt(call_control_id: str, prompt_text: str) -> None:
    """Play a text-to-speech prompt to the caller."""
    try:
        client.calls.actions.speak(
            call_control_id=call_control_id,
            payload=prompt_text,
            language="en-US",
            voice="female",
        )
    except telnyx.APIStatusError as e:
        print(f"Error playing prompt: {e}")


def gather_dtmf(call_control_id: str, max_digits: int = 1) -> None:
    """Gather DTMF input from the caller."""
    try:
        client.calls.actions.gather_using_speak(
            call_control_id=call_control_id,
            payload="",
            max_digits=max_digits,
            timeout_millis=5000,
            language="en-US",
            voice="female",
        )
    except telnyx.APIStatusError as e:
        print(f"Error gathering DTMF: {e}")


def transfer_call(call_control_id: str, to_number: str) -> None:
    """Transfer the call to a destination number."""
    try:
        client.calls.actions.transfer(
            call_control_id=call_control_id,
            to=to_number,
        )
    except telnyx.APIStatusError as e:
        print(f"Error transferring call: {e}")


def hangup_call(call_control_id: str) -> None:
    """Hang up the call."""
    try:
        client.calls.actions.hangup(call_control_id=call_control_id)
    except telnyx.APIStatusError as e:
        print(f"Error hanging up call: {e}")


def initialize_call_state(call_control_id: str, from_number: str) -> None:
    """Initialize state for a new inbound call."""
    call_state[call_control_id] = {
        "from": from_number,
        "current_menu": "main",
        "dtmf_input": "",
    }


@app.route("/webhooks/call", methods=["POST"])
def handle_call_webhook():
    """Handle inbound call events from Telnyx."""
    try:
        payload = request.get_json()
        
        if not payload:
            return jsonify({"error": "Empty payload"}), 400
        
        # Extract event data
        event_type = payload.get("data", {}).get("event_type")
        call_control_id = payload.get("data", {}).get("call_control_id")
        from_number = payload.get("data", {}).get("from", {}).get("phone_number")
        
        if not event_type or not call_control_id:
            return jsonify({"error": "Missing required fields"}), 400
        
        # Handle call.initiated — inbound call received
        if event_type == "call.initiated":
            initialize_call_state(call_control_id, from_number)
            # Answer the call
            client.calls.actions.answer(call_control_id=call_control_id)
            # Play the main menu prompt
            menu_prompt = MENU_CONFIG["main"]["prompt"]
            play_prompt(call_control_id, menu_prompt)
            # Gather DTMF input
            gather_dtmf(call_control_id)
            return jsonify({"status": "call answered"}), 200
        
        # Handle call.dtmf.received — caller pressed a digit
        elif event_type == "call.dtmf.received":
            digit = payload.get("data", {}).get("dtmf_digit")
            
            if call_control_id not in call_state:
                return jsonify({"error": "Call state not found"}), 404
            
            current_menu = call_state[call_control_id]["current_menu"]
            menu_options = MENU_CONFIG[current_menu]["options"]
            
            # Route based on DTMF input
            if digit in menu_options:
                next_menu = menu_options[digit]
                call_state[call_control_id]["current_menu"] = next_menu
                
                # Handle transfer destinations
                if next_menu == "transfer_sales":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876543")
                elif next_menu == "tech_support":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876544")
                elif next_menu == "billing":
                    play_prompt(call_control_id, MENU_CONFIG[next_menu]["prompt"])
                    transfer_call(call_control_id, "+15559876545")
                else:
                    # Play next menu prompt
                    menu_prompt = MENU_CONFIG[next_menu]["prompt"]
                    play_prompt(call_control_id, menu_prompt)
                    gather_dtmf(call_control_id)
            else:
                # Invalid input — replay current menu
                menu_prompt = MENU_CONFIG[current_menu]["prompt"]
                play_prompt(call_control_id, menu_prompt)
                gather_dtmf(call_control_id)
            
            return jsonify({"status": "dtmf processed"}), 200
        
        # Handle call.hangup — call ended
        elif event_type == "call.hangup":
            if call_control_id in call_state:
                del call_state[call_control_id]
            return jsonify({"status": "call ended"}), 200
        
        # Handle call.speak.ended — TTS playback finished
        elif event_type == "call.speak.ended":
            return jsonify({"status": "speak ended"}), 200
        
        else:
            return jsonify({"status": f"event {event_type} received"}), 200
    
    except telnyx.AuthenticationError:
        return jsonify({"error": "Invalid API key"}), 401
    except telnyx.APIStatusError as e:
        return jsonify({"error": "API request failed", "status_code": e.status_code}), e.status_code
    except telnyx.APIConnectionError:
        return jsonify({"error": "Network error connecting to Telnyx"}), 503
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route("/webhooks/call/status", methods=["GET"])
def get_call_status():
    """Retrieve the current state of all active calls."""
    try:
        return jsonify({"active_calls": call_state}), 200
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=5000)
