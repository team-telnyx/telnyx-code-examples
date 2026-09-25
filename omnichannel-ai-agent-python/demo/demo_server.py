"""Single-file demo for the omnichannel AI agent.

Runs the full Email -> SMS -> Voice pipeline without Telnyx credentials.
Mock Telnyx APIs print simulated sends. Mock inference API returns scripted tool
calls that walk through a billing dispute scenario.

Run from the omnichannel-ai-agent-python/ directory:
    python demo/demo_server.py

Then open http://localhost:5555/ in your browser and click "Run Agent".
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

# Put the project root on sys.path so `import app` works regardless of CWD.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Hermetic demo environment — set BEFORE importing app.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key")
os.environ.setdefault("TELNYX_FROM_NUMBER", "+15555550100")
os.environ.setdefault("TELNYX_EMAIL_FROM", "agent@demo.telnyx.com")
os.environ.setdefault("CONNECTION_ID", "demo_connection_id")
os.environ.setdefault("DB_PATH", os.path.join(_PROJECT_ROOT, "demo_conversations.db"))
os.environ.setdefault("PORT", "5555")

# Clean any stale demo DB so each run starts fresh.
_demo_db = os.environ["DB_PATH"]
if os.path.exists(_demo_db):
    os.remove(_demo_db)

# ---------------------------------------------------------------------------
# Mock Telnyx Inference API — scripted tool-calling responses (OpenAI format)
# ---------------------------------------------------------------------------
_SCRIPTED_RESPONSES = [
    # Step 1: Agent sends an email acknowledging the billing dispute
    {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": "I'll start by sending a formal email to acknowledge the billing dispute.",
                "tool_calls": [{
                    "id": "tool_001",
                    "type": "function",
                    "function": {
                        "name": "send_email",
                        "arguments": json.dumps({
                            "subject": "Re: Billing Dispute — Account Review in Progress",
                            "body": (
                                "Dear Sarah,\n\n"
                                "Thank you for reaching out about the $147.50 charge on your September statement. "
                                "I want to assure you that we take billing concerns seriously.\n\n"
                                "I've opened a review of your account and will investigate the charge. "
                                "Here's what happens next:\n\n"
                                "1. Our billing team will audit the charge within 24 hours\n"
                                "2. You'll receive a status update via text message\n"
                                "3. If the charge is confirmed as an error, a credit will be applied immediately\n\n"
                                "Your reference number is BD-2024-0847.\n\n"
                                "Best regards,\n"
                                "TelnyxDemo Corp Customer Service"
                            ),
                        }),
                    },
                }],
            },
        }],
    },
    # Step 2: Agent sends an SMS with a quick status update
    {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": "Now I'll send a quick SMS to confirm the email and give a timeline.",
                "tool_calls": [{
                    "id": "tool_002",
                    "type": "function",
                    "function": {
                        "name": "send_sms",
                        "arguments": json.dumps({
                            "text": (
                                "Hi Sarah, this is TelnyxDemo Corp. We just emailed you about your "
                                "billing dispute (ref: BD-2024-0847). Our team is reviewing the $147.50 "
                                "charge and will have an update within 24 hours. Reply HELP for assistance."
                            ),
                        }),
                    },
                }],
            },
        }],
    },
    # Step 3: Agent calls the customer to resolve the issue personally
    {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": "The billing review found the charge was an error. I'll call Sarah to explain the resolution personally.",
                "tool_calls": [{
                    "id": "tool_003",
                    "type": "function",
                    "function": {
                        "name": "make_call",
                        "arguments": json.dumps({
                            "speak_text": (
                                "Hello Sarah, this is your AI assistant from TelnyxDemo Corp calling about "
                                "your billing dispute, reference BD-2024-0847. Good news — our review confirmed "
                                "the $147.50 charge was a duplicate billing error. We've applied a full credit "
                                "to your account, and you'll see it reflected within 2 business days. "
                                "We also emailed you the details earlier today, and sent you a text confirmation. "
                                "Is there anything else I can help you with? If not, have a wonderful day."
                            ),
                        }),
                    },
                }],
            },
        }],
    },
    # Step 4: Agent resolves the issue
    {
        "choices": [{
            "finish_reason": "tool_calls",
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "tool_004",
                    "type": "function",
                    "function": {
                        "name": "resolve_issue",
                        "arguments": json.dumps({
                            "summary": (
                                "Billing dispute BD-2024-0847 resolved. Duplicate charge of $147.50 "
                                "confirmed and credited. Customer notified via email, SMS, and voice call."
                            ),
                        }),
                    },
                }],
            },
        }],
    },
    # Step 5: Final summary — stop
    {
        "choices": [{
            "finish_reason": "stop",
            "message": {
                "role": "assistant",
                "content": (
                    "Issue resolved. I used all three channels:\n\n"
                    "1. **Email** — Sent formal acknowledgment with reference number and next steps\n"
                    "2. **SMS** — Quick confirmation that the email was sent, with a 24-hour timeline\n"
                    "3. **Voice** — Called to deliver the resolution personally and confirm the credit\n\n"
                    "Each channel referenced the previous ones, maintaining shared context throughout."
                ),
            },
        }],
    },
]


_script_index = 0


def _mock_call_inference(messages):
    global _script_index
    # Deliberate delay so the UI animation is visible during recording
    time.sleep(1.5)
    if _script_index >= len(_SCRIPTED_RESPONSES):
        return _SCRIPTED_RESPONSES[-1]
    resp = _SCRIPTED_RESPONSES[_script_index]
    _script_index += 1
    return resp


# ---------------------------------------------------------------------------
# Mock Telnyx API calls — print instead of sending
# ---------------------------------------------------------------------------
_demo_log = []


def _mock_send_email(to_email, subject, body):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "email",
        "to": to_email,
        "subject": subject,
        "body": body[:200] + "..." if len(body) > 200 else body,
    }
    _demo_log.append(entry)
    print(f"\n  EMAIL -> {to_email}")
    print(f"     Subject: {subject}")
    print(f"     Body: {body[:120]}...")
    return {"data": {"id": "demo-email-001"}}


def _mock_send_sms(to_number, text):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "sms",
        "to": to_number,
        "text": text,
    }
    _demo_log.append(entry)
    print(f"\n  SMS -> {to_number}")
    print(f"     Text: {text[:120]}...")
    return {"data": {"id": "demo-sms-001"}}


def _mock_make_call(to_number, speak_text):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channel": "voice",
        "to": to_number,
        "speak_text": speak_text[:200] + "..." if len(speak_text) > 200 else speak_text,
    }
    _demo_log.append(entry)
    print(f"\n  VOICE -> {to_number}")
    print(f"     Will speak: {speak_text[:120]}...")
    return {"data": {"id": "demo-call-001"}}


# ---------------------------------------------------------------------------
# Import and patch the real app
# ---------------------------------------------------------------------------
import app as real_app  # noqa: E402

real_app.init_db()

# Patch the inference function
real_app.call_inference = _mock_call_inference

# Patch the Telnyx channel functions
real_app.send_email = _mock_send_email
real_app.send_sms = _mock_send_sms
real_app.make_call = _mock_make_call

from app import app  # noqa: E402

# ---------------------------------------------------------------------------
# Demo routes
# ---------------------------------------------------------------------------
@app.route("/demo/log", methods=["GET"])
def demo_log():
    """View the demo event log."""
    from flask import jsonify
    return jsonify(_demo_log)


@app.route("/demo/reset", methods=["POST"])
def demo_reset():
    """Reset demo state for a fresh run."""
    global _script_index
    _script_index = 0
    _demo_log.clear()
    import sqlite3
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("DELETE FROM conversations")
    conn.commit()
    conn.close()
    from flask import jsonify
    return jsonify({"status": "reset"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5555"))

    print(f"\n  Omnichannel AI Agent — demo server")
    print(f"  Dashboard:       http://localhost:{port}/")
    print(f"  Agent trigger:   http://localhost:{port}/agent/run")
    print(f"  Conversations:   http://localhost:{port}/conversations")
    print(f"  Demo log:        http://localhost:{port}/demo/log")
    print(f"  Health:          http://localhost:{port}/health")
    print(f"\n  Open http://localhost:{port}/ and click 'Run Agent' to start.\n")

    app.run(host="0.0.0.0", port=port, debug=False)
