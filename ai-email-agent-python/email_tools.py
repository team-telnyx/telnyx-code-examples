"""Telnyx Email API wrappers — send email and fetch inbound messages.

Email API is in invite-only beta. Endpoints confirmed via live API probing
(202-08-18, beta access granted):

Outbound + retrieval (CONFIRMED working):
  POST /v2/emails                          — send a transactional email (202 Accepted)
  GET  /v2/emails                          — list emails (outbound + inbound)
  GET  /v2/emails/{id}                     — retrieve a single email by ID
  GET  /v2/email_domains                   — list sending domains (shared + custom)

Domain management (paths from launch blog, not yet live-verified):
  POST /v2/email_domains                   — create a sending domain
  POST /v2/email_domains/{id}/verify       — verify DNS records
  POST /v2/email_domains/{id}/webhooks     — configure domain-level webhook

Sandbox restriction (CONFIRMED):
  Shared domains (mail.telnyx.com, msgtelnyx.com) are in sandbox mode —
  the from-address MUST be onboarding@<shared-domain> and recipients must
  be verified email addresses on your Telnyx account. To send to arbitrary
  recipients, verify your own custom domain.

Request format (CONFIRMED):
  - `from` accepts a plain string email: "onboarding@mail.telnyx.com"
  - `to` accepts an array of strings: ["recipient@example.com"]
  - Body fields are `text` and `html` (not `text_body`/`html_body`)
  - Response normalizes `from` to {"email": "..."} and `to` to [{"email": "..."}]
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
REPLY_FROM_ADDRESS = os.getenv("REPLY_FROM_ADDRESS", "")
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
    """Send a transactional email via POST /v2/emails.

    Confirmed request format (live-verified 202-08-18):
    - `from` is a plain string email address
    - `to` is an array of string email addresses
    - Body fields are `text` and `html` (not `text_body`/`html_body`)
    - Returns 202 Accepted with the email ID and initial "queued" status

    Shared-domain sandbox: the from-address must be
    ``onboarding@mail.telnyx.com`` (or ``onboarding@msgtelnyx.com``) and
    recipients must be verified on your Telnyx account. To send to
    arbitrary recipients, verify your own custom domain via
    ``POST /v2/email_domains``.

    For replying to an inbound thread, pass ``in_reply_to`` (the Message-ID
    of the message being replied to) and optionally ``references`` (the full
    References chain). Standard email clients use these headers to thread
    the conversation.
    """
    if from_email is None:
        from_email = REPLY_FROM_ADDRESS or INBOX_ADDRESS

    payload: dict[str, Any] = {
        "from": from_email,
        "to": [to],
        "subject": subject,
    }
    if html_body is not None:
        payload["html_body"] = html_body
    if text_body is not None:
        payload["text_body"] = text_body

    # Threading headers (passed via the `headers` object — most transactional
    # email APIs accept In-Reply-To and References as custom headers).
    headers_extra: dict[str, str] = {}
    if in_reply_to:
        headers_extra["In-Reply-To"] = in_reply_to
    if references:
        headers_extra["References"] = references
    if headers_extra:
        payload["headers"] = headers_extra

    resp = requests.post(f"{API_BASE}/emails", headers=_HEADERS, json=payload, timeout=15)
    return _check(resp)


# ─── Inbound: fetch and reply ────────────────────────────────────────────────
# CONFIRMED (202-08-18): inbound and outbound emails share the same /v2/emails
# resource. GET /v2/emails lists all emails; GET /v2/emails/{id} retrieves any
# email by ID (inbound or outbound). The webhook payload contains the message
# ID needed for retrieval. Inbound-specific filters (if any) will be added once
# the official telnyx-email-inbound skill is verified.


def fetch_inbound_message(message_id: str) -> dict[str, Any]:
    """Fetch a single email message by ID via GET /v2/emails/{id}.

    Confirmed working (202-08-18): returns the full email object including
    status, events, from, to, subject, and body. Works for both inbound and
    outbound messages — the same endpoint retrieves any email by ID.

    Returns a normalized dict with keys: from, from_name, to, subject,
    text_body, html_body, message_id — the shape agent.generate_reply expects.
    """
    resp = requests.get(
        f"{API_BASE}/emails/{message_id}",
        headers=_HEADERS,
        timeout=15,
    )
    data = _check(resp)
    raw = data.get("data", data) if isinstance(data, dict) else data
    return _normalize_inbound(raw)


def list_inbound_messages(limit: int = 20) -> list[dict[str, Any]]:
    """List recent emails via GET /v2/emails.

    Confirmed working (202-08-18): returns ``{"data": [...], "meta": {...}}``.
    Inbound and outbound emails share the same list endpoint. Filter the
    normalized results client-side if you need only inbound messages.
    """
    resp = requests.get(
        f"{API_BASE}/emails",
        headers=_HEADERS,
        params={"page_size": limit},
        timeout=15,
    )
    data = _check(resp)
    items = data.get("data", []) if isinstance(data, dict) else data
    return [_normalize_inbound(item) for item in items]


def _normalize_inbound(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an email from the API response into the shape
    agent.generate_reply expects: from, from_name, to, subject, text_body,
    html_body, message_id.

    Confirmed response shape (202-08-18):
    - ``from`` is ``{"email": "...", "name": "..."}`` (name may be absent)
    - ``to`` is ``[{"email": "...", "name": "..."}]``
    - Body fields depend on direction; outbound has no body in the list
      response, only in the single-message retrieval.
    """
    if not isinstance(raw, dict):
        return {}

    from_obj = raw.get("from") or {}
    if isinstance(from_obj, dict):
        from_email = from_obj.get("email") or ""
        from_name = from_obj.get("name") or ""
    else:
        from_email = str(from_obj)
        from_name = ""

    to_list = raw.get("to") or []
    if isinstance(to_list, list) and to_list:
        first = to_list[0]
        if isinstance(first, dict):
            to_email = first.get("email") or ""
        else:
            to_email = str(first)
    else:
        to_email = str(to_list)

    return {
        "message_id": raw.get("id") or raw.get("message_id") or "",
        "from": from_email,
        "from_name": from_name,
        "to": to_email,
        "subject": raw.get("subject") or "(no subject)",
        "text_body": raw.get("text") or raw.get("text_body") or "",
        "html_body": raw.get("html") or raw.get("html_body") or "",
    }


# ─── Domain & webhook setup helpers ─────────────────────────────────────────
# `list_domains` is CONFIRMED working (GET /v2/email_domains, 200). The create,
# verify, and webhook-config endpoints are from the launch blog and have not
# been live-verified yet — they are included as reference for the setup steps.


def list_domains() -> dict[str, Any]:
    """List sending domains via GET /v2/email_domains.

    Confirmed working (202-08-18): returns shared and custom domains with
    DNS records, verification status, DKIM config, tracking settings, and
    inbound configuration.
    """
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


# Outbound webhook events — confirmed from the launch blog and live email
# event tracking (GET /v2/emails/{id} returns an `events` array with these
# types: queued, sending, sent, delivered, failed, etc.).
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

# Inbound webhook events (the exact event name is being confirmed against the
# official telnyx-email-inbound skill). The webhook handler in app.py accepts
# any of these as a trigger for the fetch → AI → reply flow.
INBOUND_WEBHOOK_EVENTS = [
    "email.received",
    "email.inbound",
    "email.inbound.received",
]
