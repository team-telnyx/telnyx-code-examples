#!/usr/bin/env python3
"""RCS Capability Campaign Desk — adaptive RCS/SMS sending with a dark-theme dashboard.

Checks device RCS capabilities via Number Lookup and RCS Capabilities API,
generates AI content via Telnyx Inference, then sends the optimal message
format (rich card, plain RCS, or SMS fallback) based on a decision ladder.

Run:
    pip install -r requirements.txt
    cp .env.example .env   # fill in credentials
    python app.py          # http://localhost:5050
"""

import json
import os
import time

import requests as http_requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
RCS_AGENT_ID = os.getenv("RCS_AGENT_ID", "")
MESSAGING_PROFILE_ID = os.getenv("MESSAGING_PROFILE_ID", "")
BOT_NUMBER = os.getenv("BOT_NUMBER", "")
AI_MODEL = os.getenv("AI_MODEL", "THUDM/GLM3-flash")
PORT = int(os.getenv("PORT", "5050"))

BASE_URL = "https://api.telnyx.com"
_start_time = time.time()


def _headers():
    """Standard auth headers for Telnyx API calls."""
    return {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json",
    }


def _api_error(exc):
    """Extract a human-readable error from a Telnyx API exception."""
    try:
        body = exc.response.json()
        errs = body.get("errors", [])
        if errs:
            return f"{errs[0].get('title', 'Error')}: {errs[0].get('detail', str(exc))}"
    except Exception:
        pass
    return str(exc)


# ---------------------------------------------------------------------------
# Decision ladder — pure function, no network calls
# ---------------------------------------------------------------------------
def decide_format(line_type, rcs_features):
    """Decide optimal message format based on device capabilities.

    Args:
        line_type: "mobile", "landline", "voip", or "unknown" from Number Lookup.
        rcs_features: list of RCS feature strings from Capabilities API,
                      e.g. ["RICHCARD_STANDALONE", "ACTION_DIAL", ...].
                      Empty list means no RCS support.

    Returns:
        dict with "format", "tier", and "reason" keys.
    """
    features = set(rcs_features) if rcs_features else set()

    if line_type in ("landline", "voip"):
        return {
            "format": "sms_only",
            "tier": "no_rcs",
            "reason": f"{line_type} detected — SMS is the only option.",
        }

    if "RICHCARD_STANDALONE" in features:
        return {
            "format": "rich_card_with_sms_fallback",
            "tier": "full_rcs",
            "reason": "Device supports standalone rich cards — sending rich card with SMS fallback.",
        }

    if features:
        return {
            "format": "plain_rcs_with_sms_fallback",
            "tier": "basic_rcs",
            "reason": "Device supports basic RCS but not rich cards — sending plain RCS with SMS fallback.",
        }

    return {
        "format": "sms_only",
        "tier": "no_rcs",
        "reason": "No RCS support detected — falling back to SMS.",
    }


# ---------------------------------------------------------------------------
# Routes — health + dashboard
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "uptime_seconds": round(time.time() - _start_time),
        "version": "1.0.0",
    }), 200


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# API — Capability Check (Number Lookup + RCS Capabilities)
# ---------------------------------------------------------------------------
@app.route("/api/check-capability", methods=["POST"])
def check_capability():
    body = request.get_json(silent=True) or {}
    phone = body.get("phone", "").strip()
    if not phone:
        return jsonify({"error": "phone is required"}), 400

    result = {"phone": phone, "number_lookup": None, "rcs_capabilities": None,
              "decision": None}

    # 1. Number Lookup
    try:
        resp = http_requests.get(
            f"{BASE_URL}/v2/number_lookup/{phone}",
            headers=_headers(), timeout=10,
        )
        resp.raise_for_status()
        nl_data = resp.json().get("data", {})
        carrier = nl_data.get("carrier") or {}
        portability = nl_data.get("portability") or {}
        # carrier object is often null; fall back to portability data
        carrier_name = (carrier.get("name")
                        or portability.get("spid_carrier_name")
                        or "unknown")
        line_type_val = (carrier.get("type")
                         or portability.get("line_type")
                         or "unknown")
        result["number_lookup"] = {
            "carrier": carrier_name,
            "line_type": line_type_val,
            "country_code": nl_data.get("country_code", ""),
            "valid_number": nl_data.get("valid_number", False),
            "national_format": nl_data.get("national_format", ""),
        }
    except http_requests.RequestException as exc:
        result["number_lookup"] = {"error": str(exc)}

    line_type = (result["number_lookup"] or {}).get("line_type", "unknown")

    # 2. RCS Capabilities
    rcs_features = []
    if line_type not in ("landline", "voip"):
        try:
            resp = http_requests.get(
                f"{BASE_URL}/v2/messaging/rcs/capabilities/{RCS_AGENT_ID}/{phone}",
                headers=_headers(), timeout=10,
            )
            resp.raise_for_status()
            rcs_data = resp.json().get("data", {})
            rcs_features = rcs_data.get("features") or []
            rcs_status = rcs_data.get("status", "")
            result["rcs_capabilities"] = {
                "features": rcs_features,
                "rcs_enabled": bool(rcs_features),
                "status": rcs_status,
            }
        except http_requests.RequestException as exc:
            result["rcs_capabilities"] = {"error": str(exc), "features": [],
                                          "rcs_enabled": False}

    # 3. Decision
    result["decision"] = decide_format(line_type, rcs_features)
    return jsonify(result), 200


# ---------------------------------------------------------------------------
# API — AI Content Generation (Telnyx Inference)
# ---------------------------------------------------------------------------
@app.route("/api/generate-content", methods=["POST"])
def generate_content():
    body = request.get_json(silent=True) or {}
    prompt = body.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    system_msg = (
        "You are an RCS marketing content generator. Given a campaign prompt, "
        "return ONLY a JSON object (no markdown fences) with these keys: "
        '"title" (max 50 chars), "description" (max 200 chars), '
        '"button_text" (max 25 chars), "button_url" (a plausible https URL), '
        '"sms_fallback_text" (max 160 chars, plain-text summary with URL).'
    )

    try:
        resp = http_requests.post(
            f"{BASE_URL}/v2/ai/chat/completions",
            headers=_headers(),
            json={
                "model": AI_MODEL,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 300,
                "temperature": 0.7,
            },
            timeout=30,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        content = json.loads(cleaned.strip())
        return jsonify({"content": content}), 200
    except (http_requests.RequestException, json.JSONDecodeError, KeyError, IndexError) as exc:
        return jsonify({"error": f"AI generation failed: {exc}"}), 502


# ---------------------------------------------------------------------------
# API — Adaptive Send (Decision Ladder)
# ---------------------------------------------------------------------------
@app.route("/api/send", methods=["POST"])
def send_message():
    body = request.get_json(silent=True) or {}
    phone = body.get("phone", "").strip()
    title = body.get("title", "")
    description = body.get("description", "")
    button_text = body.get("button_text", "")
    button_url = body.get("button_url", "")
    sms_fallback_text = body.get("sms_fallback_text", "")

    force_rcs = body.get("force_rcs", False)

    if not phone:
        return jsonify({"error": "phone is required"}), 400
    if not sms_fallback_text and not title:
        return jsonify({"error": "content is required (title or sms_fallback_text)"}), 400

    # 1. Run capability check inline (skip if force_rcs)
    line_type = "unknown"
    rcs_features = []

    if force_rcs:
        # Override: treat as full RCS device (for test devices during agent provisioning)
        rcs_features = ["RICHCARD_STANDALONE"]
        decision = {
            "format": "rich_card_with_sms_fallback",
            "tier": "full_rcs",
            "reason": "Force RCS enabled — bypassing capability check (test mode).",
        }
    else:
        try:
            resp = http_requests.get(
                f"{BASE_URL}/v2/number_lookup/{phone}",
                headers=_headers(), timeout=10,
            )
            resp.raise_for_status()
            nl_data = resp.json().get("data", {})
            carrier = nl_data.get("carrier") or {}
            portability = nl_data.get("portability") or {}
            line_type = (carrier.get("type")
                         or portability.get("line_type")
                         or "unknown")
        except http_requests.RequestException:
            pass

        if line_type not in ("landline", "voip"):
            try:
                resp = http_requests.get(
                    f"{BASE_URL}/v2/messaging/rcs/capabilities/{RCS_AGENT_ID}/{phone}",
                    headers=_headers(), timeout=10,
                )
                resp.raise_for_status()
                rcs_data = resp.json().get("data", {})
                rcs_features = rcs_data.get("features", [])
            except http_requests.RequestException:
                pass

        decision = decide_format(line_type, rcs_features)
    send_results = []

    # 2. Send based on decision
    fmt = decision["format"]

    if fmt == "rich_card_with_sms_fallback":
        # Send RCS rich card via /v2/messages/rcs
        rcs_payload = {
            "agent_id": RCS_AGENT_ID,
            "to": phone,
            "messaging_profile_id": MESSAGING_PROFILE_ID,
            "agent_message": {
                "content_message": {
                    "rich_card": {
                        "standalone_card": {
                            "card_orientation": "VERTICAL",
                            "card_content": {
                                "title": title,
                                "description": description,
                                "suggestions": [{
                                    "action": {
                                        "text": button_text or "Learn More",
                                        "postback_data": button_url or "open_url",
                                        "open_url_action": {"url": button_url},
                                    },
                                }] if button_url else [],
                            },
                        },
                    },
                },
            },
        }
        # Include SMS fallback in the RCS payload if available
        if sms_fallback_text:
            rcs_payload["sms_fallback"] = {
                "from": BOT_NUMBER,
                "text": sms_fallback_text,
            }
        try:
            r = http_requests.post(f"{BASE_URL}/v2/messages/rcs", headers=_headers(),
                                   json=rcs_payload, timeout=10)
            r.raise_for_status()
            send_results.append({"channel": "rcs_rich_card", "status": "sent",
                                 "message_id": r.json().get("data", {}).get("id")})
            if sms_fallback_text:
                send_results.append({"channel": "sms_fallback", "status": "included",
                                     "message_id": "(via RCS fallback)"})
        except http_requests.RequestException as exc:
            send_results.append({"channel": "rcs_rich_card", "status": "failed",
                                 "error": _api_error(exc)})
            # If RCS fails, send SMS separately
            if sms_fallback_text:
                try:
                    r = http_requests.post(f"{BASE_URL}/v2/messages", headers=_headers(),
                                           json={"from": BOT_NUMBER, "to": phone, "text": sms_fallback_text,
                                                 "messaging_profile_id": MESSAGING_PROFILE_ID, "type": "SMS"},
                                           timeout=10)
                    r.raise_for_status()
                    send_results.append({"channel": "sms_fallback", "status": "sent",
                                         "message_id": r.json().get("data", {}).get("id")})
                except http_requests.RequestException as exc2:
                    send_results.append({"channel": "sms_fallback", "status": "failed",
                                         "error": _api_error(exc2)})

    elif fmt == "plain_rcs_with_sms_fallback":
        # Plain RCS text via /v2/messages/rcs
        text = f"{title}\n{description}" if description else title
        rcs_payload = {
            "agent_id": RCS_AGENT_ID,
            "to": phone,
            "messaging_profile_id": MESSAGING_PROFILE_ID,
            "agent_message": {
                "content_message": {
                    "text": text,
                },
            },
        }
        if sms_fallback_text:
            rcs_payload["sms_fallback"] = {
                "from": BOT_NUMBER,
                "text": sms_fallback_text,
            }
        try:
            r = http_requests.post(f"{BASE_URL}/v2/messages/rcs", headers=_headers(),
                                   json=rcs_payload, timeout=10)
            r.raise_for_status()
            send_results.append({"channel": "rcs_plain", "status": "sent",
                                 "message_id": r.json().get("data", {}).get("id")})
            if sms_fallback_text:
                send_results.append({"channel": "sms_fallback", "status": "included",
                                     "message_id": "(via RCS fallback)"})
        except http_requests.RequestException as exc:
            send_results.append({"channel": "rcs_plain", "status": "failed",
                                 "error": _api_error(exc)})
            if sms_fallback_text:
                try:
                    r = http_requests.post(f"{BASE_URL}/v2/messages", headers=_headers(),
                                           json={"from": BOT_NUMBER, "to": phone, "text": sms_fallback_text,
                                                 "messaging_profile_id": MESSAGING_PROFILE_ID, "type": "SMS"},
                                           timeout=10)
                    r.raise_for_status()
                    send_results.append({"channel": "sms_fallback", "status": "sent",
                                         "message_id": r.json().get("data", {}).get("id")})
                except http_requests.RequestException as exc2:
                    send_results.append({"channel": "sms_fallback", "status": "failed",
                                         "error": _api_error(exc2)})

    else:  # sms_only
        text = sms_fallback_text or f"{title} — {description}"
        try:
            r = http_requests.post(f"{BASE_URL}/v2/messages", headers=_headers(),
                                   json={"from": BOT_NUMBER, "to": phone, "text": text,
                                         "messaging_profile_id": MESSAGING_PROFILE_ID, "type": "SMS"},
                                   timeout=10)
            r.raise_for_status()
            send_results.append({"channel": "sms", "status": "sent",
                                 "message_id": r.json().get("data", {}).get("id")})
        except http_requests.RequestException as exc:
            send_results.append({"channel": "sms", "status": "failed",
                                 "error": _api_error(exc)})

    return jsonify({"decision": decision, "results": send_results}), 200


# ---------------------------------------------------------------------------
# API — Deeplink Generation
# ---------------------------------------------------------------------------
@app.route("/api/generate-deeplink", methods=["POST"])
def generate_deeplink():
    body = request.get_json(silent=True) or {}
    message_body = body.get("body", "").strip()
    if not message_body:
        return jsonify({"error": "body is required"}), 400

    try:
        resp = http_requests.get(
            f"{BASE_URL}/v2/messages/rcs_deeplinks/{RCS_AGENT_ID}",
            headers=_headers(),
            params={"body": message_body},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        return jsonify({"deeplink": data.get("deeplink_url", ""), "raw": data}), 200
    except http_requests.RequestException as exc:
        return jsonify({"error": f"Deeplink generation failed: {exc}"}), 502


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=PORT)
