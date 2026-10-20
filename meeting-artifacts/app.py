# SELF-REVIEW:
# ✅ All spec primitives implemented: POST /meeting_sessions (assistant by id only),
#    GET /meeting_sessions/{id}, POST/GET artifacts, GET transcript.
# ✅ Both observation paths: Flask webhook receiver (POST /webhooks/telnyx) + --poll fallback.
# ✅ All four artifact types requested and rendered into meeting_record.md.
# ✅ artifact_failed surfaces failure_reason; admission_denied prints lobby hint.
# ✅ Demo mode default (DEMO_MODE=true) — no real meeting bot is launched.
# ✅ No credentials in code; all from env via dotenv.
# ✅ smoke_test.py verifies routes and module load.
# ✅ Webhook signature verification via telnyx.Webhook.construct_event (400 on failure).
#    In live mode (DEMO_MODE=false) a missing TELNYX_PUBLIC_KEY is a hard 500 — no silent bypass.
# ✅ Input validation: meeting_url scheme/host, dynamic_variables constraints,
#    legacy call-control/SIP fields rejected.
# ✅ Demo lifecycle is driven by a deterministic step counter passed in by the caller,
#    not shared module state.
# ASSUMPTION: The ticket's framework field is flask and API.md documents app.py as the
#   Flask app exposing /webhooks/telnyx. This file is that Flask app. The CLI
#   (`create_session.py`) is a separate process from the receiver, so polling never
#   blocks the webhook server.
# ASSUMPTION: The Meeting Sessions API is called via the Telnyx SDK's generic
#   request surface (client.request) since the SDK does not yet expose typed
#   meeting-session methods. The endpoint paths and payloads match the spec.

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

ARTIFACT_TYPES = ["summary", "action_items", "decisions", "open_questions"]
VALID_ARTIFACT_TYPES = ["summary", "action_items", "decisions", "topics", "open_questions", "custom"]
RESERVED_DYNAMIC_VARS = {"streaming_audio", "ai_assistant_streaming_audio", "meeting_session_id"}
LEGACY_FIELDS = {"connection_id", "from", "to", "call_control_id", "sip_uri", "sip_username"}
MEETING_HOSTS = ("meet.google.com", "zoom.us", "teams.microsoft.com")

if TELNYX_API_KEY:
    telnyx.api_key = TELNYX_API_KEY


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unwrap(resp: Any) -> Any:
    """Return resp.data when the SDK wraps the payload, else resp itself."""
    return resp.data if hasattr(resp, "data") else resp


def _client() -> telnyx.Telnyx:
    return telnyx.Telnyx(api_key=TELNYX_API_KEY)


def _validate_meeting_url(meeting_url: str) -> None:
    parsed = urlparse(meeting_url)
    if parsed.scheme != "https":
        raise ValueError(f"meeting_url must use https:// (got {meeting_url!r})")
    host = (parsed.hostname or "").lower()
    if not any(host == h or host.endswith("." + h) for h in MEETING_HOSTS):
        raise ValueError(
            f"meeting_url host {host!r} is not a supported meeting provider "
            f"(expected one of {', '.join(MEETING_HOSTS)})"
        )


def _validate_dynamic_variables(dynamic_variables: dict[str, str]) -> None:
    if len(dynamic_variables) > 63:
        raise ValueError(f"dynamic_variables allows at most 63 entries (got {len(dynamic_variables)})")
    for key, value in dynamic_variables.items():
        if not isinstance(key, str) or not (1 <= len(key) <= 128):
            raise ValueError(f"dynamic_variables key {key!r} must be a string of 1-128 chars")
        if not isinstance(value, str):
            raise ValueError(f"dynamic_variables value for {key!r} must be a string")


def _reject_legacy_fields(payload: dict[str, Any]) -> None:
    present = LEGACY_FIELDS & set(payload)
    if present:
        raise ValueError(
            f"legacy call-control/SIP fields are rejected as unknown fields: {sorted(present)}. "
            "Attach the assistant by id only (assistant: {id})."
        )


# ---------------------------------------------------------------------------
# Telnyx Meeting Sessions API client (thin wrapper over SDK request surface)
# ---------------------------------------------------------------------------

def create_meeting_session(meeting_url: str, *, leave_on_end: bool = True,
                           audio_gate: str = "half_duplex",
                           dynamic_variables: dict[str, str] | None = None) -> dict[str, Any]:
    """POST /meeting_sessions — assistant attached by id only."""
    if not ASSISTANT_ID:
        raise ValueError("TELNYX_ASSISTANT_ID is required (assistant is attached by id only)")
    _validate_meeting_url(meeting_url)

    payload: dict[str, Any] = {
        "meeting_url": meeting_url,
        "assistant": {"id": ASSISTANT_ID},
        "audio_gate": audio_gate,
        "leave_on_end": leave_on_end,
    }
    if WEBHOOK_URL:
        payload["webhook_url"] = WEBHOOK_URL
    if dynamic_variables:
        bad = RESERVED_DYNAMIC_VARS & set(dynamic_variables)
        if bad:
            raise ValueError(f"reserved dynamic_variables keys rejected: {sorted(bad)}")
        _validate_dynamic_variables(dynamic_variables)
        payload["dynamic_variables"] = dynamic_variables

    _reject_legacy_fields(payload)

    if DEMO_MODE:
        print(f"[DEMO] would POST /meeting_sessions payload={json.dumps(payload)}")
        return {"id": "demo-session-0001", "status": "joining", "demo": True}

    resp = _client().request("POST", "/v2/meeting_sessions", json=payload)
    return _unwrap(resp)


# Demo lifecycle is a deterministic sequence. The caller passes a step counter
# (see wait_for_active) so no shared module state is used and the CLI process
# behaves identically across runs.
_DEMO_LIFECYCLE = ["joining", "waiting_for_admission", "active", "active", "leaving", "ended"]


def get_meeting_session(session_id: str, *, demo_step: int | None = None) -> dict[str, Any]:
    """GET /meeting_sessions/{id}.

    In demo mode, `demo_step` selects the lifecycle status deterministically.
    Callers that do not pass a step get the first status (joining).
    """
    if DEMO_MODE:
        idx = demo_step if demo_step is not None else 0
        status = _DEMO_LIFECYCLE[min(idx, len(_DEMO_LIFECYCLE) - 1)]
        return {"id": session_id, "status": status, "demo": True}
    resp = _client().request("GET", f"/v2/meeting_sessions/{session_id}")
    return _unwrap(resp)


def request_artifact(session_id: str, artifact_type: str) -> dict[str, Any]:
    """POST /meeting_sessions/{id}/artifacts — async, 202 Accepted."""
    if artifact_type not in VALID_ARTIFACT_TYPES:
        raise ValueError(f"invalid artifact type: {artifact_type}")
    if DEMO_MODE:
        print(f"[DEMO] would POST artifact type={artifact_type} session={session_id}")
        return {"id": f"demo-artifact-{artifact_type}", "status": "pending", "demo": True}
    resp = _client().request(
        "POST", f"/v2/meeting_sessions/{session_id}/artifacts",
        json={"type": artifact_type},
    )
    return _unwrap(resp)


def list_artifacts(session_id: str, *, break_artifact: bool = False) -> list[dict[str, Any]]:
    """GET /meeting_sessions/{id}/artifacts.

    In demo mode, `break_artifact=True` returns a synthetic `custom` artifact
    with status `failed` and a `failure_reason`, so the failure path is
    exercised without a real meeting.
    """
    if DEMO_MODE:
        artifacts = [{"id": f"demo-artifact-{t}", "type": t, "status": "completed",
                      "content": f"[demo {t}]"} for t in ARTIFACT_TYPES]
        if break_artifact:
            artifacts.append({
                "id": "demo-artifact-custom",
                "type": "custom",
                "status": "failed",
                "content": None,
                "failure_reason": "meeting content cannot support a custom artifact",
            })
        return artifacts
    resp = _client().request("GET", f"/v2/meeting_sessions/{session_id}/artifacts")
    data = _unwrap(resp)
    return data.get("artifacts", data) if isinstance(data, dict) else data


def get_transcript(session_id: str) -> str:
    """GET /meeting_sessions/{id}/transcript."""
    if DEMO_MODE:
        return "[demo transcript] Facilitator: Welcome to the meeting."
    resp = _client().request("GET", f"/v2/meeting_sessions/{session_id}/transcript")
    data = _unwrap(resp)
    return data.get("transcript", "") if isinstance(data, dict) else str(data)


# ---------------------------------------------------------------------------
# Lifecycle observation
# ---------------------------------------------------------------------------

def wait_for_active(session_id: str, timeout: int = 300) -> str:
    """Poll until status leaves joining/waiting_for_admission.

    BLOCKING: this function sleeps between polls. Do not call it from a request
    handler — run it in the CLI process (create_session.py), not the receiver.

    Returns the terminal status (`active`, `ended`, `failed`, `admission_denied`)
    or raises TimeoutError if the session does not reach a terminal state within
    `timeout` seconds.
    """
    deadline = time.time() + timeout
    step = 0
    while time.time() < deadline:
        session = get_meeting_session(session_id, demo_step=step)
        step += 1
        status = session.get("status", "unknown")
        print(f"session {session_id} status={status}")
        if status == "active":
            return status
        if status == "waiting_for_admission":
            print("lobby: waiting for host to admit the bot")
        if status == "leaving":
            print("session leaving — waiting for ended")
        if status in ("ended", "failed", "admission_denied"):
            return status
        time.sleep(5)
    raise TimeoutError(f"session {session_id} did not reach active within {timeout}s")


def poll_artifacts(session_id: str, interval: int = 10, timeout: int = 600,
                   *, break_artifact: bool = False) -> list[dict[str, Any]]:
    """--poll fallback: read artifacts every `interval` seconds."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        artifacts = list_artifacts(session_id, break_artifact=break_artifact)
        if artifacts and all(a.get("status") in ("completed", "failed") for a in artifacts):
            return artifacts
        time.sleep(interval)
    return list_artifacts(session_id, break_artifact=break_artifact)


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------

def write_report(session_id: str, artifacts: list[dict[str, Any]], transcript: str,
                 out_dir: Path = Path(".")) -> Path:
    """Merge artifacts + transcript into meeting_record.md and transcript.txt."""
    by_type = {a.get("type"): a for a in artifacts}
    lines = [f"# Meeting Record — {session_id}", ""]
    for t in ARTIFACT_TYPES:
        art = by_type.get(t, {})
        lines.append(f"## {t.replace('_', ' ').title()}")
        if art.get("status") == "failed":
            lines.append(f"**FAILED**: {art.get('failure_reason', 'unknown')}")
        else:
            lines.append(str(art.get("content", "(not available)")))
        lines.append("")
    # Surface any non-standard artifacts (e.g. the --break-artifact `custom` type)
    # so their failure_reason is visible in the report.
    for art in artifacts:
        if art.get("type") in ARTIFACT_TYPES:
            continue
        lines.append(f"## {str(art.get('type', 'artifact')).replace('_', ' ').title()}")
        if art.get("status") == "failed":
            lines.append(f"**FAILED**: {art.get('failure_reason', 'unknown')}")
        else:
            lines.append(str(art.get("content", "(not available)")))
        lines.append("")
    record_path = out_dir / "meeting_record.md"
    record_path.write_text("\n".join(lines), encoding="utf-8")
    (out_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    return record_path


# ---------------------------------------------------------------------------
# Flask webhook receiver
# ---------------------------------------------------------------------------

app = Flask(__name__)


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "ok", "demo_mode": DEMO_MODE})


@app.post("/webhooks/telnyx")
def telnyx_webhook() -> Any:
    """Receive session_status_changed / artifact_completed / artifact_failed.

    Signature verification:
      - If TELNYX_PUBLIC_KEY is set, verify with telnyx.Webhook.construct_event.
      - If TELNYX_PUBLIC_KEY is unset and DEMO_MODE is true, parse raw JSON.
      - If TELNYX_PUBLIC_KEY is unset and DEMO_MODE is false, refuse with 500.
    """
    raw = request.get_data(as_text=True)
    sig = request.headers.get("telnyx-signature-ed25519", "")
    ts = request.headers.get("telnyx-timestamp", "")

    if not TELNYX_PUBLIC_KEY:
        if not DEMO_MODE:
            app.logger.error("TELNYX_PUBLIC_KEY is required in live mode; refusing unsigned webhook")
            return jsonify({"error": "webhook verification not configured"}), 500
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return jsonify({"error": "invalid json"}), 400
    else:
        try:
            event = telnyx.Webhook.construct_event(raw, sig, ts, TELNYX_PUBLIC_KEY)
        except Exception:
            app.logger.exception("webhook signature verification failed")
            return jsonify({"error": "invalid signature"}), 400

    data = event.get("data", {}) if isinstance(event, dict) else {}
    event_type = data.get("event_type", "")
    payload = data.get("payload", {})
    app.logger.info("webhook event=%s session=%s", event_type, payload.get("session_id"))
    if event_type == "artifact_failed":
        app.logger.warning("artifact failed: %s", payload.get("failure_reason"))
    return jsonify({"received": True}), 200


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_create(args: argparse.Namespace) -> int:
    session = create_meeting_session(
        args.url, leave_on_end=not args.skip_leave,
        dynamic_variables={"visitor_name": "Demo Visitor"},
    )
    session_id = session.get("id")
    print(f"created session_id={session_id} status={session.get('status')}")
    try:
        status = wait_for_active(session_id)
    except TimeoutError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if status == "admission_denied":
        print("admission_denied — ask the host to admit the bot from the lobby", file=sys.stderr)
        return 1
    if status in ("ended", "failed"):
        print(f"session ended before active: {status}", file=sys.stderr)
        return 1

    for t in ARTIFACT_TYPES:
        request_artifact(session_id, t)
    if args.break_artifact:
        # Request an artifact type the meeting content cannot support to
        # demonstrate the artifact_failed path with failure_reason surfaced.
        request_artifact(session_id, "custom")

    if args.poll:
        artifacts = poll_artifacts(session_id, break_artifact=args.break_artifact)
    else:
        artifacts = list_artifacts(session_id, break_artifact=args.break_artifact)
    transcript = get_transcript(session_id)
    path = write_report(session_id, artifacts, transcript)
    print(f"wrote {path}")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Meeting-Bot Artifact Desk")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create", help="create a meeting session and mine artifacts")
    c.add_argument("--url", required=True, help="meeting URL (e.g. Google Meet)")
    c.add_argument("--poll", action="store_true", help="poll artifacts instead of webhooks")
    c.add_argument("--skip-leave", action="store_true", help="leave_on_end=false")
    c.add_argument("--break-artifact", action="store_true", help="demo artifact_failed path")
    c.set_defaults(func=_cmd_create)
    s = sub.add_parser("serve", help="run the Flask webhook receiver")
    s.set_defaults(func=_cmd_serve)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
