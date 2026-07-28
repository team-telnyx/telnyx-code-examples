#!/usr/bin/env python3
"""Storage Voicemail Archive — record voicemails to Telnyx Cloud Storage with search.

Telnyx Cloud Storage is S3-compatible, so the recording is uploaded with boto3 pointed
at the Telnyx S3 endpoint (API key used as both access and secret key).
Docs: https://developers.telnyx.com/docs/cloud-storage/quick-start
"""
import os, json, time, requests, telnyx
from urllib.parse import urlparse
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET")
VOICEMAIL_NUMBER = os.getenv("VOICEMAIL_NUMBER")
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")

# S3-compatible client for Telnyx Cloud Storage.
s3 = boto3.client(
    "s3", endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY, aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION, config=Config(signature_version="s3v4"),
)
voicemails = []


def is_telnyx_url(url: str) -> bool:
    """Only fetch recordings from Telnyx hosts with the API key attached."""
    try:
        parts = urlparse(url or "")
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "telnyx.com" or host.endswith(".telnyx.com"))

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    event_type = payload.get("data", {}).get("event_type")
    data = payload.get("data", {})
    p = data.get("payload", {})
    ccid = p.get("call_control_id")
    if event_type == "call.initiated" and p.get("direction") == "incoming":
        client.calls.actions.answer(ccid)
        return jsonify({"status": "answering"}), 200
    elif event_type == "call.answered":
        client.calls.actions.speak(ccid, payload="Please leave your message after the beep.", voice="female", language_code="en-US")
        return jsonify({"status": "greeting"}), 200
    elif event_type == "call.speak.ended":
        client.calls.actions.start_recording(ccid, format="mp3", channels="single", play_beep=True, max_length_secs=120)
        return jsonify({"status": "recording"}), 200
    elif event_type == "call.recording.saved":
        recording_url = p.get("recording_urls", {}).get("mp3", "")
        caller = p.get("from", {}).get("phone_number", "unknown") if isinstance(p.get("from"), dict) else p.get("from", "unknown")
        filename = f"voicemail-{int(time.time())}-{caller.replace('+','')}.mp3"
        if recording_url and STORAGE_BUCKET and is_telnyx_url(recording_url):
            try:
                audio = requests.get(recording_url, headers={"Authorization": f"Bearer {TELNYX_API_KEY}"}, timeout=30).content
                s3.put_object(Bucket=STORAGE_BUCKET, Key=filename, Body=audio, ContentType="audio/mpeg")
            except (ClientError, requests.RequestException) as e:
                app.logger.error("Storage upload failed: %s", e)
        voicemails.append({"caller": caller, "filename": filename, "duration": p.get("duration_secs"), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return jsonify({"status": "archived"}), 200
    elif event_type == "call.hangup":
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

@app.route("/voicemails", methods=["GET"])
def list_voicemails():
    return jsonify({"voicemails": voicemails[-50:]}), 200

@app.route("/voicemails/search", methods=["GET"])
def search_voicemails():
    caller = request.args.get("caller", "")
    results = [v for v in voicemails if caller in v.get("caller", "")]
    return jsonify({"results": results}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "voicemails": len(voicemails)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
