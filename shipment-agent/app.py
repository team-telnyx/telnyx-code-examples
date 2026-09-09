import os
import json
import time
import threading
from datetime import datetime, timedelta, timezone

import telnyx
from flask import Flask, request, jsonify, abort
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.public_key = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_MESSAGING_PROFILE_ID = os.getenv("TELNYX_MESSAGING_PROFILE_ID")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER")
TELNYX_TO_NUMBER = os.getenv("TELNYX_TO_NUMBER")  # Customer phone for demo

# In-memory store for the ShipmentAgent entities (Demo persistence)
# In production, this would be a durable database (e.g., Postgres/Redis)
SHIPMENT_AGENTS = {}

class ShipmentAgent:
    """
    The Actor IS the Package.
    A durable entity that lives across days, carriers, and status changes.
    """
    def __init__(self, shipment_id, customer_number, carrier="FedEx"):
        self.shipment_id = shipment_id
        self.customer_number = customer_number
        self.carrier = carrier
        self.status = "CREATED"
        self.eta = None
        self.history = []
        self.scheduled_wakes = []
        
        # Bind Telnyx communication channels
        self.sms_channel = TELNYX_FROM_NUMBER
        self.voice_channel = TELNYX_FROM_NUMBER

    def wake(self, event_name, event_data=None):
        """The agent wakes, processes the event, and acts autonomously."""
        app.logger.info(f"Agent {self.shipment_id} waking for event: {event_name}")
        self.history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event_name,
            "data": event_data or {}
        })

        if event_name == "PICKED_UP":
            self.status = "IN_TRANSIT"
            self.eta = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
            self._proactive_sms(f"Your order {self.shipment_id} is on the way! ETA: {self.eta}")
        
        elif event_name == "IN_TRANSIT":
            # Day 2: Agent silent (no change worth reporting)
            pass
            
        elif event_name == "DELAY_DETECTED":
            self.status = "DELAYED"
            self.eta = event_data.get("new_eta", "Unknown")
            self._proactive_sms(f"Update on {self.shipment_id}: Delayed. New ETA: {self.eta}")
            
        elif event_name == "OUT_FOR_DELIVERY":
            self.status = "OUT_FOR_DELIVERY"
            delivery_window = "Tomorrow 10AM - 2PM"
            self._proactive_sms(f"Your package {self.shipment_id} is out for delivery. Scheduled window: {delivery_window}")
            
        elif event_name == "DELIVERED":
            self.status = "DELIVERED"
            self._proactive_sms(f"Your package {self.shipment_id} was delivered! How was your experience? Reply with a rating 1-5.")
            # Schedule self-waking for feedback in 7 days
            self.schedule(timedelta(days=7), "FEEDBACK_REQUEST")
            
        elif event_name == "FEEDBACK_REQUEST":
            self._proactive_sms(f"How was your order {self.shipment_id}? Reply with feedback!")

    def handle_call(self):
        """Customer calls -> Agent answers with full shipment context via Call Control."""
        app.logger.info(f"Agent {self.shipment_id} answering call with full context.")
        # In a real Call Control flow, we'd answer the call, use text-to-speech to speak,
        # and potentially bridge to an AI inference loop.
        context = self.get_context_summary()
        return f"Hello! I'm your shipment agent for {self.shipment_id}. Current status: {context}. How can I help?"

    def handle_sms_reply(self, body):
        """Customer replies to SMS -> Agent uses inference to understand and respond."""
        app.logger.info(f"Agent {self.shipment_id} processing SMS reply: {body}")
        
        # Inference: Natural language shipment Q&A
        prompt = self._build_inference_prompt(body)
        
        try:
            # Using Telnyx AI SDK (placeholder for actual Telnyx AI integration if available)
            # In a real app, this might be this.env.TELNYX.ai.openai.chat.createCompletion()
            # Here we simulate the inference call.
            response = self._simulate_inference(prompt)
            self._proactive_sms(response)
        except Exception:
            app.logger.exception(f"Inference failed for agent {self.shipment_id}")
            self._proactive_sms("I'm having trouble understanding right now. Please try again later.")

    def schedule(self, delay, event_name):
        """Self-waking mechanism for future events."""
        wake_time = datetime.now(timezone.utc) + delay
        self.scheduled_wakes.append({"wake_at": wake_time, "event": event_name})
        app.logger.info(f"Agent {self.shipment_id} scheduled wake for {event_name} at {wake_time}")
        
        # Simulate the wake (in production, use a task queue like Celery/RQ or cron)
        def delayed_wake():
            time.sleep(delay.total_seconds())
            self.wake(event_name)
            
        thread = threading.Thread(target=delayed_wake, daemon=True)
        thread.start()

    def _proactive_sms(self, message):
        """Proactively contacts the customer when things change."""
        try:
            telnyx.Message.create(
                from_=self.sms_channel,
                to=self.customer_number,
                text=message,
                messaging_profile_id=TELNYX_MESSAGING_PROFILE_ID
            )
            app.logger.info(f"SMS sent to {self.customer_number}: {message}")
        except Exception:
            app.logger.exception(f"Failed to send SMS for agent {self.shipment_id}")

    def _build_inference_prompt(self, user_query):
        context = self.get_context_summary()
        return f"""
        You are a shipment agent assistant. 
        Shipment Context: {context}
        Customer Query: {user_query}
        Respond concisely:
        """

    def _simulate_inference(self, prompt):
        # Simulated Telnyx AI inference
        return f"Agent AI: Based on your shipment status ({self.status}), I can help with that."

    def get_context_summary(self):
        return json.dumps({
            "shipment_id": self.shipment_id,
            "status": self.status,
            "eta": self.eta,
            "carrier": self.carrier,
            "history_length": len(self.history)
        })

def get_or_create_agent(shipment_id, customer_number=None):
    if shipment_id not in SHIPMENT_AGENTS:
        if not customer_number:
            customer_number = TELNYX_TO_NUMBER
        SHIPMENT_AGENTS[shipment_id] = ShipmentAgent(shipment_id, customer_number)
    return SHIPMENT_AGENTS[shipment_id]

@app.route("/webhooks/telnyx", methods=["POST"])
def telnyx_webhook():
    """Handles inbound Telnyx webhooks (SMS replies, Call Control events)."""
    try:
        # Verify Telnyx Ed25519 signature
        # Case-insensitive header lookup (Telnyx sends mixed casing)
        headers_lower = {k.lower(): v for k, v in request.headers.items()}
        signature = headers_lower.get("telnyx-signature-ed25519", "")
        timestamp = headers_lower.get("telnyx-timestamp", "")
        raw_body = request.get_data(as_text=True)

        if not signature or not timestamp:
            app.logger.warning("Missing Telnyx signature headers. Got headers: %s", list(request.headers.keys()))
            abort(401, "Unauthorized")
            
        try:
            verified_event = telnyx.Webhook.construct_event(
                raw_body, signature, timestamp
            )
        except Exception:
            app.logger.exception("Webhook signature verification failed")
            abort(401, "Unauthorized")

        payload = verified_event.get("data", {}).get("payload", {})
        event_type = verified_event.get("data", {}).get("event_type")
        
        app.logger.info(f"Received Telnyx webhook: {event_type}")

        if event_type == "message.finalized" or event_type == "message.received":
            # Handle inbound SMS reply from customer
            # v2 payload: from is a dict, to is a list of dicts
            from_obj = payload.get("from", {}) or payload.get("from_", {})
            to_list = payload.get("to", [])
            if isinstance(to_list, list) and to_list:
                to_number = to_list[0].get("phone_number")
            else:
                to_number = to_list.get("phone_number") if isinstance(to_list, dict) else None
            from_number = from_obj.get("phone_number") if isinstance(from_obj, dict) else None
            text = payload.get("text")
            
            # Route to the correct agent based on the customer's number
            for sid, agent in SHIPMENT_AGENTS.items():
                if agent.customer_number == from_number:
                    agent.handle_sms_reply(text)
                    return jsonify({"status": "ok"}), 200
                    
        elif event_type and "call" in event_type:
            # Handle Call Control event
            call_id = payload.get("call_control_id")
            # In a full flow, we'd answer the call and bridge to the agent
            app.logger.info(f"Call Control event for call {call_id}")
            
        return jsonify({"status": "ok"}), 200
        
    except Exception as e:
        app.logger.exception("Error processing Telnyx webhook")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/webhooks/carrier", methods=["POST"])
def carrier_webhook():
    """Handles inbound carrier status updates (FedEx/UPS API)."""
    try:
        # In production, verify carrier webhook signature here
        data = request.json or {}
        shipment_id = data.get("shipment_id")
        status = data.get("status")
        
        if not shipment_id or not status:
            abort(400, "Missing shipment_id or status")
            
        app.logger.info(f"Received carrier webhook for {shipment_id}: {status}")
        
        agent = get_or_create_agent(shipment_id)
        
        # Map carrier statuses to agent wake events
        event_map = {
            "PICKED_UP": "PICKED_UP",
            "IN_TRANSIT": "IN_TRANSIT",
            "DELAYED": "DELAY_DETECTED",
            "OUT_FOR_DELIVERY": "OUT_FOR_DELIVERY",
            "DELIVERED": "DELIVERED"
        }
        
        event_name = event_map.get(status)
        if event_name:
            event_data = data.get("event_data", {})
            agent.wake(event_name, event_data)
            
        return jsonify({"status": "ok"}), 200
        
    except Exception as e:
        app.logger.exception("Error processing carrier webhook")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/api/agents/<shipment_id>/call", methods=["POST"])
def trigger_agent_call(shipment_id):
    """Simulates a customer calling the agent (triggers Call Control context)."""
    try:
        agent = get_or_create_agent(shipment_id)
        response = agent.handle_call()
        return jsonify({"shipment_id": shipment_id, "response": response}), 200
    except Exception:
        app.logger.exception("Error triggering agent call")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/api/agents/<shipment_id>", methods=["GET"])
def get_agent_state(shipment_id):
    """Retrieve the current state of the shipment agent."""
    try:
        if shipment_id not in SHIPMENT_AGENTS:
            return jsonify({"error": "Agent not found"}), 404
            
        agent = SHIPMENT_AGENTS[shipment_id]
        return jsonify({
            "shipment_id": agent.shipment_id,
            "status": agent.status,
            "eta": agent.eta,
            "carrier": agent.carrier,
            "history": agent.history,
            "scheduled_wakes": agent.scheduled_wakes
        }), 200
    except Exception:
        app.logger.exception("Error retrieving agent state")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_DEBUG", "false").strip().lower() in ("1", "true", "yes", "on")
    app.run(port=5000, debug=debug_mode)
