"""
Voice IVR with Agent Backend — Telnyx Code Sample

A natural language IVR system where the Telnyx Agent handles backend logic
and an LLM powers dynamic menu options. Instead of "press 1 or say 'billing'",
callers have a natural language conversation that routes to the right department.

Architecture:
    Inbound call → IVRAgent.onConnect() → LLM generates menu options from KV config
    → gather(speech) → LLM routes intent → transfer or handle

Primitives:
    - Call Control: inbound call + gather (speech) + speak
    - Agent SDK: class IVRAgent extends Agent with menu state
    - KV: menu config per phone number
    - Inference (binding): dynamic menu via LLM completion
"""

import json
import os
import uuid
from datetime import datetime, timezone
from functools import wraps

import telnyx
from flask import Flask, abort, jsonify, request

from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_CONNECTION_ID = os.getenv("TELNYX_CONNECTION_ID")
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "+18005551234")

telnyx.api_key = TELNYX_API_KEY

# ---------------------------------------------------------------------------
# In-memory KV store (menu config per phone number)
# ---------------------------------------------------------------------------
# In production, swap this for Redis, a database, or Telnyx KV.
# Key: dialed number (E.164) → menu config dict
MENU_CONFIG_KV: dict[str, dict] = {
    "+18005550000": {
        "business_name": "Acme Corp",
        "greeting": "Welcome to Acme Corp. How can I help you today?",
        "departments": [
            {
                "name": "billing",
                "description": "questions about invoices, payments, or account charges",
                "transfer_to": "+18005551000",
                "keywords": ["billing", "invoice", "payment", "charge", "bill", "account"],
            },
            {
                "name": "support",
                "description": "technical issues, troubleshooting, or product help",
                "transfer_to": "+18005552000",
                "keywords": ["support", "help", "technical", "issue", "broken", "error"],
            },
            {
                "name": "sales",
                "description": "new purchases, pricing, or product demos",
                "transfer_to": "+18005553000",
                "keywords": ["sales", "buy", "purchase", "pricing", "demo", "quote"],
            },
        ],
    },
}


def get_menu_config(dialed_number: str) -> dict | None:
    """Retrieve menu configuration for a dialed number from KV."""
    return MENU_CONFIG_KV.get(dialed_number)


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------
def verify_telnyx_webhook(f):
    """Verify the Telnyx Ed25519 webhook signature using the SDK."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not TELNYX_PUBLIC_KEY:
            app.logger.error("TELNYX_PUBLIC_KEY not configured")
            return jsonify({"error": "Webhook verification not configured"}), 503

        signature = request.headers.get("Telnyx-Signature-Ed25519")
        timestamp = request.headers.get("Telnyx-Signature-Timestamp")

        if not signature or not timestamp:
            app.logger.warning("Missing Telnyx signature headers")
            return jsonify({"error": "Missing signature"}), 401

        try:
            payload = request.get_data(as_text=True)
            telnyx.Webhook.construct_event(
                payload, signature, timestamp, TELNYX_PUBLIC_KEY
            )
        except Exception:
            app.logger.exception("Webhook signature verification failed")
            return jsonify({"error": "Invalid signature"}), 401

        return f(*args, **kwargs)

    return decorated


# ---------------------------------------------------------------------------
# LLM-powered intent routing
# ---------------------------------------------------------------------------
def generate_dynamic_menu_prompt(menu_config: dict) -> str:
    """Use LLM binding to generate a dynamic menu prompt from KV config."""
    departments = menu_config.get("departments", [])
    dept_list = "\n".join(
        f"- {d['name']}: {d['description']}" for d in departments
    )

    return (
        f"You are an IVR assistant for {menu_config.get('business_name', 'the company')}. "
        f"Available departments:\n{dept_list}\n\n"
        f"Greet the caller briefly and ask how you can help. "
        f"Keep it conversational and under 2 sentences."
    )


def route_intent_with_llm(user_input: str, menu_config: dict) -> dict | None:
    """
    Use LLM inference to route the caller's intent to a department.

    Returns the matched department dict or None if no match.
    """
    departments = menu_config.get("departments", [])
    dept_descriptions = "\n".join(
        f"- {d['name']}: {d['description']} (keywords: {', '.join(d['keywords'])})"
        for d in departments
    )

    system_prompt = (
        "You are an intent router for an IVR system. "
        "Given the caller's input, determine which department they need. "
        "Respond with ONLY the department name (lowercase) or 'unknown'.\n\n"
        f"Departments:\n{dept_descriptions}"
    )

    try:
        # Use Telnyx AI inference binding (OpenAI-compatible)
        completion = telnyx.ai.openai.chat.completions.create(
            model="telnyx-llm",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ],
            max_tokens=20,
            temperature=0.1,
        )
        intent = completion.choices[0].message.content.strip().lower()

        for dept in departments:
            if dept["name"] in intent:
                return dept
    except Exception:
        app.logger.exception("LLM intent routing failed, falling back to keyword match")

    # Fallback: keyword matching
    user_lower = user_input.lower()
    for dept in departments:
        if any(kw in user_lower for kw in dept["keywords"]):
            return dept

    return None


# ---------------------------------------------------------------------------
# Call Control helpers
# ---------------------------------------------------------------------------
def speak_to_caller(call_control_id: str, text: str) -> bool:
    """Use Call Control to speak text to the caller."""
    try:
        telnyx.Call.speak(
            call_control_id,
            payload=text,
            voice="female-en-US",
            language="en-US",
        )
        return True
    except Exception:
        app.logger.exception("Failed to speak to caller")
        return False


def gather_speech(call_control_id: str, prompt: str) -> None:
    """Use Call Control gather to collect speech input from the caller."""
    try:
        telnyx.Call.gather_using_speech(
            call_control_id,
            payload=prompt,
            voice="female-en-US",
            language="en-US",
            max_duration=15,
        )
    except Exception:
        app.logger.exception("Failed to gather speech")


def transfer_call(call_control_id: str, transfer_to: str) -> bool:
    """Transfer the call to the specified number."""
    try:
        telnyx.Call.transfer(
            call_control_id,
            to=transfer_to,
            from_=TELNYX_CONNECTION_ID,
        )
        return True
    except Exception:
        app.logger.exception("Failed to transfer call")
        return False


# ---------------------------------------------------------------------------
# IVR Agent state management
# ---------------------------------------------------------------------------
class IVRAgent:
    """
    IVR Agent that manages call state and orchestrates the conversation.

    In a production Agent SDK deployment, this would extend the Telnyx Agent
    base class. Here we implement the same pattern in Flask for portability.
    """

    def __init__(self, call_control_id: str, dialed_number: str):
        self.call_control_id = call_control_id
        self.dialed_number = dialed_number
        self.menu_config = get_menu_config(dialed_number)
        self.state = "greeting"
        self.turn_count = 0
        self.max_turns = 3

    def on_connect(self) -> dict:
        """Called when the call connects — generate dynamic menu via LLM."""
        if not self.menu_config:
            speak_to_caller(
                self.call_control_id,
                "This number is not configured. Please contact support.",
            )
            return {"status": "unconfigured"}

        # Generate dynamic greeting using LLM
        prompt = generate_dynamic_menu_prompt(self.menu_config)
        greeting = self._llm_generate(prompt)

        speak_to_caller(self.call_control_id, greeting)
        gather_speech(self.call_control_id, "How can I help you today?")

        self.state = "awaiting_input"
        return {"status": "connected", "greeting": greeting}

    def on_gather_ended(self, speech: str) -> dict:
        """Called when gather completes — route intent via LLM."""
        self.turn_count += 1

        if not speech:
            if self.turn_count >= self.max_turns:
                speak_to_caller(
                    self.call_control_id,
                    "I didn't catch that. Transferring you to an operator.",
                )
                transfer_call(self.call_control_id, DEFAULT_TRANSFER_NUMBER)
                return {"status": "transfer_default"}

            gather_speech(self.call_control_id, "I didn't catch that. Could you repeat?")
            return {"status": "retry"}

        # Route intent using LLM
        department = route_intent_with_llm(speech, self.menu_config)

        if department:
            speak_to_caller(
                self.call_control_id,
                f"Transferring you to {department['name']}. Please hold.",
            )
            transfer_call(self.call_control_id, department["transfer_to"])
            return {"status": "transfer", "department": department["name"]}

        # No match — retry or transfer to default
        if self.turn_count >= self.max_turns:
            speak_to_caller(
                self.call_control_id,
                "I'm having trouble understanding. Transferring you to an operator.",
            )
            transfer_call(self.call_control_id, DEFAULT_TRANSFER_NUMBER)
            return {"status": "transfer_default"}

        gather_speech(
            self.call_control_id,
            "I didn't quite understand. You can say 'billing', 'support', or 'sales'. "
            "How can I help?",
        )
        return {"status": "retry"}

    def _llm_generate(self, prompt: str) -> str:
        """Generate text using Telnyx AI inference binding."""
        try:
            completion = telnyx.ai.openai.chat.completions.create(
                model="telnyx-llm",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=100,
                temperature=0.7,
            )
            return completion.choices[0].message.content.strip()
        except Exception:
            app.logger.exception("LLM generation failed, using static greeting")
            return self.menu_config.get("greeting", "How can I help you?")


# Active IVR agents keyed by call_control_id
active_agents: dict[str, IVRAgent] = {}


# ---------------------------------------------------------------------------
# Webhook handler
# ---------------------------------------------------------------------------
@app.route("/webhooks/voice", methods=["POST"])
@verify_telnyx_webhook
def voice_webhook():
    """
    Telnyx Call Control webhook handler.

    Receives call control events and dispatches to the IVR Agent.
    """
    try:
        event = request.get_json(silent=True)
        if not event:
            return jsonify({"status": "ignored"}), 200

        event_type = event.get("data", {}).get("event_type")
        payload = event.get("data", {}).get("payload", {})

        call_control_id = payload.get("call_control_id")
        if not call_control_id:
            app.logger.warning("Webhook missing call_control_id")
            return jsonify({"status": "ignored"}), 200

        app.logger.info("Received event: %s for call: %s", event_type, call_control_id)

        # ── Call initiated (inbound) ──────────────────────────────────────
        if event_type == "call.initiated":
            dialed_number = payload.get("to")
            agent = IVRAgent(call_control_id, dialed_number)
            active_agents[call_control_id] = agent

            # Answer the call
            try:
                telnyx.Call.answer(call_control_id)
            except Exception:
                app.logger.exception("Failed to answer call")
                return jsonify({"error": "Failed to answer"}), 500

            return jsonify({"status": "answered"}), 200

        # ── Call answered ─────────────────────────────────────────────────
        if event_type == "call.answered":
            agent = active_agents.get(call_control_id)
            if agent:
                agent.on_connect()
            return jsonify({"status": "ivr_started"}), 200

        # ── Gather ended (speech collected) ──────────────────────────────
        if event_type == "call.gather.ended":
            agent = active_agents.get(call_control_id)
            if agent:
                speech = payload.get("speech", {}).get("text", "")
                agent.on_gather_ended(speech)
            return jsonify({"status": "intent_routed"}), 200

        # ── Gather failed ─────────────────────────────────────────────────
        if event_type == "call.gather.failed":
            agent = active_agents.get(call_control_id)
            if agent:
                agent.on_gather_ended("")
            return jsonify({"status": "gather_failed_handled"}), 200

        # ── Call ended — cleanup ──────────────────────────────────────────
        if event_type == "call.hangup":
            active_agents.pop(call_control_id, None)
            app.logger.info("Call ended, agent cleaned up: %s", call_control_id)
            return jsonify({"status": "cleaned_up"}), 200

        # ── Unhandled event ───────────────────────────────────────────────
        app.logger.debug("Unhandled event type: %s", event_type)
        return jsonify({"status": "unhandled", "event": event_type}), 200

    except Exception:
        app.logger.exception("Unexpected error in voice webhook")
        return jsonify({"error": "Internal server error"}), 500


# ---------------------------------------------------------------------------
# Management API
# ---------------------------------------------------------------------------
@app.route("/api/menu-config/<phone_number>", methods=["GET"])
def get_menu_config_api(phone_number: str):
    """Retrieve the IVR menu configuration for a phone number."""
    config = get_menu_config(phone_number)
    if not config:
        return jsonify({"error": "No configuration found for this number"}), 404
    return jsonify({"phone_number": phone_number, "config": config}), 200


@app.route("/api/menu-config/<phone_number>", methods=["PUT"])
def update_menu_config_api(phone_number: str):
    """Update the IVR menu configuration for a phone number (KV)."""
    try:
        body = request.get_json(silent=True)
        if not body or "config" not in body:
            return jsonify({"error": "Missing 'config' in request body"}), 400

        config = body["config"]
        required_fields = ["business_name", "greeting", "departments"]
        for field in required_fields:
            if field not in config:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        MENU_CONFIG_KV[phone_number] = config
        app.logger.info("Updated menu config")
        return jsonify({"status": "updated", "phone_number": phone_number}), 200
    except Exception:
        app.logger.exception("Failed to update menu config")
        return jsonify({"error": "Failed to update configuration"}), 500


@app.route("/api/agents", methods=["GET"])
def list_active_agents():
    """List currently active IVR agents (for debugging)."""
    agents = [
        {
            "call_control_id": ccid,
            "dialed_number": agent.dialed_number,
            "state": agent.state,
            "turn_count": agent.turn_count,
        }
        for ccid, agent in active_agents.items()
    ]
    return jsonify({"active_agents": agents, "count": len(agents)}), 200


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify(
        {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "voice-ivr-with-agent-backend",
        }
    ), 200


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.logger.info("Starting Voice IVR Agent Backend on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=debug)
