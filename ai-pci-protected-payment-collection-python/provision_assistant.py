#!/usr/bin/env python3
"""Provision the Telnyx AI Assistant, Pay Connector, and native Pay tool."""

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
DEFAULT_MODEL = "moonshotai/Kimi-K2.6"
DEFAULT_ASSISTANT_NAME = "ai pci protected payment collection assistant"
DEFAULT_PAY_CONNECTOR_NAME = "pci-protected-payment-demo"
DEFAULT_PAYMENT_DESCRIPTION = "secure payment pci demo"
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
    if not response.text:
        return {}
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
    return f"""voice: voice ultra katie

you are an ai pci protected payment collection assistant for a past due account demo.

keep responses short and natural. this is the telnyx account services demo line for pci protected payment collection. it can review a past due balance, explain a payment plan, answer billing questions, and start telnyx pay over voice for secure keypad payment.

the greeting already explained the line and asked for the caller's full name. after they answer, ask for their date of birth. verify that the name matches {name.lower()} and the date of birth matches {dob}. do not disclose the balance until verified.

you are helping {name.lower()} with account {customer_id}. the account is {days} days past due with a balance of {balance} dollars.

after verification, explain the account status in plain language. offer to answer questions, take payment in full, or set up a weekly payment plan.

if the caller asks for a weekly payment plan, offer forty dollars today, then forty dollars weekly, with the remaining final payment. ask if they agree to the plan and agree to start secure keypad card entry.

when the caller agrees to pay, say exactly: i will start telnyx pay over voice now. telnyx will ask for your card number, expiration date, billing zip code, and security code by keypad. do not say card details out loud.

then use the pay tool for a forty dollar payment.

after the pay tool starts, say only: the protected payment session has started. please listen for telnyx pay over voice and use your keypad. i will wait here.

if the pay tool completes successfully, say exactly: thank you. that's all collected, and your payment plan is set. your first payment of forty dollars has been processed securely, and the remaining payments will follow the weekly plan we discussed.

if the pay tool fails or is declined, say exactly: i was not able to complete the secure payment. we can try again or choose another payment option.

during pay over voice, the assistant does not receive dtmf or raw card details. do not ask for card number, expiration date, billing zip code, security code, or any card digits yourself.

if the caller disputes the balance, asks for a human, or sounds upset, offer to transfer to billing support and do not collect payment.

never threaten, shame, mention legal action, discuss credit reporting, waive balances, or accept card details spoken aloud."""


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


def pay_tool_definition(connector_name: str, description: str) -> dict[str, str]:
    return {
        "connector_name": connector_name,
        "currency": "USD",
        "payment_method": "credit-card",
        "description": description,
    }


def ensure_pay_tool(api_key: str, connector_name: str, description: str) -> str:
    definition = pay_tool_definition(connector_name, description)
    payload = {
        "type": "pay",
        "display_name": "Pay (BETA)",
        "pay": definition,
        "timeout_ms": 5000,
    }
    tools = request_json("GET", "/ai/tools?page[size]=100", api_key).get("data", [])
    for tool in tools:
        tool_definition = tool.get("tool_definition") or tool.get("pay") or {}
        if tool.get("type") == "pay" and tool_definition.get("connector_name") == connector_name:
            request_json("PATCH", f"/ai/tools/{tool['id']}", api_key, json=payload)
            return tool["id"]
    return request_json("POST", "/ai/tools", api_key, json=payload)["id"]


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
    payment_description = os.getenv("PAYMENT_DESCRIPTION", DEFAULT_PAYMENT_DESCRIPTION)
    customer = customer_context()

    ensure_pay_connector(api_key, pay_connector_name, f"{public_base_url.rstrip('/')}/webhooks/payment-processor")
    pay_tool_id = ensure_pay_tool(api_key, pay_connector_name, payment_description)

    payload = {
        "name": assistant_name,
        "model": os.getenv("AI_MODEL", DEFAULT_MODEL),
        "instructions": instructions(customer),
        "greeting": "hi, you have reached the ai pci protected payment collection line. i can explain your account status, answer basic billing questions, help set up a payment plan, and start secure keypad payment collection when you are ready. to protect your account, what is your full name?",
        "description": "ai pci protected payment collection assistant that explains account status, supports payment plans, and starts telnyx pay over voice for secure keypad card entry.",
        "enabled_features": ["telephony"],
        "telephony_settings": {"disable_dtmf": True},
        "tool_ids": [pay_tool_id],
    }
    assistant_id = find_assistant(api_key, assistant_name)
    if assistant_id:
        assistant = request_json("POST", f"/ai/assistants/{assistant_id}", api_key, json=payload)
    else:
        assistant = request_json("POST", "/ai/assistants", api_key, json=payload)

    print(f"TELNYX_ASSISTANT_ID={assistant['id']}")
    print(f"AI_MODEL={payload['model']}")
    print(f"PAY_CONNECTOR_NAME={pay_connector_name}")
    print(f"PAY_TOOL_ID={pay_tool_id}")
    print(f"PUBLIC_BASE_URL={public_base_url.rstrip('/')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"provisioning failed: {exc}", file=sys.stderr)
        raise
