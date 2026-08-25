import os
import io
import json
import logging
import requests
from datetime import datetime

import telnyx
from flask import Flask, request, jsonify, abort
from dotenv import load_dotenv

load_dotenv()

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_APP_NAME = os.getenv("TELNYX_APP_NAME", "voicemail-to-sms-agent")
TELNYX_STORAGE_BUCKET = os.getenv("TELNYX_STORAGE_BUCKET")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER")
TELNYX_TO_NUMBER = os.getenv("TELNYX_TO_NUMBER")

telnyx.api_key = TELNYX_API_KEY

app = Flask(__name__)
app.logger.setLevel(logging.INFO)


class VoicemailAgent:
    """
    Minimal "Agent" abstraction mirroring the Telnyx Agent SDK shape:
    `onTask()` is invoked with a voicemail event payload and orchestrates
    download -> STT -> summarize -> SMS -> archive.
    """

    def __init__(self, env):
        self.env = env

    def onTask(self, payload):
        call_control_id = payload.get("call_control_id")
        call_session_id = payload.get("call_session_id")
        recording_url = payload.get("recording_urls", [None])[0]
        caller_number = payload.get("from", "unknown")

        if not recording_url:
            app.logger.warning(
                "No recording URL present for call_control_id=%s", call_control_id
            )
            return {"status": "no_recording"}

        app.logger.info(
            "VoicemailAgent.onTask start call_control_id=%s caller=%s",
            call_control_id,
            caller_number,
        )

        audio_bytes = self._download_audio(recording_url, call_control_id)
        transcript = self._transcribe(audio_bytes, call_control_id)
        summary = self._summarize(transcript, caller_number)
        self._send_sms(summary)
        self._archive_audio(audio_bytes, call_control_id, call_session_id)

        return {
            "status": "ok",
            "transcript_length": len(transcript),
            "summary_length": len(summary),
        }

    def _download_audio(self, url, call_control_id):
        app.logger.info("Downloading voicemail audio url=%s", url)
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        app.logger.info(
            "Downloaded audio bytes=%s call_control_id=%s",
            len(resp.content),
            call_control_id,
        )
        return resp.content

    def _transcribe(self, audio_bytes, call_control_id):
        """
        Transcribe voicemail audio via Telnyx AI Inference binding.
        Uses the OpenAI-compatible Whisper-style transcription endpoint.
        """
        app.logger.info("Starting STT call_control_id=%s", call_control_id)
        try:
            transcript = telnyx.ai.openai.audio.create_transcription(
                file=("voicemail.wav", io.BytesIO(audio_bytes), "audio/wav"),
                model="whisper-1",
            )
            text = transcript.get("text", "") if isinstance(transcript, dict) else str(transcript)
            app.logger.info(
                "STT complete call_control_id=%s transcript_len=%s",
                call_control_id,
                len(text),
            )
            return text
        except Exception:
            app.logger.exception("STT failed call_control_id=%s", call_control_id)
            return ""

    def _summarize(self, transcript, caller_number):
        """
        Summarize the transcript via Telnyx AI Inference binding
        (OpenAI-compatible chat completions).
        """
        app.logger.info("Summarizing transcript caller=%s", caller_number)
        if not transcript.strip():
            return f"New voicemail from {caller_number}. (Transcription unavailable.)"

        system_prompt = (
            "You are a concise voicemail assistant. Summarize the voicemail in 1-2 "
            "sentences. Include the caller's intent and any callback number if mentioned. "
            "Keep it under 320 characters so it fits in an SMS."
        )
        user_prompt = f"Voicemail transcript:\n\n{transcript}\n\nCaller: {caller_number}"

        try:
            completion = telnyx.ai.openai.chat.create_completion(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=160,
                temperature=0.3,
            )
            summary = (
                completion.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
            )
            if not summary:
                summary = f"New voicemail from {caller_number}."
            app.logger.info("Summary generated len=%s", len(summary))
            return summary
        except Exception:
            app.logger.exception("LLM summarization failed")
            return f"New voicemail from {caller_number}. (Summary unavailable.)"

    def _send_sms(self, summary):
        """
        Send the summary via the Telnyx Messaging binding.
        """
        to = self.env.get("TELNYX_TO_NUMBER")
        from_ = self.env.get("TELNYX_FROM_NUMBER")
        if not to or not from_:
            app.logger.error("SMS env vars missing: TELNYX_FROM_NUMBER / TELNYX_TO_NUMBER")
            return

        app.logger.info("Sending SMS summary to=%s from=%s", to, from_)
        try:
            telnyx.Message.create(
                from_=from_,
                to=to,
                text=f"Voicemail summary: {summary}",
            )
            app.logger.info("SMS sent successfully")
        except Exception:
            app.logger.exception("SMS send failed")

    def _archive_audio(self, audio_bytes, call_control_id, call_session_id):
        """
        Archive voicemail audio to Telnyx Cloud Storage.
        """
        bucket = self.env.get("TELNYX_STORAGE_BUCKET")
        if not bucket:
            app.logger.warning("TELNYX_STORAGE_BUCKET not set; skipping archive")
            return

        timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        object_key = f"voicemails/{timestamp}_{call_control_id}.wav"

        app.logger.info(
            "Archiving audio bucket=%s key=%s bytes=%s",
            bucket,
            object_key,
            len(audio_bytes),
        )
        try:
            telnyx.storage.object.create(
                bucket=bucket,
                key=object_key,
                body=audio_bytes,
                content_type="audio/wav",
                metadata={
                    "call_control_id": call_control_id,
                    "call_session_id": call_session_id or "",
                    "app": self.env.get("TELNYX_APP_NAME", "voicemail-to-sms-agent"),
                },
            )
            app.logger.info("Audio archived key=%s", object_key)
        except Exception:
            app.logger.exception("Cloud Storage archive failed")


agent = VoicemailAgent(
    env={
        "TELNYX_API_KEY": TELNYX_API_KEY,
        "TELNYX_FROM_NUMBER": TELNYX_FROM_NUMBER,
        "TELNYX_TO_NUMBER": TELNYX_TO_NUMBER,
        "TELNYX_STORAGE_BUCKET": TELNYX_STORAGE_BUCKET,
        "TELNYX_APP_NAME": TELNYX_APP_NAME,
    }
)


def verify_webhook(raw_body, signature_header):
    """
    Verify the Telnyx Ed25519 webhook signature.
    Returns the unwrapped event dict, or None if verification fails.
    """
    try:
        event = telnyx.Webhook.construct_event(
            raw_body,
            signature_header,
            TELNYX_PUBLIC_KEY,
        )
        return event
    except Exception:
        app.logger.exception("Webhook signature verification failed")
        return None


@app.post("/webhooks/voicemail")
def voicemail_webhook():
    raw_body = request.get_data()
    signature = request.headers.get("telnyx-signature-ed25519", "")

    event = verify_webhook(raw_body, signature)
    if event is None:
        app.logger.warning("Unauthorized webhook attempt")
        abort(401)

    payload = event.get("data", {}).get("payload", {})
    event_type = event.get("data", {}).get("event_type", "")

    app.logger.info("Webhook received event_type=%s", event_type)

    if event_type != "call.status" or payload.get("status") != "voicemail":
        app.logger.info("Ignoring non-voicemail event_type=%s status=%s",
                        event_type, payload.get("status"))
        return jsonify({"status": "ignored"}), 200

    try:
        result = agent.onTask(payload)
        return jsonify({"status": "processed", "result": result}), 200
    except Exception:
        app.logger.exception("Agent onTask failed")
        return jsonify({"error": "Internal error processing voicemail"}), 500


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "voicemail-to-sms-agent"}), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
