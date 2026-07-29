#!/usr/bin/env python3
"""Provision the Telnyx AI Assistant and Pay Connector for this example."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

API = "https://api.telnyx.com/v2"
DEFAULT_MODEL = "openai/gpt-4o"
DEFAULT_ASSISTANT_NAME = "ai pci protected payment collection assistant"
DEFAULT_PAY_CONNECTOR_NAME = "pci-protected-payment-demo"
DATA_DIR = Path(__file__).parent / "data"
CUSTOMERS = json.loads((DATA_DIR / "customers.json").read_text())


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def request_json(method: str, path: str, api_key: str, **kwargs: Any) -> dict[str, Any]:
    response = requests.request(method, f"{API}{path}", headers=headers(api_key), timeout=30, **kwargs)
    if response.status_code >= 400:
        raise RuntimeError(f"{method} {path} failed: {response.status_code} {response.text[:1000]}")
    return response.json()


def customer_context() -> dict[str, Any]:
    customer_id = os.getenv("DEMO_CUSTOMER_ID", "acct_1042")
    return CUSTOMERS.get(customer_id) or next(iter(CUSTOMERS.values()))


def instructions(customer: dict[str, Any]) -> str:
    balance = customer["balance_usd"]
    name = customer["name"]
    customer_id = customer["id"]
    dob = customer["dob"]
    days = customer["days_past_due"]
    return f"""you are the automated billing assistant for a payment collection demo.

you are having a live phone conversation. be warm, concise, and natural. ask one question at a time. do not sound like an ivr.

you are helping {name.lower()} with account {customer_id}. the account is {days} days past due with a balance of {balance} dollars. the caller's date of birth is {dob}.

first, verify the caller by asking for date of birth. accept natural date formats if they match {dob}. do not disclose the balance until verified.

after verification, say the account is {days} days past due with a balance of {balance} dollars. offer to take payment in full or set up a weekly payment plan.

if the caller asks for a weekly payment plan, calculate a short plan summary. ask if they agree to the plan and agree to start secure keypad card entry.

only after the caller clearly agrees, use the start_secure_payment tool. pass amount_now, weekly_amount, customer_id as {customer_id}, and a short plan_summary.

before using the tool, tell the caller that telnyx pay over voice will collect their card details by keypad and that they should not say card numbers out loud.

during pay over voice, do not ask for card numbers, expiration dates, security codes, postal codes, or zip codes. telnyx pay over voice handles that secure step.

after the secure keypad payment step is done and before saying it is complete, call the record_secure_payment_complete tool with status completed. this creates a visible completion event in conversation analysis without exposing card details.

if the caller disputes the balance, asks for a human, or sounds upset, offer to transfer to billing support and do not collect payment.

never threaten, shame, mention legal action, discuss credit reporting, waive balances, or accept card details spoken aloud."""


def tool_body(base_url: str, secret: str, name: str, description: str, path: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "webhook",
        "display_name": name.replace("_", " "),
        "webhook": {
            "name": name,
            "description": description,
            "url": f"{base_url.rstrip('/')}{path}",
            "method": "POST",
            "headers": [{"name": "X-Demo-Tool-Secret", "value": secret}],
            "path_parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            "query_parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            "body_parameters": schema,
            "async": False,
        },
        "timeout_ms": 10000,
    }


def ensure_tool(api_key: str, payload: dict[str, Any]) -> str:
    name = payload["webhook"]["name"]
    tools = request_json("GET", "/ai/tools", api_key).get("data", [])
    for tool in tools:
        definition = tool.get("tool_definition") or {}
        if definition.get("name") == name:
            request_json("PATCH", f"/ai/tools/{tool['id']}", api_key, json=payload)
            return tool["id"]
    return request_json("POST", "/ai/tools", api_key, json=payload)["id"]


def ensure_pay_connector(api_key: str, name: str, endpoint_url: str) -> None:
    payload = {
        "name": name,
        "type": "generic",
        "mode": "test",
        "config": {"endpoint_url": endpoint_url, "auth_type": "none"},
    }
    response = requests.post(f"{API}/pay_connectors", headers=headers(api_key), json=payload, timeout=30)
    if response.status_code in {409, 422}:
        request_json("PATCH", f"/pay_connectors/{name}", api_key, json={"config": payload["config"]})
        return
    if response.status_code >= 400:
        raise RuntimeError(f"POST /pay_connectors failed: {response.status_code} {response.text[:1000]}")


def find_assistant(api_key: str, assistant_name: str) -> str | None:
    configured = os.getenv("TELNYX_ASSISTANT_ID")
    if configured:
        return configured
    assistants = request_json("GET", "/ai/assistants", api_key).get("data", [])
    for assistant in assistants:
        if assistant.get("name") == assistant_name:
            return assistant["id"]
    return None


def main() -> None:
    api_key = required_env("TELNYX_API_KEY")
    public_base_url = required_env("PUBLIC_BASE_URL")
    assistant_name = os.getenv("ASSISTANT_NAME", DEFAULT_ASSISTANT_NAME)
    pay_connector_name = os.getenv("PAY_CONNECTOR_NAME", DEFAULT_PAY_CONNECTOR_NAME)
    secret = required_env("TOOL_SECRET")
    customer = customer_context()

    ensure_pay_connector(api_key, pay_connector_name, f"{public_base_url.rstrip('/')}/webhooks/payment-processor")

    start_schema = {
        "type": "object",
        "properties": {
            "weekly_amount": {"type": "string", "description": "weekly amount the caller agreed to, such as 40.00"},
            "amount_now": {"type": "string", "description": "amount to charge now, usually the first payment"},
            "plan_summary": {"type": "string", "description": "short confirmed plan summary"},
            "customer_id": {"type": "string", "description": "customer account id"},
            "call_control_id": {"type": "string", "description": "optional current call control id if available"},
        },
        "required": ["weekly_amount", "amount_now", "plan_summary"],
        "additionalProperties": False,
    }
    complete_schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "completion status, usually completed"},
            "plan_summary": {"type": "string", "description": "short confirmed payment plan summary"},
            "call_control_id": {"type": "string", "description": "optional current call control id if available"},
        },
        "required": ["status"],
        "additionalProperties": False,
    }
    tool_ids = [
        ensure_tool(
            api_key,
            tool_body(
                public_base_url,
                secret,
                "start_secure_payment",
                "start telnyx pay over voice after the caller agrees to a payment plan. never collect card details in the assistant.",
                "/tools/start-secure-payment",
                start_schema,
            ),
        ),
        ensure_tool(
            api_key,
            tool_body(
                public_base_url,
                secret,
                "record_secure_payment_complete",
                "record that the secure pay over voice step completed without exposing card details.",
                "/tools/record-payment-complete",
                complete_schema,
            ),
        ),
    ]

    payload = {
        "name": assistant_name,
        "model": os.getenv("AI_MODEL", DEFAULT_MODEL),
        "instructions": instructions(customer),
        "greeting": "hi, this is the automated billing line. i can help with your past-due account and set up a payment plan. to protect your account, can you tell me your date of birth?",
        "description": "pci-protected payment collection assistant that starts telnyx pay over voice for keypad card entry.",
        "enabled_features": ["telephony"],
        "tool_ids": tool_ids,
    }
    assistant_id = find_assistant(api_key, assistant_name)
    if assistant_id:
        assistant = request_json("POST", f"/ai/assistants/{assistant_id}", api_key, json=payload)
    else:
        assistant = request_json("POST", "/ai/assistants", api_key, json=payload)

    print(f"TELNYX_ASSISTANT_ID={assistant['id']}")
    print(f"PAY_CONNECTOR_NAME={pay_connector_name}")
    print(f"PUBLIC_BASE_URL={public_base_url.rstrip('/')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"provisioning failed: {exc}", file=sys.stderr)
        raise
