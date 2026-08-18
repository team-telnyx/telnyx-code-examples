"""Telnyx AI Inference wrapper — the agent brain that reads inbound emails and writes replies.

Uses POST /v2/ai/chat/completions (OpenAI-compatible) on the same Telnyx API key
as the rest of the platform. No second vendor, no second invoice.
"""
from __future__ import annotations

import os
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
DEFAULT_SYSTEM_PROMPT = os.getenv(
    "AGENT_SYSTEM_PROMPT",
    (
        "You are Nyx, a friendly AI email assistant. Reply to customer emails "
        "with helpful, concise, professional responses. Keep replies under 150 words. "
        "Sign off as 'Nyx, Telnyx AI Agent'."
    ),
)
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "400"))

INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"


def generate_reply(
    inbound_email: dict[str, Any],
    *,
    system_prompt: str | None = None,
    max_tokens: int | None = None,
) -> str:
    """Generate a plain-text reply to an inbound email using Telnyx AI Inference.

    `inbound_email` is the normalized inbound message dict (see email_tools.fetch_inbound_message):
        {
            "from":       "[email protected]",
            "from_name":  "Ada Lovelace",          # optional
            "to":         "[email protected]",
            "subject":    "Question about pricing",
            "text_body":  "Hi, what does SMS cost?",  # preferred
            "html_body":  "<p>Hi, what does SMS cost?</p>",  # fallback
            "message_id": "<[email protected]>",   # for In-Reply-To threading
        }

    Returns the AI-generated reply as plain text. Raises requests.HTTPError on
    inference failure so the caller can log and skip the send.
    """
    prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
    tokens = max_tokens or MAX_TOKENS

    sender = inbound_email.get("from_name") or inbound_email.get("from", "the customer")
    subject = inbound_email.get("subject", "(no subject)")
    body = (inbound_email.get("text_body") or "").strip()
    if not body:
        # Strip HTML tags crudely if only html_body is available. Good enough for
        # a demo; production should use a proper HTML-to-text converter.
        import html
        import re

        raw_html = inbound_email.get("html_body", "")
        body = re.sub(r"<[^>]+>", " ", raw_html)
        body = html.unescape(body)
        body = re.sub(r"\s+", " ", body).strip()

    user_content = (
        f"From: {sender}\n"
        f"Subject: {subject}\n\n"
        f"Customer email:\n{body}\n\n"
        "Write a helpful reply to this email. Reply with the email body only — "
        "no subject line, no 'Subject:' prefix, no metadata. Just the message "
        "the customer will read."
    )

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_content},
    ]

    resp = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": AI_MODEL,
            "messages": messages,
            "max_tokens": tokens,
            "temperature": 0.7,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def html_wrap(plain_text: str) -> str:
    """Wrap a plain-text AI reply in minimal HTML so email clients render line breaks."""
    import html

    escaped = html.escape(plain_text)
    # Preserve paragraph breaks (double newline) and single line breaks.
    paragraphs = escaped.split("\n\n")
    html_paragraphs = "\n\n".join(
        f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs if p.strip()
    )
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
{html_paragraphs}
</body>
</html>"""
