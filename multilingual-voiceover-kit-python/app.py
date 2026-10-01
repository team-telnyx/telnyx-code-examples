#!/usr/bin/env python3
"""Multilingual Voice-Over Kit — submit a script in one language, AI translates
to multiple target languages preserving tone and timing, TTS renders each
language with native-sounding voices. Batch localization pipeline."""

import os, json, uuid, requests
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time

load_dotenv()
app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
BUCKET_NAME = os.getenv("BUCKET_NAME", "voiceovers")
API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

# Telnyx Cloud Storage is S3-compatible. Talk to it with the AWS SDK (boto3) pointed
# at the region-scoped Telnyx endpoint, using the Telnyx API key as BOTH access key
# and secret key. Region selects the endpoint host, e.g. us-central-1.
REGION = os.getenv("TELNYX_STORAGE_REGION", "us-central-1")
PRESIGN_TTL = int(os.getenv("PRESIGN_TTL_SECONDS", "3600"))
s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{REGION}.telnyxcloudstorage.com",
    aws_access_key_id=TELNYX_API_KEY,
    aws_secret_access_key=TELNYX_API_KEY,
    region_name=REGION,
    config=Config(signature_version="s3v4"),
)

LANGUAGE_VOICES = {
    "en": {"name": "English", "voice": "Telnyx.KokoroTTS.af_nova"},
    "es": {"name": "Spanish", "voice": "Telnyx.KokoroTTS.af_nova"},
    "fr": {"name": "French", "voice": "Telnyx.KokoroTTS.af_nova"},
    "de": {"name": "German", "voice": "Telnyx.KokoroTTS.am_onyx"},
    "pt": {"name": "Portuguese", "voice": "Telnyx.KokoroTTS.af_nova"},
    "ja": {"name": "Japanese", "voice": "Telnyx.KokoroTTS.af_nova"},
    "ko": {"name": "Korean", "voice": "Telnyx.KokoroTTS.af_nova"},
    "zh": {"name": "Chinese", "voice": "Telnyx.KokoroTTS.af_nova"},
    "it": {"name": "Italian", "voice": "Telnyx.KokoroTTS.af_nova"},
    "ar": {"name": "Arabic", "voice": "Telnyx.KokoroTTS.am_onyx"},
    "hi": {"name": "Hindi", "voice": "Telnyx.KokoroTTS.af_nova"},
    "nl": {"name": "Dutch", "voice": "Telnyx.KokoroTTS.am_echo"},
    "sv": {"name": "Swedish", "voice": "Telnyx.KokoroTTS.am_echo"},
    "pl": {"name": "Polish", "voice": "Telnyx.KokoroTTS.af_nova"},
    "tr": {"name": "Turkish", "voice": "Telnyx.KokoroTTS.am_onyx"},
}

kits = {}

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

_start_ttl_cleanup(kits)



def inference(messages, max_tokens=2000):
    resp = requests.post(f"{API}/ai/chat/completions", headers=HEADERS, json={
        "model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3
    }, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def tts_generate(text, voice="Telnyx.KokoroTTS.af_nova", language="en"):
    resp = requests.post(f"{API}/text-to-speech/speech", headers=HEADERS, json={
        "voice": voice, "text": text,
        "language": language
    }, timeout=60)
    resp.raise_for_status()
    return resp.content


def upload_to_storage(key, data, content_type="audio/mpeg"):
    """Store bytes on Telnyx Cloud Storage (S3-compatible) and return a presigned
    GET URL that stays valid for PRESIGN_TTL seconds."""
    try:
        s3.put_object(Bucket=BUCKET_NAME, Key=key, Body=data, ContentType=content_type)
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": key},
            ExpiresIn=PRESIGN_TTL,
        )
    except ClientError:
        app.logger.exception("Cloud Storage upload failed for key %s", key)
        raise


@app.route("/kits/create", methods=["POST"])
def create_kit():
    """Create a multilingual voice-over kit.

    Submit a script in source language, specify target languages.
    AI translates preserving tone and timing, TTS renders each.
    """
    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    script = data.get("script", "")
    source_lang = data.get("source_language", "en")
    target_langs = data.get("target_languages", ["es", "fr", "de", "ja"])
    project_name = data.get("project", "Untitled Project")
    style = data.get("style", "neutral")

    if not script:
        return jsonify({"error": "Provide 'script' text"}), 400

    invalid = [l for l in target_langs if l not in LANGUAGE_VOICES]
    if invalid:
        return jsonify({"error": f"Unsupported languages: {invalid}", "supported": list(LANGUAGE_VOICES.keys())}), 400

    kit_id = f"kit-{uuid.uuid4().hex[:8]}"
    kits[kit_id] = {
        "id": kit_id, "project": project_name, "status": "translating",
        "source_language": source_lang, "original_script": script,
        "languages": {}, "created_at": datetime.utcnow().isoformat()
    }

    # Include source language render
    all_langs = [source_lang] + [l for l in target_langs if l != source_lang]

    for lang in all_langs:
        lang_cfg = LANGUAGE_VOICES.get(lang, LANGUAGE_VOICES["en"])
        lang_result = {
            "language": lang,
            "language_name": lang_cfg["name"],
            "voice": lang_cfg["voice"],
            "status": "pending"
        }

        # Translate if not source language
        if lang == source_lang:
            translated_script = script
            lang_result["script"] = script
        else:
            try:
                source_name = LANGUAGE_VOICES.get(source_lang, {}).get("name", source_lang)
                translated_script = inference([
                    {"role": "system", "content": f"""Translate this voice-over script from {source_name} to {lang_cfg['name']}.

Preserve:
- The exact tone and style ({style})
- Approximate timing (similar word count and pacing)
- All brand names, product names, and technical terms unchanged
- Natural spoken language (this will be read aloud)

Return ONLY the translated script."""},
                    {"role": "user", "content": script}
                ])
                lang_result["script"] = translated_script.strip()
                lang_result["status"] = "translated"
            except Exception as e:
                app.logger.exception("Translation failed for language %s", lang)
                lang_result["status"] = "translation_failed"
                lang_result["error"] = "translation failed"
                kits[kit_id]["languages"][lang] = lang_result
                continue

        # TTS render
        try:
            audio = tts_generate(translated_script, voice=lang_cfg["voice"], language=lang)
            lang_result["audio_bytes"] = len(audio)
            lang_result["word_count"] = len(translated_script.split())

            try:
                key = f"{kit_id}/{lang}.mp3"
                url = upload_to_storage(key, audio)
                lang_result["storage_url"] = url
            except Exception as e:
                app.logger.exception("Storage upload failed for language %s", lang)
                lang_result["storage_error"] = "storage upload failed"

            lang_result["status"] = "complete"
        except Exception as e:
            app.logger.exception("TTS render failed for language %s", lang)
            lang_result["status"] = "tts_failed"
            lang_result["error"] = "tts render failed"

        kits[kit_id]["languages"][lang] = lang_result

    # Upload manifest
    try:
        manifest = {
            "kit_id": kit_id, "project": project_name,
            "source": source_lang, "languages": list(kits[kit_id]["languages"].keys()),
            "files": {l: f"{l}.mp3" for l, d in kits[kit_id]["languages"].items() if d["status"] == "complete"}
        }
        upload_to_storage(f"{kit_id}/manifest.json", json.dumps(manifest, indent=2).encode(), "application/json")
    except Exception:
        pass

    kits[kit_id]["status"] = "complete"
    kits[kit_id]["completed_at"] = datetime.utcnow().isoformat()

    complete_count = sum(1 for l in kits[kit_id]["languages"].values() if l["status"] == "complete")

    return jsonify({
        "kit_id": kit_id,
        "project": project_name,
        "status": "complete",
        "languages_rendered": complete_count,
        "languages_total": len(all_langs),
        "languages": {l: {"name": d["language_name"], "status": d["status"], "word_count": d.get("word_count", 0)}
                      for l, d in kits[kit_id]["languages"].items()}
    }), 201


@app.route("/kits/<kit_id>", methods=["GET"])
def get_kit(kit_id):
    kit = kits.get(kit_id)
    if not kit:
        return jsonify({"error": "Kit not found"}), 404
    return jsonify(kit)


@app.route("/kits/<kit_id>/add-language", methods=["POST"])
def add_language(kit_id):
    """Add another language to an existing kit."""
    kit = kits.get(kit_id)
    if not kit:
        return jsonify({"error": "Kit not found"}), 404

    data = request.get_json() or {}
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    lang = data.get("language")
    if not lang or lang not in LANGUAGE_VOICES:
        return jsonify({"error": "Provide valid 'language' code", "supported": list(LANGUAGE_VOICES.keys())}), 400

    if lang in kit["languages"]:
        return jsonify({"error": f"{lang} already in kit"}), 400

    lang_cfg = LANGUAGE_VOICES[lang]
    source_name = LANGUAGE_VOICES.get(kit["source_language"], {}).get("name", "English")

    try:
        translated = inference([
            {"role": "system", "content": f"Translate this voice-over from {source_name} to {lang_cfg['name']}. Preserve tone and timing. Return only the translation."},
            {"role": "user", "content": kit["original_script"]}
        ])
        audio = tts_generate(translated.strip(), voice=lang_cfg["voice"], language=lang)
        result = {
            "language": lang, "language_name": lang_cfg["name"],
            "voice": lang_cfg["voice"], "script": translated.strip(),
            "audio_bytes": len(audio), "word_count": len(translated.split()),
            "status": "complete"
        }
        try:
            url = upload_to_storage(f"{kit_id}/{lang}.mp3", audio)
            result["storage_url"] = url
        except Exception:
            pass

        kit["languages"][lang] = result
        return jsonify(result), 201
    except Exception as e:
        app.logger.exception("Failed to add language %s to kit %s", lang, kit_id)
        return jsonify({"error": "internal error"}), 500


@app.route("/kits", methods=["GET"])
def list_kits():
    return jsonify({"kits": [{
        "id": k["id"], "project": k["project"], "status": k["status"],
        "languages": len(k["languages"]), "created_at": k["created_at"]
    } for k in kits.values()]})


@app.route("/languages", methods=["GET"])
def list_languages():
    return jsonify({"languages": {k: v["name"] for k, v in LANGUAGE_VOICES.items()}})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "total_kits": len(kits), "supported_languages": len(LANGUAGE_VOICES), "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
