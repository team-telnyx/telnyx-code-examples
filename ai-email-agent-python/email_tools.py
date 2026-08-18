"""Telnyx Email API wrappers — send email and fetch inbound messages.

Email API is in invite-only beta. Endpoints are documented at:
  - https://telnyx.com/resources/how-to-send-emails-using-api (launch blog)
  - https://developers.telnyx.com/docs/messaging/email/quickstart

Outbound endpoints (confirmed from the launch blog):
  POST /v2/email_messages                  — send a transactional email
  POST /v2/email_messages/batch            — batch send (up to 50)
  POST /v2/email_templates                 — create a Liquid template
  POST /v2/email_templates/{id}/render     — render a template with variables
  POST /v2/email_domains                   — create a sending domain
  POST /v2/email_domains/{id}/verify       — verify DNS records
  POST /v2/email_domains/{id}/webhooks     — configure domain-level webhook
  GET  /v2/email_events                    — poll events (alternative to webhooks)

Inbound endpoints (TODO: confirm exact paths with the official telnyx-email-inbound
skill / developer docs — the launch blog mentions "inboxes, list and search inbound
messages and threads, set sender filters, and reply or forward" but does not list
the exact endpoint paths). The functions below use the most likely REST shape and
will be updated once the official skill is verified.
"""
from __future__ import annotations

import os
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
API_BASE = "https://api.telnyx.com/v2"

# Sending domain and inbox address (configured via portal or API).
EMAIL_SENDING_DOMAIN = os.getenv("EMAIL_SENDING_DOMAIN", "")
INBOX_ADDRESS = os.getenv("INBOX_ADDRESS", "")
AGENT_DISPLAY_NAME = os.getenv("AGENT_DISPLAY_NAME", "Nyx AI Agent")

_HEADERS = {
    "Authorization": f"Bearer {TELNYX_API_KEY}",
    "Content-Type": "application/json",
}


class EmailAPIError(Exception):
    """Raised when the Telnyx Email API returns a non-2xx response."""


def _check(resp: requests.Response) -> dict[str, Any]:
    """Raise EmailAPIError on non-2xx, else return the parsed JSON body."""
    if not resp.ok:
        raise EmailAPIError(
            f"Email API {resp.request.method} {resp.request.url} failed: "
            f"{resp.status_code} {resp.text[:500]}"
        )
    return resp.json() if resp.content else {}


# ─── Outbound: send email ────────────────────────────────────────────────────


def send_email(
    *,
    to: str,
    subject: str,
    html_body: str | None = None,
    text_body: str | None = None,
    from_email: str | None = None,
    from_name: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> dict[str, Any]:
    """Send a transactional email via POST /v2/email_messages.

    Per the launch blog: `from` is an object with `email` and `name` (not a string),
    and the body field is `html_body` (not `html`).

    For replying to an inbound thread, pass `in_reply_to` (the Message-ID of the
    message being replied to) and optionally `references` (the full References
    chain). Standard email clients use these headers to thread the conversation.
    """
    if from_email is None:
        from_email = INBOX_ADDRESS
    if from_name is None:
        from_name = AGENT_DISPLAY_NAME

    payload: dict[str, Any] = {
        "from": {"email": from_email, "name": from_name},
        "to": [{"email": to}],
        "subject": subject,
    }
    if html_body is not None:
        payload["html_body"] = html_body
    if text_body is not None:
        payload["text_body"] = text_body

    # Threading headers (passed as custom headers since the blog's send schema
    # does not explicitly list them — most transactional email APIs accept them
    # as top-level fields or via a `headers` object).
    headers_extra: dict[str, str] = {}
    if in_reply_to:
        headers_extra["In-Reply-To"] = in_reply_to
    if references:
        headers_extra["References"] = references
    if headers_extra:
        payload["headers"] = headers_extra

    resp = requests.post(f"{API_BASE}/email_messages", headers=_HEADERS, json=payload, timeout=15)
    return _check(resp)


# ─── Inbound: fetch and reply ────────────────────────────────────────────────
# TODO(email-inbound): confirm the exact endpoint paths against the official
# telnyx-email-inbound skill (https://github.com/team-telnyx/ai). The blog
# mentions inboxes, inbound messages/threads, sender filters, and reply/forward
# but does not list exact paths. The functions below use the most likely REST
# shape; they will be updated once the official skill is verified.


def fetch_inbound_message(message_id: str) -> dict[str, Any]:
    """Fetch a single inbound email message by ID.

    TODO(confirm): exact path likely GET /v2/email_inbound_messages/{id} or
    GET /v2/email_messages/{id}?direction=inbound. The webhook payload should
    contain the message_id needed here.

    Returns a normalized dict with keys: from, from_name, to, subject,
    text_body, html_body, message_id — the shape agent.generate_reply expects.
    """
    # Try the most likely path first.
    resp = requests.get(
        f"{API_BASE}/email_inbound_messages/{message_id}",
        headers=_HEADERS,
        timeout=15,
    )
    if not resp.ok:
        # Fallback: maybe it's under /v2/email_messages/{id}.
        resp = requests.get(
            f"{API_BASE}/email_messages/{message_id}",
            headers=_HEADERS,
            timeout=15,
        )
    data = _check(resp)
    return _normalize_inbound(data)


def list_inbound_messages(limit: int = 20) -> list[dict[str, Any]]:
    """List recent inbound messages. TODO(confirm): exact path likely
    GET /v2/email_inbound_messages."""
    resp = requests.get(
        f"{API_BASE}/email_inbound_messages",
        headers=_HEADERS,
        params={"limit": limit},
        timeout=15,
    )
    data = _check(resp)
    # The list endpoint likely returns {"data": [...]} (Telnyx v2 convention).
    items = data.get("data", data) if isinstance(data, dict) else data
    return [_normalize_inbound(item) for item in items]


def _normalize_inbound(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an inbound message from the API response into the shape
    agent.generate_reply expects: from, from_name, to, subject, text_body,
    html_body, message_id.

    TODO(confirm): field names depend on the actual API response shape. The
    mapping below handles common variants (from vs sender, text vs text_body,
    etc.) and will be tightened once the official skill is verified.
    """
    if not isinstance(raw, dict):
        return {}

    from_obj = raw.get("from") or raw.get("sender") or {}
    if isinstance(from_obj, dict):
        from_email = from_obj.get("email") or from_obj.get("address") or ""
        from_name = from_obj.get("name") or ""
    else:
        # Some APIs return From: as a string RFC 822 header.
        from_email = str(from_obj)
        from_name = ""

    to_obj = raw.get("to") or {}
    if isinstance(to_obj, list) and to_obj:
        to_obj = to_obj[0]
    if isinstance(to_obj, dict):
        to_email = to_obj.get("email") or to_obj.get("address") or ""
    else:
        to_email = str(to_obj)

    return {
        "message_id": raw.get("message_id") or raw.get("id") or raw.get("messageId") or "",
        "from": from_email,
        "from_name": from_name,
        "to": to_email,
        "subject": raw.get("subject") or "(no subject)",
        "text_body": raw.get("text_body") or raw.get("text") or raw.get("body") or "",
        "html_body": raw.get("html_body") or raw.get("html") or "",
    }


# ─── Domain & webhook setup helpers ─────────────────────────────────────────
# These are convenience helpers for the README/GUIDE setup steps. Not used by
# the live demo flow (domain + webhook are configured once via portal), but
# included so the demo directory is a self-contained reference.


def list_domains() -> dict[str, Any]:
    """List sending domains. TODO(confirm): exact path likely
    GET /v2/email_domains."""
    resp = requests.get(f"{API_BASE}/email_domains", headers=_HEADERS, timeout=15)
    return _check(resp)


def create_domain(domain: str) -> dict[str, Any]:
    """Create a sending domain. Telnyx generates SPF, DKIM, DMARC, MX records
    that you publish at your DNS provider, then call verify_domain()."""
    resp = requests.post(
        f"{API_BASE}/email_domains",
        headers=_HEADERS,
        json={"domain": domain},
        timeout=15,
    )
    return _check(resp)


def verify_domain(domain_id: str) -> dict[str, Any]:
    """Trigger DNS verification for a sending domain."""
    resp = requests.post(
        f"{API_BASE}/email_domains/{domain_id}/verify",
        headers=_HEADERS,
        timeout=15,
    )
    return _check(resp)


def configure_domain_webhook(
    *,
    domain_id: str,
    webhook_url: str,
    events: list[str],
) -> dict[str, Any]:
    """Configure a per-domain webhook. Per the launch blog, webhooks are
    configured per sender domain, not per message."""
    resp = requests.post(
        f"{API_BASE}/email_domains/{domain_id}/webhooks",
        headers=_HEADERS,
        json={"url": webhook_url, "events": events},
        timeout=15,
    )
    return _check(resp)


# Webhook events for outbound email (confirmed from the launch blog).
OUTBOUND_WEBHOOK_EVENTS = [
    "email.queued",
    "email.sending",
    "email.sent",
    "email.delivered",
    "email.opened",
    "email.clicked",
    "email.bounced",
    "email.deferred",
    "email.failed",
    "email.unsubscribed",
    "email.complained",
    "email.rejected",
]

# Inbound webhook events (TODO: confirm exact event name(s) against the official
# telnyx-email-inbound skill). The webhook handler in app.py accepts any of
# these as a trigger for the fetch → AI → reply flow.
INBOUND_WEBHOOK_EVENTS = [
    "email.received",
    "email.inbound",
    "email.inbound.received",
]
