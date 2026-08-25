"""
Conference Agent Mediator — Telnyx Code Sample (DEV-831)

An AI meeting facilitator that joins Telnyx Call Control conferences,
transcribes speech, mediates turn-taking via an LLM, broadcasts a live
transcript to observers over WebSocket, and sends a post-conference
summary via SMS.

Run:
    pip install -r requirements.txt
    cp .env.example .env  # fill in values
    flask run --port 5000
"""

import os
import json
import time
import uuid
import asyncio
import threading
import collections
from datetime import datetime, timezone

import telnyx
import requests
from flask import Flask, request, jsonify, abort
from dotenv import load_dotenv

load_dotenv()

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY")
TELNYX_CONNECTION_ID = os.getenv("TELNYX_CONNECTION_ID")
TELNYX_FROM_NUMBER = os.getenv("TELNYX_FROM_NUMBER")
TELNYX_TO_NUMBER = os.getenv("TELNYX_TO_NUMBER")  # summary recipient
LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
WEBHOOK_BASE_URL = os.getenv("WEBHOOK_BASE_URL")
WS_OBSERVER_SECRET = os.getenv("WS_OBSERVER_SECRET", "change-me")

telnyx.api_key = TELNYX_API_KEY

# --------------------------------------------------------------------------- #
# Flask app
# --------------------------------------------------------------------------- #

app = Flask(__name__)

# In-memory state (per-process; fine for a sample, use Redis/DB in prod)
# conference_id -> ConferenceAgent
AGENTS: dict[str, "ConferenceAgent"] = {}
# conference_id -> set[queue.Queue]  (one queue per connected WS observer)
OBSERVERS: dict[str, set] = collections.defaultdict(set)


# --------------------------------------------------------------------------- #
# ConferenceAgent — the AI meeting facilitator
# --------------------------------------------------------------------------- #

class ConferenceAgent:
    """
    Stateful agent that joins a Telnyx conference, tracks turn-taking,
    and produces a summary when the conference ends.

    In a production system you'd extend `telnyx.Agent` (or your own base
    class). For this sample we keep it self-contained so the example
    runs without an extra SDK install.
    """

    IDLE_PROMPT_SECONDS = 45  # nudge if a participant hasn't spoken in 45s

    def __init__(self, conference_id: str, call_control_id: str,
                 participant_names: list[str]):
        self.conference_id = conference_id
        self.call_control_id = call_control_id
        self.participant_names = participant_names
        self.transcript: list[dict] = []
        self.last_spoken: dict[str, float] = {}
        self.started_at = time.time()
        self.ended_at: float | None = None
        self.summary: str | None = None
        self._lock = threading.Lock()

    # -- transcript -------------------------------------------------------- #

    def add_utterance(self, speaker: str, text: str):
        ts = datetime.now(timezone.utc).isoformat()
        entry = {"ts": ts, "speaker": speaker, "text": text}
        with self._lock:
            self.transcript.append(entry)
            self.last_spoken[speaker] = time.time()
        self._broadcast(entry)
        self._maybe_mediate()

    def _broadcast(self, entry: dict):
        """Push a transcript event to every connected WS observer."""
        for q in list(OBSERVERS.get(self.conference_id, set())):
            try:
                q.put_nowait(entry)
            except Exception:
                app.logger.exception("Failed to enqueue WS event")

    # -- turn-taking mediation -------------------------------------------- #

    def _maybe_mediate(self):
        """
        If any participant hasn't spoken recently, ask the LLM for a
        short nudge and speak it into the conference via Call Control.
        """
        now = time.time()
        quiet = [
            name for name in self.participant_names
            if now - self.last_spoken.get(name, self.started_at)
            > self.IDLE_PROMPT_SECONDS
        ]
        if not quiet:
            return

        prompt = (
            f"You are a concise meeting facilitator. The following participants "
            f"have been quiet for a while: {', '.join(quiet)}. "
            f"In one short sentence, invite them to share their thoughts. "
            f"No preamble."
        )
        nudge = self._llm_complete(prompt, max_tokens=60)
        if not nudge:
            return
        self.speak(nudge)

    def speak(self, text: str):
        """Play speech into the conference using Call Control speak()."""
        try:
            telnyx.Call.retrieve(self.call_control_id).speak(
                payload=text,
                voice="female",
                language="en-US",
            )
        except Exception:
            app.logger.exception("speak() failed for conference %s",
                                 self.conference_id)

    # -- summary ----------------------------------------------------------- #

    def finalize(self):
        """Called when the conference ends — build summary + send SMS."""
        self.ended_at = time.time()
        if not self.transcript:
            self.summary = "No speech was detected during the conference."
        else:
            self.summary = self._build_summary()
        self._send_summary_sms()

    def _build_summary(self) -> str:
        lines = "\n".join(
            f"{e['ts']} {e['speaker']}: {e['text']}" for e in self.transcript
        )
        prompt = (
            "Summarize the following meeting transcript in 3-5 bullet points, "
            "then list any action items. Be concise.\n\n" + lines
        )
        return self._llm_complete(prompt, max_tokens=400) or "(summary failed)"

    def _llm_complete(self, prompt: str, max_tokens: int = 200) -> str | None:
        if not LLM_API_KEY:
            app.logger.warning("LLM_API_KEY not set; skipping LLM call")
            return None
        try:
            resp = requests.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_API_KEY}"},
                json={
                    "model": LLM_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                },
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            app.logger.exception("LLM completion failed")
            return None

    def _send_summary_sms(self):
        if not (TELNYX_FROM_NUMBER and TELNYX_TO_NUMBER):
            app.logger.warning("SMS numbers not configured; skipping summary SMS")
            return
        try:
            telnyx.Message.create(
                from_=TELNYX_FROM_NUMBER,
                to=TELNYX_TO_NUMBER,
                text=f"Conference summary:\n{self.summary}",
            )
        except Exception:
            app.logger.exception("Failed to send summary SMS")


# --------------------------------------------------------------------------- #
# Webhook signature verification helper
# --------------------------------------------------------------------------- #

def _verify_telnyx_signature() -> dict | None:
    """
    Verify the inbound Telnyx webhook using the Ed25519 signature header
    and return the unwrapped payload, or None on failure.
    """
    try:
        return telnyx.Webhook.unwrap(
            request.data,
            request.headers,
            TELNYX_PUBLIC_KEY,
            tolerance=300,  # 5 min clock skew
        )
    except Exception:
        app.logger.exception("Webhook signature verification failed")
        return None


# --------------------------------------------------------------------------- #
# Routes — control plane
# --------------------------------------------------------------------------- #

@app.post("/conference/start")
def start_conference():
    """
    Create a Telnyx conference, have the agent join it, and return the
    conference id + a WebSocket URL observers can connect to.

    JSON body:
        participants: list[str]  # display names, e.g. ["Alice","Bob"]
    """
    body = request.get_json(silent=True) or {}
    participants = body.get("participants") or []
    if not isinstance(participants, list) or not participants:
        return jsonify(error="`participants` must be a non-empty list"), 400

    try:
        conf = telnyx.Conference.create(
            name=f"agent-mediator-{uuid.uuid4().hex[:8]}",
            call_control_id=TELNYX_CONNECTION_ID,
        )
        conference_id = conf.id

        # Agent dials in and joins the conference
        call = telnyx.Call.create(
            connection_id=TELNYX_CONNECTION_ID,
            to=conf.join_url,
            from_=TELNYX_FROM_NUMBER,
        )
        agent = ConferenceAgent(
            conference_id=conference_id,
            call_control_id=call.id,
            participant_names=participants,
        )
        AGENTS[conference_id] = agent

        ws_url = f"{WEBHOOK_BASE_URL.replace('http','ws')}/transcript/{conference_id}"
        return jsonify(
            conference_id=conference_id,
            call_control_id=call.id,
            observer_ws_url=ws_url,
        ), 201
    except Exception:
        app.logger.exception("Failed to start conference")
        return jsonify(error="Failed to start conference"), 500


@app.post("/webhooks/telnyx")
def telnyx_webhook():
    """
    Inbound Telnyx webhook. Verifies the Ed25519 signature and dispatches
    on event type.
    """
    payload = _verify_telnyx_signature()
    if payload is None:
        return jsonify(error="Invalid signature"), 401

    data = payload.get("data", {})
    event_type = data.get("event_type")
    p = data.get("payload", {})

    try:
        if event_type == "conference.created":
            app.logger.info("Conference created: %s", p.get("conference_id"))

        elif event_type == "conference.participant.joined":
            app.logger.info("Participant joined conference %s",
                            p.get("conference_id"))

        elif event_type == "conference.participant.left":
            app.logger.info("Participant left conference %s",
                            p.get("conference_id"))

        elif event_type == "call.speak.ended":
            app.logger.info("Agent finished speaking in call %s",
                            p.get("call_control_id"))

        elif event_type == "conference.ended":
            conf_id = p.get("conference_id")
            agent = AGENTS.get(conf_id)
            if agent:
                agent.finalize()
                app.logger.info("Conference %s finalized. Summary:\n%s",
                                conf_id, agent.summary)
            else:
                app.logger.warning("conference.ended for unknown conf %s", conf_id)

        # In a real deployment you'd also handle transcription events here
        # (e.g. from a Telnyx Inference binding) and call agent.add_utterance().

    except Exception:
        app.logger.exception("Webhook handler error for event %s", event_type)
        return jsonify(error="Internal error"), 500

    return jsonify(status="ok"), 200


# --------------------------------------------------------------------------- #
# Routes — transcript ingestion (simulated STT feed)
# --------------------------------------------------------------------------- #

@app.post("/conference/<conference_id>/transcript")
def ingest_transcript(conference_id: str):
    """
    Accept a transcript chunk from an external STT provider and feed it
    to the agent. In production this would come from a Telnyx Inference
    binding or a WebSocket STT stream.

    JSON body:
        speaker: str
        text: str
    """
    agent = AGENTS.get(conference_id)
    if agent is None:
        return jsonify(error="Unknown conference"), 404

    body = request.get_json(silent=True) or {}
    speaker = body.get("speaker")
    text = body.get("text")
    if not speaker or not text:
        return jsonify(error="`speaker` and `text` are required"), 400

    agent.add_utterance(speaker, text)
    return jsonify(status="ok"), 200


# --------------------------------------------------------------------------- #
# Routes — summary
# --------------------------------------------------------------------------- #

@app.get("/conference/<conference_id>/summary")
def get_summary(conference_id: str):
    agent = AGENTS.get(conference_id)
    if agent is None:
        return jsonify(error="Unknown conference"), 404
    return jsonify(
        conference_id=conference_id,
        started_at=agent.started_at,
        ended_at=agent.ended_at,
        summary=agent.summary,
        transcript=agent.transcript,
    )


# --------------------------------------------------------------------------- #
# WebSocket — live transcript for observers
# --------------------------------------------------------------------------- #

# We implement a minimal WebSocket endpoint without extra deps by using
# a long-poll SSE fallback. For a true WS server, pair this app with
# `websockets` or `flask-sock`. The shape below keeps the sample dependency-
# light while demonstrating the observer pattern.

@app.get("/conference/<conference_id>/stream")
def transcript_stream(conference_id: str):
    """
    Server-Sent Events stream of live transcript events for observers.
    A real deployment would use a WebSocket; SSE keeps this sample
    dependency-light while preserving the same observer semantics.
    """
    agent = AGENTS.get(conference_id)
    if agent is None:
        return jsonify(error="Unknown conference"), 404

    import queue
    q: queue.Queue = queue.Queue()
    OBSERVERS[conference_id].add(q)

    def generate():
        try:
            # replay existing transcript
            for entry in list(agent.transcript):
                yield f"data: {json.dumps(entry)}\n\n"
            # stream new events
            while True:
                entry = q.get(timeout=30)
                yield f"data: {json.dumps(entry)}\n\n"
        except Exception:
            app.logger.exception("SSE stream error")
        finally:
            OBSERVERS[conference_id].discard(q)

    return app.response_class(generate(), mimetype="text/event-stream")


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #

@app.get("/health")
def health():
    return jsonify(status="ok", active_conferences=len(AGENTS))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
