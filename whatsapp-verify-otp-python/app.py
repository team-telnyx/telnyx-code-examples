#!/usr/bin/env python3
"""WhatsApp Verify OTP — Send and verify one-time passwords via WhatsApp using the Telnyx Verify API."""
import os
import re
import time
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading
import time as _ttl_time

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
VERIFY_PROFILE_ID = os.getenv("VERIFY_PROFILE_ID")
VERIFY_WEBHOOK_SIGNATURE = os.getenv("VERIFY_WEBHOOK_SIGNATURE", "false").lower() in ("true", "1", "yes")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")  # optional: for webhook signature verification

if not TELNYX_API_KEY:
    app.logger.error("TELNYX_API_KEY is not set. Copy .env.example to .env and fill in your credentials.")
if not VERIFY_PROFILE_ID:
    app.logger.error("VERIFY_PROFILE_ID is not set. Create a Verify Profile with WhatsApp enabled in the Telnyx Portal.")

verifications = {}
webhook_events = []

API_BASE = "https://api.telnyx.com/v2"

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _is_valid_phone(phone):
    """Validate E.164 phone number to prevent SSRF via URL injection."""
    return bool(phone and _E164_RE.match(phone))


def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                if isinstance(store, dict):
                    expired = [k for k, v in store.items()
                               if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                    for k in expired:
                        store.pop(k, None)
                elif isinstance(store, list):
                    store[:] = [e for e in store
                                if isinstance(e, dict) and e.get("_ts", _ttl_time.time()) >= cutoff]

    threading.Thread(target=_cleanup, daemon=True).start()


_start_ttl_cleanup(verifications, webhook_events)


def _verify_webhook_signature(req):
    """Verify Telnyx webhook signature using the public key. Returns True if valid or disabled."""
    if not VERIFY_WEBHOOK_SIGNATURE:
        return True
    if not TELNYX_PUBLIC_KEY:
        app.logger.warning("VERIFY_WEBHOOK_SIGNATURE enabled but TELNYX_PUBLIC_KEY not set — rejecting.")
        return False
    try:
        from standardwebhooks import Webhook
        wh = Webhook(TELNYX_PUBLIC_KEY)
        msg_id = req.headers.get("webhook-id", "")
        msg_signature = req.headers.get("webhook-signature", "")
        msg_timestamp = req.headers.get("webhook-timestamp", "")
        wh.verify(req.get_data(), msg_id, msg_signature, msg_timestamp)
        return True
    except Exception as e:
        app.logger.warning("Webhook signature verification failed: %s", e)
        return False


@app.route("/verify/start", methods=["POST"])
def start_verification():
    data = request.get_json()
    if data is None:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    if not phone:
        return jsonify({"error": "phone_number required"}), 400
    if not _is_valid_phone(phone):
        return jsonify({"error": "phone_number must be E.164 format (e.g. +12125551234)"}), 400
    if not TELNYX_API_KEY or not VERIFY_PROFILE_ID:
        return jsonify({"error": "server not configured — set TELNYX_API_KEY and VERIFY_PROFILE_ID"}), 500
    try:
        resp = requests.post(
            f"{API_BASE}/verifications/whatsapp",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "phone_number": phone,
                "verify_profile_id": VERIFY_PROFILE_ID,
            },
            timeout=10,
        )
        if resp.ok:
            body = resp.json().get("data", {})
            verifications[phone] = {
                "status": "pending",
                "channel": "whatsapp",
                "verification_id": body.get("id"),
                "started": time.time(),
                "_ts": time.time(),
            }
            return jsonify({"status": "sent", "phone": phone, "channel": "whatsapp"}), 200
        return jsonify({"error": resp.text}), resp.status_code
    except requests.exceptions.RequestException as e:
        app.logger.exception("Failed to start verification")
        return jsonify({"error": "could not start verification"}), 500


@app.route("/verify/check", methods=["POST"])
def check_verification():
    data = request.get_json()
    if data is None:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone_number")
    code = data.get("code")
    if not phone or not code:
        return jsonify({"error": "phone_number and code required"}), 400
    if not _is_valid_phone(phone):
        return jsonify({"error": "phone_number must be E.164 format (e.g. +12125551234)"}), 400
    if not TELNYX_API_KEY or not VERIFY_PROFILE_ID:
        return jsonify({"error": "server not configured — set TELNYX_API_KEY and VERIFY_PROFILE_ID"}), 500
    try:
        resp = requests.post(
            f"{API_BASE}/verifications/by_phone_number/{phone}/actions/verify",
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "code": code,
                "verify_profile_id": VERIFY_PROFILE_ID,
            },
            timeout=10,
        )
        if resp.ok:
            body = resp.json().get("data", {})
            response_code = body.get("response_code", "")
            if response_code == "accepted":
                verifications[phone] = {
                    "status": "verified",
                    "verified_at": time.time(),
                    "_ts": time.time(),
                }
                return jsonify({"status": "verified"}), 200
            return jsonify({"status": "rejected", "response_code": response_code}), 200
        return jsonify({"error": resp.text}), resp.status_code
    except requests.exceptions.RequestException as e:
        app.logger.exception("Failed to check verification")
        return jsonify({"error": "could not verify code"}), 500


@app.route("/webhooks/verify", methods=["POST"])
def verify_webhook():
    if not _verify_webhook_signature(request):
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"status": "ignored"}), 200
    event_type = payload.get("data", {}).get("event_type", "")
    phone = payload.get("data", {}).get("payload", {}).get("phone_number", "")
    app.logger.info("Webhook received: %s", event_type)
    webhook_events.append({
        "event": event_type,
        "phone": phone,
        "received_at": time.time(),
        "_ts": time.time(),
    })
    if phone and phone in verifications:
        if event_type == "verify.sent":
            verifications[phone]["status"] = "sent"
        elif event_type == "verify.delivered":
            verifications[phone]["status"] = "delivered"
        elif event_type == "verify.failed":
            verifications[phone]["status"] = "failed"
    return jsonify({"status": "ok"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "configured": bool(TELNYX_API_KEY and VERIFY_PROFILE_ID),
        "verifications": len(verifications),
        "webhook_events": len(webhook_events),
    }), 200


if __name__ == "__main__":
    app.run(
        debug=False,
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
    )
