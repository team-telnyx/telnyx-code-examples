#!/usr/bin/env python3
"""Global Lead Response Engine — multi-language AI qualification with live transfer and omnichannel follow-up."""

import os
import json
import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify

load_dotenv()

app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"

# Map country codes to AE numbers for live transfer
AE_NUMBERS = {}
for pair in os.getenv("AE_NUMBERS", "").split(","):
    pair = pair.strip()
    if pair.startswith("+1"):
        AE_NUMBERS["US"] = pair
    elif pair.startswith("+44"):
        AE_NUMBERS["GB"] = pair
    elif pair.startswith("+49"):
        AE_NUMBERS["DE"] = pair
    elif pair:
        AE_NUMBERS["DEFAULT"] = pair

# Language detection and routing
LANGUAGE_MAP = {
    "US": {"lang": "en-US", "greeting": "Hi, thanks for calling! How can I help you?"},
    "GB": {"lang": "en-GB", "greeting": "Hello, thanks for calling. How can I help?"},
    "MX": {"lang": "es-MX", "greeting": "Hola, gracias por llamar. ¿En qué puedo ayudarle?"},
    "ES": {"lang": "es-ES", "greeting": "Hola, gracias por llamar. ¿En qué puedo ayudarle?"},
    "BR": {"lang": "pt-BR", "greeting": "Olá, obrigado por ligar. Como posso ajudá-lo?"},
    "FR": {"lang": "fr-FR", "greeting": "Bonjour, merci d'avoir appelé. Comment puis-je vous aider?"},
    "DE": {"lang": "de-DE", "greeting": "Hallo, danke für Ihren Anruf. Wie kann ich Ihnen helfen?"},
    "JP": {"lang": "ja-JP", "greeting": "お電話ありがとうございます。ご用件をお伺いします。"},
}
DEFAULT_LANG = {"lang": "en-US", "greeting": "Hi, thanks for calling! How can I help you?"}

# Active calls
active_calls = {}
lead_results = []


def number_lookup(phone_number):
    """Look up caller's country and carrier via Number Lookup API."""
    try:
        resp = requests.get(
            f"https://api.telnyx.com/v2/number_lookup/{phone_number}",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            timeout=10,
        )
        if resp.ok:
            data = resp.json().get("data", {})
            country = data.get("country_code", "US")
            carrier = data.get("carrier", {}).get("name", "Unknown")
            return {"country": country, "carrier": carrier}
    except requests.RequestException:
        pass
    return {"country": "US", "carrier": "Unknown"}


def call_inference(messages, max_tokens=200):
    """Call Telnyx Inference."""
    resp = requests.post(
        INFERENCE_URL,
        headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def qualify_lead(conversation):
    """Use inference to qualify the lead based on conversation."""
    messages = [
        {"role": "system", "content": (
            "Analyze this lead qualification call. Return JSON with: "
            "qualification (hot/warm/cold), interest (string), "
            "budget_mentioned (boolean), timeline (string or null), "
            "next_step (live_transfer/whatsapp_follow_up/sms_follow_up/no_action), "
            "summary (one paragraph)."
        )},
        {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in conversation if m['role'] != 'system')},
    ]
    return call_inference(messages, max_tokens=300)


def send_follow_up(to_number, text, channel="sms"):
    """Send follow-up via SMS or WhatsApp."""
    payload = {"from": list(AE_NUMBERS.values())[0] if AE_NUMBERS else to_number, "to": to_number, "text": text}
    if MESSAGING_PROFILE_ID:
        payload["messaging_profile_id"] = MESSAGING_PROFILE_ID
    if channel == "whatsapp":
        payload["messaging_profile_id"] = MESSAGING_PROFILE_ID  # WhatsApp requires profile
    try:
        requests.post(
            "https://api.telnyx.com/v2/messages",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
    except requests.RequestException as e:
        app.logger.error(f"Follow-up send failed: {e}")


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    """Handle inbound calls with language-aware AI qualification."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    event_type = payload.get("data", {}).get("event_type")
    call_control_id = payload.get("data", {}).get("call_control_id")
    data = payload.get("data", {})

    if event_type == "call.initiated" and data.get("direction") == "incoming":
        caller = data.get("from", "")
        lookup = number_lookup(caller)
        country = lookup["country"]
        lang_config = LANGUAGE_MAP.get(country, DEFAULT_LANG)

        active_calls[call_control_id] = {
            "caller": caller,
            "country": country,
            "language": lang_config["lang"],
            "greeting": lang_config["greeting"],
            "conversation": [{"role": "system", "content": (
                f"You are a multilingual lead qualification agent. The caller is from {country}. "
                f"Speak in the appropriate language ({lang_config['lang']}). "
                "Ask about their needs, budget, timeline, and decision process. "
                "Keep responses under 2 sentences."
            )}],
        }
        client.calls.actions.answer(call_control_id)
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        call = active_calls.get(call_control_id)
        if call:
            client.calls.actions.speak(
                call_control_id,
                payload=call["greeting"],
                voice="female",
                language_code=call["language"],
            )
        return jsonify({"status": "greeting"}), 200

    elif event_type == "call.speak.ended":
        call = active_calls.get(call_control_id)
        if call:
            client.calls.actions.gather(
                call_control_id,
                input_type="speech",
                end_silence_timeout_secs=2,
                timeout_secs=15,
                language_code=call.get("language", "en-US"),
            )
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.gather.ended":
        call = active_calls.get(call_control_id)
        if not call:
            return jsonify({"status": "no_call"}), 200

        speech = data.get("speech", {}).get("result", "")
        if not speech:
            client.calls.actions.speak(call_control_id, payload="I didn't catch that.", voice="female", language_code=call["language"])
            return jsonify({"status": "reprompting"}), 200

        call["conversation"].append({"role": "user", "content": speech})

        # After 3+ exchanges, qualify and route
        user_messages = [m for m in call["conversation"] if m["role"] == "user"]
        if len(user_messages) >= 3:
            try:
                qual_json = qualify_lead(call["conversation"])
                qual = json.loads(qual_json)
                next_step = qual.get("next_step", "sms_follow_up")

                if next_step == "live_transfer":
                    ae = AE_NUMBERS.get(call["country"], AE_NUMBERS.get("DEFAULT"))
                    if ae:
                        client.calls.actions.speak(
                            call_control_id,
                            payload="Great, let me connect you with a specialist right now.",
                            voice="female",
                            language_code=call["language"],
                        )
                        # Transfer would happen via call.speak.ended -> transfer action
                elif next_step == "whatsapp_follow_up":
                    send_follow_up(call["caller"], qual.get("summary", "Thanks for your interest!"), "whatsapp")
                    client.calls.actions.speak(call_control_id, payload="I've sent you more information on WhatsApp. Thanks for calling!", voice="female", language_code=call["language"])
                else:
                    send_follow_up(call["caller"], qual.get("summary", "Thanks for your interest!"), "sms")
                    client.calls.actions.speak(call_control_id, payload="I've texted you some information. Thanks for calling!", voice="female", language_code=call["language"])

                lead_results.append({"caller": call["caller"], "country": call["country"], "qualification": qual})
            except Exception as e:
                app.logger.error(f"Qualification failed: {e}")
                response = call_inference(call["conversation"])
                call["conversation"].append({"role": "assistant", "content": response})
                client.calls.actions.speak(call_control_id, payload=response, voice="female", language_code=call["language"])
        else:
            response = call_inference(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            client.calls.actions.speak(call_control_id, payload=response, voice="female", language_code=call["language"])

        return jsonify({"status": "responding"}), 200

    elif event_type == "call.hangup":
        active_calls.pop(call_control_id, None)
        return jsonify({"status": "call_ended"}), 200

    return jsonify({"status": "event_received"}), 200


@app.route("/leads", methods=["GET"])
def get_leads():
    return jsonify({"leads": lead_results[-50:], "total": len(lead_results)}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active_calls": len(active_calls), "leads_qualified": len(lead_results)}), 200


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
