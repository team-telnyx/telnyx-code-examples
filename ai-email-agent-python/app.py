#!/usr/bin/env python3
"""AI Email Agent — autonomous inbound email reply bot on the Telnyx Email API.

A customer sends an email to your agent's inbox address. Telnyx fires an inbound
webhook. This app verifies the Ed25519 signature, fetches the full message body,
asks Telnyx AI Inference to draft a reply, and sends the reply back via the Email
API — with proper In-Reply-To / References threading so the conversation stays in
one thread in the customer's mail client.

One API key. One platform. The agent that replies to email without you typing.

Live dashboard at / shows every step as it happens — handy for screen recordings.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from html import escape
from typing import Any

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────────────

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
INBOX_ADDRESS = os.getenv("INBOX_ADDRESS", "")
AGENT_DISPLAY_NAME = os.getenv("AGENT_DISPLAY_NAME", "Nyx AI Agent")

# Official Telnyx Python SDK — used only for Ed25519 webhook verification.
# Email API calls go through requests (see email_tools.py) because the Email
# API is in beta and the SDK may not yet expose email endpoints.
telnyx_client = telnyx.Telnyx(
    api_key=TELNYX_API_KEY,
    public_key=TELNYX_PUBLIC_KEY or None,
)

app = Flask(__name__)

# ─── In-memory event log (for the dashboard) ─────────────────────────────────

_events: deque[dict[str, Any]] = deque(maxlen=100)
_log_lock = threading.Lock()


def log_event(kind: str, title: str, detail: str = "", payload: Any = None) -> None:
    """Append a structured event to the in-memory log (shown on the dashboard)."""
    evt = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "kind": kind,            # webhook | inbound | ai | reply | outbound | error | info
        "title": title,
        "detail": detail,
        "payload": payload,
    }
    with _log_lock:
        _events.append(evt)
    # Also echo to stdout for terminal viewing during the demo.
    print(f"[{evt['ts']}] [{kind}] {title}", flush=True)
    if detail:
        print(f"    {detail}", flush=True)


# ─── Webhook signature verification ──────────────────────────────────────────


def verify_webhook() -> dict[str, Any] | None:
    """Verify the Telnyx Ed25519 webhook signature. Returns the parsed event
    payload on success, or None on failure (caller returns 401).

    Uses the official telnyx Python SDK's webhooks.unwrap() helper. If
    TELNYX_PUBLIC_KEY is unset, verification is skipped with a loud warning —
    acceptable for local dev, NOT for production.
    """
    raw_body = request.get_data(as_text=True)
    if not TELNYX_PUBLIC_KEY:
        app.logger.warning(
            "TELNYX_PUBLIC_KEY unset — skipping Ed25519 webhook verification. "
            "Set it in .env for production use."
        )
        return request.get_json(silent=True)

    try:
        event = telnyx_client.webhooks.unwrap(raw_body, headers=dict(request.headers))
        # unwrap returns a telnyx.Event-like object; normalize to a plain dict.
        if hasattr(event, "to_dict") and callable(event.to_dict):
            return event.to_dict()
        if isinstance(event, dict):
            return event
        # Fallback: re-parse the raw body if unwrap returns something opaque.
        return json.loads(raw_body)
    except Exception as exc:
        app.logger.warning("Webhook signature verification failed: %s", exc)
        return None


# ─── The agent flow: fetch → AI → reply (runs in a background thread) ────────


def process_inbound_email(message_id: str, event_payload: dict[str, Any]) -> None:
    """Background worker: fetch full inbound message → AI generates reply →
    send reply via Email API. Logs every step so the dashboard stays live.

    The webhook payload may include the full email body (common for inbound
    email APIs). If it does, we use it directly. If not, we fetch via
    GET /v2/emails/{id}. This makes the agent resilient to either payload shape.
    """
    from agent import generate_reply, html_wrap
    from email_tools import EmailAPIError, fetch_inbound_message, send_email

    log_event(
        "inbound",
        f"New email from {event_payload.get('from', 'unknown')}",
        f"Subject: {event_payload.get('subject', '(no subject)')}",
    )

    payload_body = (
        event_payload.get("text_body")
        or event_payload.get("text")
        or event_payload.get("html_body")
        or event_payload.get("html")
    )
    if payload_body:
        from_obj = event_payload.get("from", {})
        if isinstance(from_obj, dict):
            from_email = from_obj.get("email", "")
            from_name = from_obj.get("name", "")
        else:
            from_email = str(from_obj)
            from_name = ""
        to_obj = event_payload.get("to", {})
        if isinstance(to_obj, list) and to_obj:
            first = to_obj[0]
            to_email = first.get("email", "") if isinstance(first, dict) else str(first)
        elif isinstance(to_obj, dict):
            to_email = to_obj.get("email", "")
        else:
            to_email = str(to_obj)
        inbound = {
            "message_id": message_id,
            "from": from_email,
            "from_name": from_name,
            "to": to_email,
            "subject": event_payload.get("subject", "(no subject)"),
            "text_body": event_payload.get("text_body") or event_payload.get("text") or "",
            "html_body": event_payload.get("html_body") or event_payload.get("html") or "",
        }
        log_event(
            "inbound",
            f"Using body from webhook payload",
            f"Subject: {inbound.get('subject', '(no subject)')} · "
            f"body: {(inbound.get('text_body') or '(html only)')[:120]}…",
        )
    else:
        try:
            inbound = fetch_inbound_message(message_id)
        except EmailAPIError as exc:
            log_event("error", f"Failed to fetch inbound message {message_id}", str(exc))
            return
        if not inbound.get("text_body") and not inbound.get("html_body"):
            log_event(
                "error",
                f"Empty body for message {message_id}",
                "Inbound message had no text_body or html_body — cannot generate reply. "
                "The webhook payload did not include a body, and GET /v2/emails/{id} "
                "returned null bodies. This may happen if the Email API does not store "
                "body content for retrieval. Check the webhook payload shape or use a "
                "domain with inbound fully configured.",
            )
            return
        log_event(
            "inbound",
            f"Fetched message from {inbound.get('from', 'unknown')}",
            f"Subject: {inbound.get('subject', '(no subject)')} · "
            f"body: {(inbound.get('text_body') or '(html only)')[:120]}…",
        )

    # 2. Ask Telnyx AI Inference to draft a reply.
    try:
        reply_text = generate_reply(inbound)
    except Exception as exc:
        log_event("error", "AI inference failed", str(exc))
        return
    log_event(
        "ai",
        "AI reply drafted",
        f"{reply_text[:200]}{'…' if len(reply_text) > 200 else ''}",
    )

    # 3. Send the reply via Email API with In-Reply-To threading.
    reply_subject = inbound.get("subject", "")
    if not reply_subject.lower().startswith("re:"):
        reply_subject = f"Re: {reply_subject}"

    try:
        result = send_email(
            to=inbound["from"],
            subject=reply_subject,
            html_body=html_wrap(reply_text),
            text_body=reply_text,
            in_reply_to=inbound.get("message_id") or message_id,
            references=inbound.get("message_id") or message_id,
        )
    except EmailAPIError as exc:
        log_event("error", "Reply send failed", str(exc))
        return

    log_event(
        "reply",
        f"Reply sent to {inbound.get('from', 'unknown')}",
        f"Subject: {reply_subject} · message_id: {result.get('data', {}).get('id', 'n/a')}",
    )


# ─── Flask routes ─────────────────────────────────────────────────────────────


@app.route("/webhooks/email", methods=["POST"])
def email_webhook() -> tuple[Any, int]:
    """Telnyx Email API webhook receiver. Verifies Ed25519 signature, then
    dispatches inbound events to the background worker and logs outbound
    events (delivered, opened, bounced, etc.) for the dashboard."""
    event = verify_webhook()
    if event is None:
        return jsonify({"error": "invalid signature"}), 401

    data = event.get("data", event) if isinstance(event, dict) else {}
    event_type = data.get("event_type", "")
    payload = data.get("payload", {})

    # Inbound events → kick off the AI reply flow in a background thread.
    inbound_triggers = {"email.received", "email.inbound", "email.inbound.received"}
    if event_type in inbound_triggers:
        message_id = (
            payload.get("message_id")
            or payload.get("id")
            or payload.get("messageId")
            or ""
        )
        if not message_id:
            log_event("error", "Inbound webhook missing message_id", json.dumps(payload)[:300])
            return jsonify({"status": "ignored", "reason": "no message_id"}), 200
        # Run in background so Telnyx gets a fast 200 ack (it retries on non-2xx).
        threading.Thread(
            target=process_inbound_email,
            args=(message_id, payload),
            daemon=True,
        ).start()
        return jsonify({"status": "accepted"}), 200

    # Outbound events → log for the dashboard.
    summary = _summarize_outbound_event(event_type, payload)
    log_event("outbound", f"{event_type}", summary)
    return jsonify({"status": "ok"}), 200


def _summarize_outbound_event(event_type: str, payload: dict[str, Any]) -> str:
    """Build a one-line summary of an outbound email event for the dashboard."""
    target = payload.get("to") or payload.get("recipient") or "?"
    subject = payload.get("subject") or ""
    extra = ""
    if event_type in {"email.bounced", "email.deferred", "email.failed", "email.rejected"}:
        extra = f" · reason: {payload.get('reason', payload.get('error', 'n/a'))}"
    return f"to: {target} · subject: {subject}{extra}"


@app.route("/health", methods=["GET"])
def health() -> tuple[Any, int]:
    return (
        jsonify(
            {
                "status": "ok",
                "inbox": INBOX_ADDRESS,
                "agent": AGENT_DISPLAY_NAME,
                "events_logged": len(_events),
            }
        ),
        200,
    )


@app.route("/", methods=["GET"])
def dashboard() -> str:
    """Live dashboard — shows every step of the AI email agent as it happens.

    For the demo video: open this in a browser, then send a test email to the
    inbox address. Watch the inbound event appear, the AI draft fire, and the
    reply send land — all on one page, auto-refreshing every 3 seconds.
    """
    with _log_lock:
        events_snapshot = list(reversed(_events))

    rows = "\n".join(_render_event_row(e) for e in events_snapshot)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="3">
  <title>AI Email Agent — Live Dashboard</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px; margin: 0 auto; padding: 32px; color: #1a1a1a; background: #fafafa; }}
    h1 {{ font-size: 24px; margin: 0 0 4px; }}
    .sub {{ color: #666; font-size: 14px; margin-bottom: 24px; }}
    .meta {{ background: #fff; border: 1px solid #e5e5e5; border-radius: 8px;
            padding: 16px; margin-bottom: 24px; font-size: 14px; }}
    .meta b {{ color: #4a1; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff;
             border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }}
    th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #f0f0f0;
              font-size: 13px; vertical-align: top; }}
    th {{ background: #f7f7f7; font-weight: 600; font-size: 12px;
          text-transform: uppercase; letter-spacing: 0.5px; color: #666; }}
    .kind {{ font-weight: 600; font-size: 11px; text-transform: uppercase;
             letter-spacing: 0.5px; padding: 2px 8px; border-radius: 4px; }}
    .kind-inbound   {{ background: #e8f0fe; color: #1a56db; }}
    .kind-ai        {{ background: #fef3c7; color: #92400e; }}
    .kind-reply     {{ background: #d1fae5; color: #065f46; }}
    .kind-outbound  {{ background: #e0e7ff; color: #3730a3; }}
    .kind-webhook   {{ background: #f3e8ff; color: #6b21a8; }}
    .kind-error     {{ background: #fee2e2; color: #991b1b; }}
    .kind-info      {{ background: #f1f5f9; color: #475569; }}
    .ts {{ color: #999; font-family: 'SF Mono', Monaco, monospace; font-size: 12px; white-space: nowrap; }}
    .detail {{ color: #555; max-width: 500px; word-wrap: break-word; }}
    .empty {{ text-align: center; padding: 48px; color: #999; }}
  </style>
</head>
<body>
  <h1>AI Email Agent — Live Dashboard</h1>
  <div class="sub">Autonomous inbound email replies on the Telnyx Email API + AI Inference.</div>
  <div class="meta">
    Inbox: <b>{escape(INBOX_ADDRESS)}</b> · Agent persona: <b>{escape(AGENT_DISPLAY_NAME)}</b><br>
    Send a test email to the inbox address above and watch the agent reply on its own.
    Page auto-refreshes every 3 seconds.
  </div>
  <table>
    <thead><tr><th>Time (UTC)</th><th>Stage</th><th>What happened</th><th>Detail</th></tr></thead>
    <tbody>
      {rows if rows else '<tr><td colspan="4" class="empty">No events yet — send an email to the inbox address to begin.</td></tr>'}
    </tbody>
  </table>
</body>
</html>"""


def _render_event_row(e: dict[str, Any]) -> str:
    kind = escape(e.get("kind", "info"))
    return (
        "<tr>"
        f'<td class="ts">{escape(e.get("ts", ""))}</td>'
        f'<td><span class="kind kind-{kind}">{kind}</span></td>'
        f'<td>{escape(e.get("title", ""))}</td>'
        f'<td class="detail">{escape(e.get("detail", ""))}</td>'
        "</tr>"
    )


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    log_event("info", "AI Email Agent started", f"listening on {host}:{port}")
    log_event("info", f"Inbox: {INBOX_ADDRESS}", f"Agent: {AGENT_DISPLAY_NAME}")
    log_event(
        "info",
        "Webhook URL",
        f"{os.getenv('TELNYX_PUBLIC_BASE_URL', '(unset)')}/webhooks/email",
    )
    app.run(debug=False, host=host, port=port)
