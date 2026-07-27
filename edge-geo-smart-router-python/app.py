"""Edge Geo Smart Router — detect caller region and apply different business logic.
US callers get English AI. LATAM gets Spanish. EU gets GDPR-compliant recording
with mandatory consent collection before proceeding."""
import os, json, time, base64, logging
from urllib.parse import urlparse
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import requests
import boto3
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

load_dotenv()
app = Flask(__name__)
app.logger.setLevel(logging.INFO)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
# Telnyx Storage is S3-compatible but uses SEPARATE storage credentials
# (created in Portal > Storage), not the Telnyx API key.
STORAGE_ACCESS_KEY = os.getenv("STORAGE_ACCESS_KEY", "")
STORAGE_SECRET_KEY = os.getenv("STORAGE_SECRET_KEY", "")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "call-recordings")
STORAGE_REGION = os.getenv("STORAGE_REGION", "us-east-1")
HOST = os.getenv("HOST", "127.0.0.1")
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

if STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY:
    s3 = boto3.client(
        "s3",
        endpoint_url="https://storage.telnyx.com",
        aws_access_key_id=STORAGE_ACCESS_KEY,
        aws_secret_access_key=STORAGE_SECRET_KEY,
        region_name=STORAGE_REGION,
    )
else:
    s3 = None
    app.logger.warning(
        "STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY not set — "
        "call recording archival to Telnyx Storage is disabled."
    )

# Voice ids follow the <Provider>.<Model>.<VoiceId> format.
# AWS.Polly neural voices support the languages below; "female"/"male" only
# work with service_level="basic" (en-US only), so we use explicit voice ids.
REGION_CONFIG = {
    "US":     {"language": "en-US", "voice": "AWS.Polly.Joanna-Neural",
               "greeting": "Welcome. How can I help you today?",
               "requires_consent": False, "record": True},
    "LATAM":  {"language": "es-MX", "voice": "AWS.Polly.Lupe-Neural",
               "greeting": "Bienvenido. Como puedo ayudarle hoy?",
               "requires_consent": False, "record": True},
    "EU":     {"language": "en-GB", "voice": "AWS.Polly.Amy-Neural",
               "greeting": "This call will be recorded for quality purposes. "
                           "Press 1 to consent and continue, or press 2 to "
                           "proceed without recording.",
               "requires_consent": True, "record": False},
    "DEFAULT":{"language": "en-US", "voice": "AWS.Polly.Joanna-Neural",
               "greeting": "Welcome. How can I help you?",
               "requires_consent": False, "record": True}
}

EU_PREFIXES = ["+33", "+34", "+39", "+44", "+49", "+31", "+32", "+43", "+45", "+46", "+47",
               "+48", "+351", "+353", "+358", "+352", "+356", "+370", "+371", "+372", "+420", "+421"]
LATAM_PREFIXES = ["+52", "+55", "+54", "+56", "+57", "+51", "+58", "+53", "+506", "+507",
                  "+502", "+503", "+504", "+505"]

call_sessions = {}
MAX_ENTRIES = 10000

def ttl_cleanup(store, max_size=MAX_ENTRIES):
    if len(store) > max_size:
        oldest = sorted(store, key=lambda k: store[k].get("ts", 0))
        for k in oldest[:len(store) - max_size]:
            del store[k]

def detect_region(phone):
    if not phone:
        return "DEFAULT"
    for prefix in EU_PREFIXES:
        if phone.startswith(prefix):
            return "EU"
    for prefix in LATAM_PREFIXES:
        if phone.startswith(prefix):
            return "LATAM"
    if phone.startswith("+1"):
        return "US"
    return "DEFAULT"

def encode_state(data):
    return base64.b64encode(json.dumps(data).encode()).decode()

def decode_state(b64):
    try: return json.loads(base64.b64decode(b64).decode())
    except: return {}

# Telnyx public key (Portal > Keys & Credentials) is a base64-encoded 32-byte Ed25519 key.
_TELNYX_VERIFY_KEY = None
if TELNYX_PUBLIC_KEY:
    try:
        _TELNYX_VERIFY_KEY = Ed25519PublicKey.from_public_bytes(base64.b64decode(TELNYX_PUBLIC_KEY))
    except Exception as e:
        app.logger.error("Invalid TELNYX_PUBLIC_KEY, webhook verification disabled: %s", e)

MAX_SKEW_SECONDS = 300

def verify_telnyx_signature(raw_body, headers):
    """Verify the Telnyx Ed25519 signature over ``<timestamp>|<raw body>`` before
    trusting the webhook. Headers are telnyx-signature-ed25519 (base64) and
    telnyx-timestamp. Rejects signatures older than MAX_SKEW_SECONDS (replay)."""
    if _TELNYX_VERIFY_KEY is None:
        return False
    signature = headers.get("telnyx-signature-ed25519", "")
    timestamp = headers.get("telnyx-timestamp", "")
    if not signature or not timestamp:
        return False
    try:
        if abs(time.time() - int(timestamp)) > MAX_SKEW_SECONDS:
            return False
        signed = f"{timestamp}|".encode() + raw_body
        _TELNYX_VERIFY_KEY.verify(base64.b64decode(signature), signed)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False

def is_telnyx_url(url):
    """Only fetch recordings from Telnyx hosts (the API key is attached to the request)."""
    try:
        parts = urlparse(url or "")
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "telnyx.com" or host.endswith(".telnyx.com"))

def call_inference(prompt, language="en-US"):
    try:
        lang_instruction = "Respond in Spanish." if "es" in language else "Respond in English."
        resp = requests.post(INFERENCE_URL, headers=HEADERS, timeout=15, json={
            "model": AI_MODEL,
            "messages": [{"role": "system", "content": f"You are a helpful business assistant. Be concise. {lang_instruction}"},
                         {"role": "user", "content": prompt}]
        })
        if resp.ok:
            return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        app.logger.error("Inference failed: %s", e)
    return "I apologize, I'm having trouble right now. Please try again."

@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature against the RAW body before trusting anything.
    raw_body = request.get_data()
    if not verify_telnyx_signature(raw_body, request.headers):
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "No payload"}), 400
    event = payload.get("data", {})
    event_type = event.get("event_type", "")
    ep = event.get("payload", {})
    cc_id = ep.get("call_control_id")
    if not cc_id:
        return jsonify({"error": "Missing call_control_id"}), 400

    if event_type == "call.initiated" and ep.get("direction") == "incoming":
        caller = ep.get("from", "")
        region = detect_region(caller)
        config = REGION_CONFIG.get(region, REGION_CONFIG["DEFAULT"])
        call_sessions[cc_id] = {"region": region, "config": config, "caller": caller, "ts": time.time()}
        ttl_cleanup(call_sessions)
        requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/answer",
                      headers=HEADERS, timeout=10,
                      json={"client_state": encode_state({"region": region, "step": "greeting"})})

    elif event_type == "call.answered":
        state = decode_state(ep.get("client_state", ""))
        region = state.get("region", "DEFAULT")
        config = REGION_CONFIG.get(region, REGION_CONFIG["DEFAULT"])
        session = call_sessions.get(cc_id, {})
        if config["requires_consent"]:
            requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/gather_using_speak",
                          headers=HEADERS, timeout=10,
                          json={"payload": config["greeting"], "voice": config["voice"],
                                "language": config["language"], "minimum_digits": 1, "maximum_digits": 1,
                                "client_state": encode_state({"region": region, "step": "consent"})})
        else:
            if config.get("record"):
                requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/record_start",
                              headers=HEADERS, timeout=10, json={"format": "mp3", "channels": "dual"})
            requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/gather_using_speak",
                          headers=HEADERS, timeout=10,
                          json={"payload": config["greeting"], "voice": config["voice"],
                                "language": config["language"], "input_type": "speech", "timeout_secs": 30,
                                "client_state": encode_state({"region": region, "step": "conversation"})})

    elif event_type == "call.gather.ended":
        state = decode_state(ep.get("client_state", ""))
        region = state.get("region", "DEFAULT")
        config = REGION_CONFIG.get(region, REGION_CONFIG["DEFAULT"])
        step = state.get("step")

        if step == "consent":
            digits = ep.get("digits", "")
            if digits == "1":
                requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/record_start",
                              headers=HEADERS, timeout=10, json={"format": "mp3", "channels": "dual"})
                call_sessions.get(cc_id, {})["consented"] = True
            requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/gather_using_speak",
                          headers=HEADERS, timeout=10,
                          json={"payload": "Thank you. How can I help you today?" if region == "EU" else config["greeting"],
                                "voice": config["voice"], "language": config["language"],
                                "input_type": "speech", "timeout_secs": 30,
                                "client_state": encode_state({"region": region, "step": "conversation"})})
        elif step == "conversation":
            speech = ep.get("speech", {}).get("result", "")
            if speech:
                response = call_inference(speech, config["language"])
                requests.post(f"https://api.telnyx.com/v2/calls/{cc_id}/actions/gather_using_speak",
                              headers=HEADERS, timeout=10,
                              json={"payload": response, "voice": config["voice"],
                                    "language": config["language"], "input_type": "speech", "timeout_secs": 30,
                                    "client_state": encode_state({"region": region, "step": "conversation"})})

    elif event_type == "call.recording.saved":
        recording_url = ep.get("recording_urls", {}).get("mp3")
        session = call_sessions.get(cc_id, {})
        if not (recording_url and is_telnyx_url(recording_url)):
            return jsonify({"status": "ok"})
        if s3 is None:
            app.logger.info("Recording ready at %s but Storage credentials not configured; skipping archival.", recording_url)
            return jsonify({"status": "ok"})
        try:
            audio = requests.get(recording_url, headers=HEADERS, timeout=30).content
            region = session.get("region", "unknown")
            key = f"recordings/{region}/{ep.get('call_session_id', 'unknown')}.mp3"
            s3.put_object(Bucket=STORAGE_BUCKET, Key=key, Body=audio, ContentType="audio/mpeg")
        except Exception as e:
            app.logger.error("Recording archive failed: %s", e)

    elif event_type == "call.hangup":
        call_sessions.pop(cc_id, None)

    return jsonify({"status": "ok"})

@app.route("/regions", methods=["GET"])
def get_regions():
    return jsonify({"regions": {k: {kk: vv for kk, vv in v.items() if kk != "greeting"} for k, v in REGION_CONFIG.items()}})

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "edge-geo-smart-router", "active_calls": len(call_sessions)})

if __name__ == "__main__":
    app.run(host=HOST, port=int(os.getenv("PORT", "5000")), debug=False)
