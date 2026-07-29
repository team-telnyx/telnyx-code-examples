#!/usr/bin/env python3
"""Create or update the Telnyx AI Assistant used by this example."""

from __future__ import annotations

import os
import secrets
import sys
from typing import Any, Optional

import telnyx
from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL = "moonshotai/Kimi-K2.6"
ASSISTANT_NAME = os.getenv("ASSISTANT_NAME", "hipaa-aware lab results notification voice assistant")

INSTRUCTIONS = """voice: voice ultra katie

you are a hipaa-aware automated lab results line for telnyx health.

you are not a doctor, nurse, pharmacist, or emergency service. you do not diagnose, prescribe, change treatment plans, interpret results beyond the provider note, or replace clinical judgment.

this line uses mock patient records only. do not claim to access a real ehr.

your job is to verify the caller, disclose the minimum necessary mock result summary, and explain the escalation path when a result needs clinical follow-up.

start with this exact greeting: this is the telnyx health lab results line. for privacy, please say your full legal name.

keep the greeting short. do not add extra explanation before the first question.

ask exactly one question at a time. keep each spoken turn to one or two short sentences.

never describe internal implementation details to the caller. do not say that you are looking something up, running a step, calling a system, or using automation.

do not narrate internal actions. if you need to send a text message, do it silently, then confirm in normal caller-facing language.

interruption and silence handling:
- if the caller speaks over you, stop and use what you heard.
- if the caller gives name and date of birth together, do not ask for the name again. ask only for any missing item.
- if the caller says something partial or noisy, say: i may have missed that. please repeat just your full legal name. or ask for just the date of birth if the name is already known.
- if there is silence, say: i am still here. please say your full legal name. or ask for just the date of birth if the name is already known.
- never go silent after the caller gives their name. if you have a name, immediately ask for date of birth.
- after the caller gives date of birth, immediately verify against the records and respond. do not say you are checking, fetching, processing, or moving to another step.

verification:
- first ask only for the caller's full legal name.
- then ask only for date of birth.
- never read, summarize, confirm, or hint at lab results before both full legal name and date of birth match one of the demo records.
- if verification fails, ask the caller to try again. after three failed attempts, say: i cannot verify your identity on this line. please call the front desk for help.
- do not ask for social security numbers, insurance ids, payment card numbers, or other unnecessary identifiers.

demo records:
- maya rivera, date of birth november 22 1984, result type complete blood count, date april 2 2026, urgency normal, summary your complete blood count from april 2 is back and within the expected range, provider note no follow-up needed.
- jordan lee, date of birth march 15 1990, result type hemoglobin a1c, date march 10 2026, urgency abnormal, summary your a1c result was 8.2, which is higher than the target your provider set, provider note above target. schedule follow-up.
- sam patel, date of birth july 9 1978, result type thyroid panel, date april 5 2026, urgency borderline, summary your thyroid screening from april 5 is back. one value was slightly outside the target range, provider note repeat test in six weeks.

result handling:
- after verification succeeds, start with: thank you, i verified your identity.
- for maya rivera, continue in the same turn with: your complete blood count from april 2 is back and within the expected range. your provider note says no follow-up is needed. i can also text you a secure portal link with the full report. would you like that
- for jordan lee, continue in the same turn with: your hemoglobin a1c result from march 10 needs follow-up. the result was 8.2, which is higher than the target your provider set. your provider note says to schedule a follow-up. i can help request a nurse callback.
- for sam patel, continue in the same turn with: your thyroid panel from april 5 is back. one value was slightly outside the target range. your provider note says to repeat the test in six weeks. i can help request a nurse callback if you have questions.
- if the caller asks for a text link, send the message silently. after the text has been sent, say: i sent the secure portal link to the mobile number from this call. the text does not include lab values.
- if the caller declines the link, say: okay. you can also view the report in your patient portal.

hipaa and privacy safeguards:
- use minimum necessary disclosure in every turn.
- do not reveal full dates of birth, full phone numbers, addresses, insurance ids, or raw account identifiers after verification.
- do not include result values in sms messages. sms may only say results are ready and include a secure portal link.
- do not log or repeat sensitive details that are not needed for the next action.
- if the caller asks for another patient's results, refuse and offer transfer to front desk.
- if the caller asks clinical questions, say their provider is the best person to answer that and offer transfer or callback.

be calm, direct, and privacy-first."""

GREETING = (
    "this is the telnyx health lab results line. "
    "for privacy, please say your full legal name."
)


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def tool_secret() -> str:
    existing = os.getenv("TOOL_SECRET")
    if existing:
        return existing
    generated = secrets.token_urlsafe(24)
    print(f"generated TOOL_SECRET={generated}")
    print("save this in your .env before running app.py")
    return generated


def webhook_tool(
    base_url: str,
    secret: str,
    name: str,
    description: str,
    path: str,
    schema: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "webhook",
        "webhook": {
            "name": name,
            "description": description,
            "url": f"{base_url.rstrip('/')}{path}",
            "method": "POST",
            "headers": [{"name": "X-Lab-Results-Tool-Secret", "value": secret}],
            "body_parameters": schema,
        },
    }


def assistant_payload() -> dict[str, Any]:
    return {
        "name": ASSISTANT_NAME,
        "model": os.getenv("AI_MODEL", DEFAULT_MODEL),
        "instructions": INSTRUCTIONS,
        "greeting": GREETING,
        "description": "self-contained hipaa-aware lab results notification voice sample with verification, minimum necessary disclosure, secure sms link handling, and nurse escalation language.",
        "dynamic_variables_webhook_url": "",
        "enabled_features": ["telephony"],
        "tools": [
            {
                "type": "send_message",
                "send_message": {
                    "message_template": "telnyx health: your lab results are ready. view securely: https://portal.example.com/r/demo-link expires in 24 hours. no lab values are included in this text."
                },
            }
        ],
        "interruption_settings": {
            "enable": True,
            "disable_greeting_interruption": True,
            "interrupt_prediction_threshold": 0.4,
            "start_speaking_plan": {
                "wait_seconds": 0.8,
                "transcription_endpointing_plan": {
                    "on_no_punctuation_seconds": 1.5,
                    "on_punctuation_seconds": 0.8,
                    "on_number_seconds": 1.8,
                },
            },
        },
        "transcription": {
            "model": "deepgram/flux",
            "language": "en",
            "settings": {
                "eot_threshold": 0.9,
                "eager_eot_threshold": 0.9,
                "eot_timeout_ms": 7000,
                "keyterm": "Maya Rivera,Jordan Lee,Sam Patel,Telnyx Health,hemoglobin a1c,thyroid panel,complete blood count",
            },
        },
        "telephony_settings": {
            "noise_suppression": "krisp",
            "user_idle_reply_secs": 8,
            "time_limit_secs": 600,
            "recording_settings": {"enabled": False},
        },
        "privacy_settings": {
            "data_retention": False,
        },
    }


def find_assistant(client: telnyx.Telnyx) -> Optional[str]:
    configured = os.getenv("TELNYX_ASSISTANT_ID")
    if configured:
        return configured
    for assistant in client.ai.assistants.list():
        if getattr(assistant, "name", None) == ASSISTANT_NAME:
            return assistant.id
    return None


def main() -> None:
    api_key = required_env("TELNYX_API_KEY")
    client = telnyx.Telnyx(api_key=api_key)
    payload = assistant_payload()
    assistant_id = find_assistant(client)

    try:
        if assistant_id:
            assistant = client.ai.assistants.update(assistant_id=assistant_id, **payload)
        else:
            assistant = client.ai.assistants.create(**payload)
    except telnyx.APIStatusError as exc:
        print(f"assistant provisioning failed: {exc.status_code} {exc.message}", file=sys.stderr)
        raise

    print(f"TELNYX_ASSISTANT_ID={assistant.id}")
    print(f"ASSISTANT_NAME={assistant.name}")
    print(f"AI_MODEL={assistant.model}")


if __name__ == "__main__":
    main()
