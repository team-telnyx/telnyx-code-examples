#!/usr/bin/env python3
"""PCI-protected payment collection voice demo.

Inbound calls are handled with Telnyx Voice API. The app verifies the caller,
starts a Telnyx AI Assistant for the conversation, then exposes a webhook tool
the assistant can call to start Telnyx Pay over Voice.
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from uuid import uuid4

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
PAY_CONNECTOR_NAME = os.getenv("PAY_CONNECTOR_NAME", "Default")
PAYMENT_DESCRIPTION = os.getenv("PAYMENT_DESCRIPTION", "pci protected payment collection")
TELNYX_ASSISTANT_ID = os.getenv("TELNYX_ASSISTANT_ID", "")
TOOL_SECRET = os.getenv("TOOL_SECRET", "")
DEMO_CUSTOMER_ID = os.getenv("DEMO_CUSTOMER_ID", "acct_1042")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

API = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

telnyx_client = telnyx.Telnyx(api_key=TELNYX_API_KEY, public_key=TELNYX_PUBLIC_KEY)

DATA_DIR = Path(__file__).parent / "data"
CUSTOMERS = json.loads((DATA_DIR / "customers.json").read_text())

EVENT_TTL_SECONDS = 3600
processed_events: dict[str, float] = {}
active_calls: dict[str, dict[str, Any]] = {}
completed_sessions: list[dict[str, Any]] = []
demo_events: list[dict[str, Any]] = []


@dataclass(frozen=True)
class PaymentPlan:
    installment_amount: Decimal
    weekly_payments: int
    final_amount: Decimal

    @property
    def first_charge(self) -> Decimal:
        return self.installment_amount

    def summary(self) -> str:
        amount = money(self.installment_amount)
        if self.final_amount > Decimal("0.00"):
            return f"{self.weekly_payments} weekly payments of {amount} plus a final payment of {money(self.final_amount)}"
        return f"{self.weekly_payments} weekly payments of {amount}"


def _cleanup_loop() -> None:
    while True:
        time.sleep(300)
        cutoff = time.time() - EVENT_TTL_SECONDS
        for event_id, ts in list(processed_events.items()):
            if ts < cutoff:
                processed_events.pop(event_id, None)
        for call_control_id, call in list(active_calls.items()):
            if call.get("last_seen", 0) < cutoff:
                active_calls.pop(call_control_id, None)


threading.Thread(target=_cleanup_loop, daemon=True).start()


def money(value: Decimal | float | str) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"${amount}"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def event(label: str, detail: str, call_control_id: str | None = None, pii: bool = False) -> None:
    demo_events.append(
        {
            "time": now_iso(),
            "label": label,
            "detail": detail,
            "call_control_id": call_control_id,
            "pii": pii,
        }
    )
    del demo_events[:-100]


def _already_processed(event_id: str | None) -> bool:
    if not event_id:
        return False
    if event_id in processed_events:
        return True
    processed_events[event_id] = time.time()
    return False


def _verify_webhook() -> bool:
    if not TELNYX_PUBLIC_KEY:
        app.logger.warning("TELNYX_PUBLIC_KEY is not set; webhook signature verification skipped")
        return True
    try:
        telnyx_client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
        return True
    except Exception as exc:
        app.logger.warning("Invalid Telnyx webhook signature: %s", exc)
        return False


def _verify_tool_request() -> bool:
    if not TOOL_SECRET:
        return True
    return request.headers.get("X-Demo-Tool-Secret") == TOOL_SECRET


def _validate_call_control_id(call_control_id: str) -> str:
    if isinstance(call_control_id, str) and re.fullmatch(r"[A-Za-z0-9_:\-]{1,180}", call_control_id):
        return call_control_id
    return ""


def phone_from_payload(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("phone_number") or value.get("number") or value.get("sip_uri") or ""
    return str(value or "")


def _telnyx_post(path: str, body: dict[str, Any], timeout: int = 15) -> dict[str, Any] | None:
    if not TELNYX_API_KEY:
        app.logger.error("TELNYX_API_KEY is required before calling Telnyx")
        return None
    url = f"{API}{path}"
    try:
        response = requests.post(url, headers=HEADERS, json=body, timeout=timeout)
        call_match = re.search(r"/calls/([^/]+)(?:/|$)", path)
        call_control_id = call_match.group(1) if call_match else None
        event_path = re.sub(r"/calls/([^/]+)", "/calls/current", path)
        if response.status_code >= 400:
            app.logger.error("Telnyx command failed: %s -> %s", url, response.text[:800])
            event("telnyx command failed", f"{event_path} -> {response.status_code}: {response.text[:220]}", call_control_id)
        response.raise_for_status()
        result = response.json()
        event("telnyx command sent", f"{event_path} -> {response.status_code}", call_control_id)
        return result
    except Exception as exc:
        app.logger.error("Telnyx command error: %s -> %s", url, exc)
        call_match = re.search(r"/calls/([^/]+)(?:/|$)", path)
        call_control_id = call_match.group(1) if call_match else None
        event_path = re.sub(r"/calls/([^/]+)", "/calls/current", path)
        event("telnyx command error", f"{event_path}: {exc}", call_control_id)
        return None


def answer_call(call_control_id: str) -> None:
    _telnyx_post(f"/calls/{call_control_id}/actions/answer", {"command_id": str(uuid4())})


def start_ai_assistant(call_control_id: str) -> dict[str, Any] | None:
    if not TELNYX_ASSISTANT_ID:
        event("assistant missing", "set TELNYX_ASSISTANT_ID before placing calls", call_control_id)
        return None
    return _telnyx_post(
        f"/calls/{call_control_id}/actions/ai_assistant_start",
        {
            "assistant": {"id": TELNYX_ASSISTANT_ID},
            "command_id": str(uuid4()),
            "send_message_history_updates": True,
        },
    )


def start_pay_session(
    call_control_id: str,
    amount: Decimal,
    plan_summary: str,
    customer_id: str = "acct_1042",
) -> bool:
    pay_amount = str(amount.quantize(Decimal("0.01")))
    body = {
        "connector_name": PAY_CONNECTOR_NAME,
        "amount": pay_amount,
        "currency": "USD",
        "payment_method": "credit-card",
        "description": PAYMENT_DESCRIPTION,
    }
    response = _telnyx_post(f"/calls/{call_control_id}/pay", body)
    if response:
        event("pci pause", "pay over voice started with the telnyx docs-minimum request; telnyx now masks recording, transcription, assistant audio, and dtmf logging.", call_control_id)
        active_calls.setdefault(call_control_id, {"last_seen": time.time(), "history": []})
        active_calls[call_control_id]["step"] = "pay"
        active_calls[call_control_id]["payment_started_at"] = now_iso()
        active_calls[call_control_id]["payment_completed_by_telnyx"] = False
        active_calls[call_control_id]["plan_summary"] = plan_summary
        active_calls[call_control_id]["customer_id"] = customer_id
        active_calls[call_control_id]["first_charge"] = pay_amount
        return True
    return False


def encode_state(value: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(value).encode()).decode()


def decode_state(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        decoded = base64.b64decode(value).decode()
        parsed = json.loads(decoded)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def payment_event_detail(values: dict[str, Any]) -> str:
    parts = []
    step = values.get("payment_step")
    status = values.get("payment_status") or values.get("status") or values.get("result")
    card_type = values.get("payment_card_type")
    card_number = values.get("payment_card_number")
    charge_id = values.get("charge_id") or values.get("token_id")
    error = values.get("pay_error_code") or values.get("payment_error")
    if step:
        parts.append(f"step={step}")
    if status:
        parts.append(f"status={status}")
    if card_type:
        parts.append(f"card_type={card_type}")
    if card_number:
        parts.append(f"masked_card={card_number}")
    if charge_id:
        parts.append(f"id={charge_id}")
    if error:
        parts.append(f"error={error}")
    return ", ".join(parts) or "pay over voice event received"


def parse_amount(value: Any) -> Decimal | None:
    if value is None:
        return None
    match = re.search(r"\d+(?:\.\d{1,2})?", str(value).replace(",", ""))
    if not match:
        return None
    return Decimal(match.group(0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def build_plan(balance: Decimal, requested: Decimal | None) -> PaymentPlan:
    minimum = Decimal("20.00")
    weekly = requested or Decimal("50.00")
    if weekly < minimum:
        weekly = minimum
    if weekly > balance:
        weekly = balance
    count = int(balance // weekly)
    remainder = (balance - (weekly * count)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if count == 0:
        count = 1
        remainder = Decimal("0.00")
    if count > 12:
        count = 12
        weekly = (balance / Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        remainder = (balance - (weekly * 12)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return PaymentPlan(weekly, count, remainder)


def active_call_id_from_request(body: dict[str, Any]) -> str:
    explicit = _validate_call_control_id(str(body.get("call_control_id") or ""))
    if explicit:
        return explicit
    active = [
        (call_control_id, call)
        for call_control_id, call in active_calls.items()
        if call.get("step") not in {"paid", "hangup"}
    ]
    if not active:
        return ""
    active.sort(key=lambda item: item[1].get("last_seen", 0), reverse=True)
    return active[0][0]


def latest_call_id_from_request(body: dict[str, Any]) -> str:
    explicit = _validate_call_control_id(str(body.get("call_control_id") or ""))
    if explicit:
        return explicit
    active = [
        (call_control_id, call)
        for call_control_id, call in active_calls.items()
        if call.get("step") != "hangup"
    ]
    if not active:
        return ""
    active.sort(key=lambda item: item[1].get("last_seen", 0), reverse=True)
    return active[0][0]


@app.route("/webhooks/voice", methods=["POST"])
def handle_voice() -> tuple[Any, int]:
    if not _verify_webhook():
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid request body"}), 400

    data = payload.get("data", {})
    event_id = data.get("id")
    if _already_processed(event_id):
        return jsonify({"status": "duplicate"}), 200

    event_type = data.get("event_type", "")
    event_payload = data.get("payload", {})
    call_control_id = _validate_call_control_id(event_payload.get("call_control_id", ""))

    event("webhook received", event_type or "unknown", call_control_id)

    if call_control_id:
        active_calls.setdefault(call_control_id, {"last_seen": time.time(), "history": []})
        active_calls[call_control_id]["last_seen"] = time.time()

    if event_type == "call.initiated" and event_payload.get("direction") == "incoming" and call_control_id:
        caller = phone_from_payload(event_payload.get("from", ""))
        active_calls[call_control_id].update({"step": "answering", "caller": caller, "attempts": 0})
        event("call started", "inbound billing call received", call_control_id)
        answer_call(call_control_id)
        return jsonify({"status": "answering"}), 200

    if event_type == "call.answered" and call_control_id:
        active_calls[call_control_id]["step"] = "assistant"
        response = start_ai_assistant(call_control_id)
        conversation_id = (response or {}).get("data", {}).get("conversation_id")
        if conversation_id:
            active_calls[call_control_id]["conversation_id"] = conversation_id
            event("assistant started", f"conversation {conversation_id}", call_control_id)
        return jsonify({"status": "assistant_started" if response else "assistant_failed"}), 200

    if event_type in {"call.conversation.ended", "call.conversation_insights.generated"} and call_control_id:
        event("assistant event", event_type, call_control_id)
        return jsonify({"status": "assistant_event"}), 200

    if event_type in {"call_payment_progress", "call.payment.progress"}:
        payment_values = {**data, **event_payload}
        if not call_control_id:
            call_control_id = _validate_call_control_id(decode_state(payment_values.get("client_state")).get("call_control_id", ""))
        event("payment progress", payment_event_detail(payment_values), call_control_id)
        return jsonify({"status": "payment_progress"}), 200

    if event_type in {"call_payment_completed", "call.payment.completed"}:
        payment_values = {**data, **event_payload}
        if not call_control_id:
            call_control_id = _validate_call_control_id(decode_state(payment_values.get("client_state")).get("call_control_id", ""))
        call = active_calls.get(call_control_id, {})
        status = payment_values.get("status") or payment_values.get("result") or "completed"
        call["step"] = "paid"
        call["payment_status"] = status
        call["payment_completed_by_telnyx"] = True
        completed_sessions.append(
            {
                "time": now_iso(),
                "customer": call.get("customer", "jordan lee"),
                "plan": call.get("plan_summary", ""),
                "payment_status": status,
                "payment_proof": payment_event_detail(payment_values),
                "sms": {"sent": False, "reason": "sms disabled"},
            }
        )
        event("payment complete", payment_event_detail(payment_values), call_control_id)
        return jsonify({"status": "payment_completed"}), 200

    if event_type == "call.hangup" and call_control_id:
        active_calls.pop(call_control_id, None)
        event("call ended", "call cleaned up", call_control_id)
        return jsonify({"status": "ended"}), 200

    return jsonify({"status": "ignored", "event_type": event_type}), 200


@app.route("/webhooks/payment-processor", methods=["POST"])
def mock_payment_processor() -> tuple[Any, int]:
    body = request.get_json(silent=True) or {}
    card = str(body.get("cardnumber") or "")
    amount = body.get("amount")
    masked = f"xxxxxxxxxxxx{card[-4:]}" if len(card) >= 4 else "masked"
    if card.endswith("0002"):
        event("processor response", f"declined masked_card={masked}, amount={amount}")
        return jsonify({"error_code": "card_declined", "error_message": "the card was declined."}), 200
    charge_id = f"ch_demo_{int(time.time())}"
    event("processor response", f"approved id={charge_id}, masked_card={masked}, amount={amount}")
    return jsonify({"charge_id": charge_id, "amount": amount, "error_code": None, "error_message": None}), 200


@app.route("/tools/record-payment-complete", methods=["POST"])
def tool_record_payment_complete() -> tuple[Any, int]:
    if not _verify_tool_request():
        return jsonify({"ok": False, "error": "unauthorized tool request"}), 401
    body = request.get_json(silent=True) or {}
    call_control_id = latest_call_id_from_request(body)
    call = active_calls.get(call_control_id, {}) if call_control_id else {}
    plan_summary = str(body.get("plan_summary") or call.get("plan_summary") or "payment plan").lower()
    status = str(body.get("status") or "completed").lower()
    if not call.get("payment_completed_by_telnyx"):
        event("secure payment pending", "assistant checked completion before telnyx sent a payment completion event.", call_control_id)
        return jsonify(
            {
                "ok": False,
                "secure_payment_event": "pending",
                "message": "do not say the payment is complete yet. wait for telnyx pay over voice to finish and send a payment completion event.",
                "plan_summary": plan_summary,
            }
        ), 409
    if call_control_id:
        call["step"] = "paid"
        call["payment_status"] = status
    completed_sessions.append(
        {
            "time": now_iso(),
            "customer": call.get("customer", "jordan lee"),
            "plan": plan_summary,
            "payment_status": status,
            "payment_proof": "assistant recorded secure payment completion. sensitive keypad details were not logged.",
            "sms": {"sent": False, "reason": "sms disabled"},
        }
    )
    event("secure payment complete", "assistant recorded completion. sensitive keypad details were not logged.", call_control_id)
    return jsonify(
        {
            "ok": True,
            "secure_payment_event": "completed",
            "pci_scope": "payment completion was recorded without card number, expiration date, cvv, zip, or raw dtmf.",
            "message": "secure payment completion has been recorded for the demo. do not mention or expose card details.",
            "plan_summary": plan_summary,
        }
    ), 200


@app.route("/tools/start-secure-payment", methods=["POST"])
def tool_start_secure_payment() -> tuple[Any, int]:
    if not _verify_tool_request():
        return jsonify({"ok": False, "error": "unauthorized tool request"}), 401
    body = request.get_json(silent=True) or {}
    call_control_id = active_call_id_from_request(body)
    event("secure payment tool requested", "assistant requested telnyx pay over voice.", call_control_id or None)
    if not call_control_id:
        return jsonify({"ok": False, "error": "no active call found"}), 400

    requested = parse_amount(body.get("amount_now") or body.get("weekly_amount"))
    if requested is None:
        requested = Decimal("40.00")
    customer_id = str(body.get("customer_id") or DEMO_CUSTOMER_ID)
    customer = CUSTOMERS.get(customer_id) or next(iter(CUSTOMERS.values()))
    balance = Decimal(str(customer["balance_usd"]))
    plan = build_plan(balance, requested)
    plan_summary = str(body.get("plan_summary") or plan.summary()).lower()

    active_calls.setdefault(call_control_id, {"last_seen": time.time(), "history": []})
    active_calls[call_control_id]["customer"] = str(customer["name"]).lower()
    active_calls[call_control_id]["plan_summary"] = plan_summary
    active_calls[call_control_id]["first_charge"] = str(plan.first_charge)

    started = start_pay_session(
        call_control_id,
        amount=plan.first_charge,
        plan_summary=plan_summary,
        customer_id=str(customer["id"]),
    )
    if not started:
        event("pay over voice failed", "telnyx did not accept the protected payment command.", call_control_id)
        return jsonify({"ok": False, "error": "could not start telnyx pay over voice"}), 502
    event("pay over voice started", "telnyx accepted the protected keypad payment command.", call_control_id)

    return jsonify(
        {
            "ok": True,
            "secure_payment_event": "started",
            "pci_scope": "telnyx pay over voice is now collecting payment details by keypad outside the assistant transcript.",
            "message": "secure payment collection has started. tell the caller to use the keypad and do not ask them to speak card details.",
            "plan_summary": plan_summary,
            "amount_now": str(plan.first_charge),
        }
    ), 200


@app.route("/health", methods=["GET"])
def health() -> tuple[Any, int]:
    return jsonify(
        {
            "status": "ok",
            "telnyx_configured": bool(TELNYX_API_KEY),
            "pay_connector": "secure payment connector",
            "assistant_configured": bool(TELNYX_ASSISTANT_ID),
            "active_calls": len(active_calls),
            "completed_sessions": len(completed_sessions),
        }
    ), 200


@app.route("/events", methods=["GET"])
def list_events() -> tuple[Any, int]:
    return jsonify({"events": demo_events[-100:], "total": len(demo_events)}), 200


@app.route("/sessions", methods=["GET"])
def list_sessions() -> tuple[Any, int]:
    return jsonify({"sessions": completed_sessions[-50:], "total": len(completed_sessions)}), 200


@app.route("/", methods=["GET"])
def dashboard() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI PCI Protected Payment Collection</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #182026;
      --muted: #66717d;
      --line: #dfe5ea;
      --panel: #ffffff;
      --wash: #f5f7f8;
      --green: #168a5b;
      --green-bg: #e8f6ef;
      --blue: #2563b8;
      --blue-bg: #eaf1fb;
      --amber: #9a6500;
      --amber-bg: #fff4dc;
      --red: #ba312b;
      --red-bg: #feecec;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--wash); }
    header { padding: 18px 28px; color: white; background: #101820; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 14px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 16px; padding: 16px 28px 28px; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .subtle { color: #cbd5df; max-width: 760px; }
    .kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .kpi { border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-height: 74px; }
    .kpi span { display: block; color: var(--muted); font-size: 12px; }
    .kpi strong { display: block; margin-top: 4px; font-size: 20px; line-height: 1.2; }
    .steps { display: grid; gap: 10px; margin-top: 16px; }
    .step { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; color: var(--muted); }
    .dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; border: 1px solid var(--line); background: #f8fafb; color: var(--muted); }
    .step.done { color: var(--ink); }
    .step.done .dot { background: var(--green-bg); color: var(--green); border-color: #b7e2cc; }
    .step.active .dot { background: var(--blue-bg); color: var(--blue); border-color: #bad2f5; }
    .proof { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .proof div { border-radius: 8px; padding: 10px 12px; background: #f8fafb; border: 1px solid var(--line); }
    .proof span { display: block; color: var(--muted); font-size: 12px; }
    .proof strong { display: block; margin-top: 4px; font-size: 15px; overflow-wrap: anywhere; }
    .stream { display: grid; gap: 8px; max-height: 58vh; overflow: auto; padding-right: 4px; }
    .event { display: grid; grid-template-columns: 88px minmax(160px, 220px) minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .time { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .pill { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: 12px; background: #edf1f4; color: #4d5964; }
    .pci { background: var(--green-bg); color: var(--green); }
    .voice { background: var(--blue-bg); color: var(--blue); }
    .warn { background: var(--amber-bg); color: var(--amber); }
    .error { background: var(--red-bg); color: var(--red); }
    .detail { color: #33404a; overflow-wrap: anywhere; }
    .bar { height: 9px; overflow: hidden; border-radius: 999px; background: #e9edf1; margin-top: 12px; }
    .bar span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #168a5b, #2563b8); transition: width .25s ease; }
    .empty { padding: 18px; color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; text-align: center; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; padding: 14px; } header { align-items: flex-start; flex-direction: column; padding: 16px 14px; } .proof { grid-template-columns: 1fr; } .event { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>AI PCI Protected Payment Collection</h1>
      <div class="subtle">AI negotiates the plan. Telnyx Pay over Voice collects keypad payment details outside the assistant transcript.</div>
    </div>
    <div id="clock" class="subtle"></div>
  </header>
  <main>
    <section>
      <h2>Run Status</h2>
      <div class="kpis">
        <div class="kpi"><span>Service</span><strong id="status">checking</strong></div>
        <div class="kpi"><span>Active calls</span><strong id="calls">0</strong></div>
        <div class="kpi"><span>Payment rail</span><strong id="connector"></strong></div>
        <div class="kpi"><span>Completed</span><strong id="completed">0</strong></div>
      </div>
      <div class="bar"><span id="progress"></span></div>
      <div class="steps">
        <div class="step" id="s-call"><div class="dot">1</div><div>call answered</div></div>
        <div class="step" id="s-assistant"><div class="dot">2</div><div>assistant started</div></div>
        <div class="step" id="s-tool"><div class="dot">3</div><div>secure payment tool called</div></div>
        <div class="step" id="s-pay"><div class="dot">4</div><div>pay over voice started</div></div>
        <div class="step" id="s-complete"><div class="dot">5</div><div>payment event received</div></div>
      </div>
    </section>
    <section>
      <h2>Live PCI Proof</h2>
      <div class="proof">
        <div><span>secure tool</span><strong id="proof-tool">waiting</strong></div>
        <div><span>pay command</span><strong id="proof-pay">waiting</strong></div>
        <div><span>sensitive digits</span><strong>not logged</strong></div>
      </div>
      <div class="stream" id="events"><div class="empty">No events yet.</div></div>
    </section>
    <section style="grid-column: 1 / -1;">
      <h2>Completed Sessions</h2>
      <div class="stream" id="sessions"><div class="empty">No completed sessions yet.</div></div>
    </section>
  </main>
  <script>
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    }
    async function refresh() {
      const health = await fetch('/health').then(r => r.json());
      const events = await fetch('/events').then(r => r.json());
      const sessions = await fetch('/sessions').then(r => r.json());
      const items = events.events || [];
      const hasCall = items.some(e => e.label === 'call started' || e.detail === 'call.answered');
      const hasAssistant = items.some(e => e.label === 'assistant started' || e.detail === 'call.conversation.messages_added');
      const hasTool = items.some(e => e.label === 'secure payment tool requested' || e.label === 'pci pause' || e.detail.includes('/pay'));
      const hasPay = items.some(e => e.label === 'pci pause' || e.label === 'payment progress' || e.label === 'payment complete');
      const hasComplete = items.some(e => e.label === 'payment progress' || e.label === 'payment complete' || e.label === 'secure payment complete');
      const progress = [hasCall, hasAssistant, hasTool, hasPay, hasComplete].filter(Boolean).length;
      document.getElementById('clock').textContent = new Date().toLocaleTimeString();
      document.getElementById('status').textContent = health.status;
      document.getElementById('connector').textContent = health.pay_connector;
      document.getElementById('calls').textContent = health.active_calls;
      document.getElementById('completed').textContent = health.completed_sessions;
      document.getElementById('progress').style.width = `${progress * 20}%`;
      [['s-call', hasCall], ['s-assistant', hasAssistant], ['s-tool', hasTool], ['s-pay', hasPay], ['s-complete', hasComplete]].forEach(([id, done], index) => {
        const node = document.getElementById(id);
        node.className = `step ${done ? 'done' : (index === progress ? 'active' : '')}`;
      });
      document.getElementById('proof-tool').textContent = hasTool ? 'started' : 'waiting';
      document.getElementById('proof-pay').textContent = hasPay ? 'active' : 'waiting';
      document.getElementById('events').innerHTML = items.slice(-35).reverse().map(e => {
        const label = String(e.label || '');
        const detail = String(e.detail || '');
        const klass = label.includes('pci') || label.includes('payment') || label.includes('processor') ? 'pci' : (label.includes('failed') || label.includes('error') ? 'error' : (label.includes('webhook') || label.includes('assistant') || label.includes('call') ? 'voice' : (e.pii ? 'warn' : '')));
        const time = new Date(e.time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'});
        return `<div class="event"><div class="time">${esc(time)}</div><div><span class="pill ${klass}">${esc(label)}</span></div><div class="detail">${esc(detail)}</div></div>`;
      }).join('') || '<div class="empty">No events yet.</div>';
      document.getElementById('sessions').innerHTML = sessions.sessions.slice().reverse().map(s => {
        const proof = s.payment_proof ? `<div class="detail">${esc(s.payment_proof)}</div>` : '';
        return `<div class="event"><div class="time">${esc(new Date(s.time).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'}))}</div><div><span class="pill pci">${esc(s.payment_status)}</span></div><div class="detail"><strong>${esc(s.customer)}</strong> · ${esc(s.plan)}${proof}</div></div>`;
      }).join('') || '<div class="empty">No completed sessions yet.</div>';
    }
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>"""


if __name__ == "__main__":
    app.run(debug=False, host=HOST, port=PORT, threaded=True)
