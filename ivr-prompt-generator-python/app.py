#!/usr/bin/env python3
"""IVR Prompt Generator — generate professional IVR/phone system prompts.
AI writes caller-friendly scripts from business descriptions, TTS renders
in multiple voices, test via live Telnyx call playback."""

import os, json, base64, uuid, requests, telnyx
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
MAIN_NUMBER = os.getenv("MAIN_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BUCKET_NAME = os.getenv("BUCKET_NAME", "ivr-prompts")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Telnyx Cloud Storage is S3-compatible, so we talk to it with the AWS SDK (boto3)
# pointed at the region-scoped Telnyx S3 endpoint — not a REST API. The Telnyx API key
# is supplied as BOTH the access key and the secret key.
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)

PROMPT_TYPES = {
    "greeting": "Main greeting when caller first connects",
    "menu": "Press 1 for X, Press 2 for Y options menu",
    "hold": "On-hold message with wait time estimate",
    "voicemail": "After-hours voicemail greeting",
    "transfer": "Please hold while we transfer your call",
    "closed": "We're currently closed, our hours are...",
    "holiday": "Holiday closure announcement",
    "queue": "All agents are busy, your call is important...",
}

prompt_sets = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(prompt_sets)



def inference(messages, max_tokens=2000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.5
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def tts_generate(text, voice="Telnyx.KokoroTTS.af_nova"):
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice, "text": text
    }, timeout=30)
    resp.raise_for_status()
    return resp.content


def telnyx_post(path, payload):
    resp = requests.post(f"{API}/{path}", headers=HEADERS, json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json()


def upload_to_storage(key, data, content_type="audio/mpeg"):
    """Upload bytes to the S3-compatible Telnyx Cloud Storage bucket and return a
    time-limited presigned GET URL the caller can hand to a call flow."""
    try:
        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=data, ContentType=content_type)
        return s3.generate_presigned_url(
            "get_object", Params={"Bucket": BUCKET_NAME, "Key": key}, ExpiresIn=3600
        )
    except ClientError:
        app.logger.exception("Cloud Storage upload failed for key %s", key)
        raise


@app.route("/prompts/generate", methods=["POST"])
def generate_prompts():
    """Generate a full IVR prompt set for a business.

    AI writes caller-friendly scripts, TTS renders each prompt.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    business_name = data.get("business_name", "")
    business_type = data.get("business_type", "")
    hours = data.get("hours", "Monday-Friday 9am-5pm")
    departments = data.get("departments", ["Sales", "Support", "Billing"])
    voice = data.get("voice", "Telnyx.KokoroTTS.af_nova")
    prompt_types = data.get("prompt_types", list(PROMPT_TYPES.keys()))

    if not business_name:
        return jsonify({"error": "Provide 'business_name'"}), 400

    set_id = f"ivr-{uuid.uuid4().hex[:8]}"
    prompt_sets[set_id] = {
        "id": set_id, "business": business_name, "status": "writing",
        "prompts": [], "created_at": datetime.utcnow().isoformat()
    }

    # Step 1: AI writes all prompts
    try:
        dept_list = ", ".join(departments)
        prompts_raw = inference([
            {"role": "system", "content": f"""Write professional IVR phone prompts for a business.

Business: {business_name} ({business_type})
Hours: {hours}
Departments: {dept_list}

For each prompt type, return JSON array with objects:
- "type": the prompt type
- "script": the exact words to speak (natural, professional, concise)
- "estimated_seconds": how long it takes to speak

Guidelines:
- Warm but efficient — callers hate long prompts
- Greeting under 10 seconds
- Menu options: keep to 4-5 max, most popular first
- Hold messages: acknowledge the wait, give useful info
- Always offer a callback or voicemail escape

Write these prompt types: {', '.join(prompt_types)}"""},
            {"role": "user", "content": f"Generate IVR prompts for {business_name}"}
        ])
        prompts = json.loads(prompts_raw)
    except json.JSONDecodeError:
        prompts = [{"type": "greeting", "script": prompts_raw[:200], "estimated_seconds": 8}]
    except Exception as e:
        app.logger.exception("Prompt generation failed for set %s", set_id)
        prompt_sets[set_id]["status"] = "failed"
        prompt_sets[set_id]["error"] = "prompt generation failed"
        return jsonify(prompt_sets[set_id]), 500

    # Step 2: TTS render each prompt
    prompt_sets[set_id]["status"] = "rendering"
    for prompt_data in prompts:
        script = prompt_data.get("script", "")
        try:
            audio = tts_generate(script, voice=voice)
            result = {
                "type": prompt_data.get("type", "unknown"),
                "script": script,
                "voice": voice,
                "audio_bytes": len(audio),
                "estimated_seconds": prompt_data.get("estimated_seconds", 0)
            }
            try:
                key = f"{set_id}/{prompt_data['type']}.mp3"
                url = upload_to_storage(key, audio)
                result["storage_url"] = url
            except Exception as e:
                app.logger.exception("Storage upload failed for set %s", set_id)
                result["storage_error"] = "audio storage failed"

            prompt_sets[set_id]["prompts"].append(result)
        except Exception as e:
            app.logger.exception("TTS rendering failed for set %s", set_id)
            prompt_sets[set_id]["prompts"].append({
                "type": prompt_data.get("type"), "error": "prompt rendering failed"
            })

    prompt_sets[set_id]["status"] = "complete"
    prompt_sets[set_id]["completed_at"] = datetime.utcnow().isoformat()

    return jsonify({
        "set_id": set_id,
        "business": business_name,
        "prompts_generated": len(prompt_sets[set_id]["prompts"]),
        "voice": voice,
        "prompts": [{
            "type": p["type"],
            "script": p.get("script", "")[:100] + "..." if len(p.get("script", "")) > 100 else p.get("script", ""),
            "seconds": p.get("estimated_seconds", 0)
        } for p in prompt_sets[set_id]["prompts"] if "audio_bytes" in p]
    }), 201


@app.route("/prompts/<set_id>/preview", methods=["POST"])
def preview_prompt(set_id):
    """Call a phone number and play a specific prompt for live preview."""
    prompt_set = prompt_sets.get(set_id)
    if not prompt_set:
        return jsonify({"error": "Prompt set not found"}), 404

    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    phone = data.get("phone", "")
    prompt_type = data.get("type", "greeting")

    if not phone:
        return jsonify({"error": "Provide 'phone' to call"}), 400

    prompt = None
    for p in prompt_set["prompts"]:
        if p.get("type") == prompt_type:
            prompt = p
            break

    if not prompt:
        return jsonify({"error": f"Prompt type '{prompt_type}' not found in this set"}), 404

    try:
        result = telnyx_post("calls", {
            "connection_id": CONNECTION_ID,
            "to": phone,
            "from": MAIN_NUMBER,
            "client_state": base64.b64encode(json.dumps({
                "action": "preview",
                "set_id": set_id,
                "script": prompt["script"]
            }).encode()).decode()
        })
        return jsonify({
            "status": "calling",
            "phone": phone,
            "prompt_type": prompt_type,
            "script": prompt["script"],
            "call_id": result.get("data", {}).get("call_control_id")
        })
    except Exception as e:
        app.logger.exception("Live preview call failed for set %s", set_id)
        return jsonify({"error": "could not place preview call"}), 500


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
    event = payload.get("data", {})
    event_type = event.get("event_type", "")
    ep = event.get("payload", {})
    call_id = ep.get("call_control_id", "")

    if event_type == "call.answered":
        client_state = {}
        try:
            raw = ep.get("client_state", "")
            if raw:
                client_state = json.loads(base64.b64decode(raw))
        except Exception:
            pass

        if client_state.get("action") == "preview":
            script = client_state.get("script", "This is a test prompt.")
            try:
                telnyx_post(f"calls/{call_id}/actions/speak", {
                    "payload": script,
                    "voice": "Telnyx.KokoroTTS.af_nova",
                    "language": "en-US"
                })
            except Exception:
                pass

    elif event_type == "call.speak.ended":
        try:
            telnyx_post(f"calls/{call_id}/actions/hangup", {})
        except Exception:
            pass

    return jsonify({"status": "ok"}), 200


@app.route("/prompts/<set_id>", methods=["GET"])
def get_prompt_set(set_id):
    ps = prompt_sets.get(set_id)
    if not ps:
        return jsonify({"error": "Not found"}), 404
    return jsonify(ps)


@app.route("/prompt-types", methods=["GET"])
def get_prompt_types():
    return jsonify({"types": PROMPT_TYPES})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_sets": len(prompt_sets), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
