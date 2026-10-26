# SELF-REVIEW:
# \u2705 All spec primitives implemented: dedicated IP purchase, warm-up, IP pool,
#    pool membership, email send \u2014 via raw REST (SDK lacks dedicated_ips/ip_pools)
# \u2705 Idempotency-Key header sent on POST /email/dedicated_ips (required, else 400/10015)
# \u2705 Demo mode default (DEMO_MODE=true) \u2014 no billed purchase, no real email
# \u2705 Live mode polls GET /email/dedicated_ips/{id} until warming_up + dns_confirmed
# \u2705 422 start_warmup case demonstrated in live mode (second call on warming_up IP)
# \u2705 smoke_test.py verifies routes and module load
# \u2705 No credentials in code; all from env via dotenv
# ASSUMPTION: The spec's "client script" is exposed as a Flask app with a
#   /run endpoint plus a CLI entrypoint (`python app.py`). The demo flow is a
#   single orchestrated function `run_provisioning_flow()` invoked by both.
# ASSUMPTION: `requests` is used for the dedicated_ips and ip_pools endpoints
#   because the installed telnyx SDK (4.189.0) has no typed resources for them.
#   The email send uses the SDK (`client.email_messages.create`) as the spec allows.

"""Provision and Route Email Dedicated IPs.

Provisions a dedicated IP, starts its warm-up, creates a default IP pool,
adds the IP to the pool, and sends a test email to verify routing.

Endpoints used:
  POST /email/dedicated_ips
  POST /email/dedicated_ips/{id}/actions/start_warmup
  POST /email/ip_pools
  POST /email/ip_pools/{id}/ips
  POST /email_messages
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from typing import Any

import requests
import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify

load_dotenv()

API_BASE = "https://api.telnyx.com/v2"
REGION = "ewr-nj1"
IP_VERSION = "ipv4"

app = Flask(__name__)

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
EMAIL_FROM = os.getenv("TELNYX_EMAIL_FROM", "")
EMAIL_TO = os.getenv("TELNYX_EMAIL_TO", "")
WARMUP_TIMEOUT = int(os.getenv("WARMUP_TIMEOUT_SECONDS", "300"))
POLL_INTERVAL = int(os.getenv("WARMUP_POLL_INTERVAL_SECONDS", "10"))

if TELNYX_API_KEY:
    telnyx.api_key = TELNYX_API_KEY


class TelnyxApiError(RuntimeError):
    """Raised when the Telnyx REST API returns a non-success status."""

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Telnyx API error {status}: {body}")


def _headers(idempotency_key: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _post(path: str, payload: dict[str, Any], idempotency_key: str | None = None) -> dict[str, Any]:
    resp = requests.post(
        f"{API_BASE}{path}",
        json=payload,
        headers=_headers(idempotency_key),
        timeout=30,
    )
    if resp.status_code >= 400:
        raise TelnyxApiError(resp.status_code, _safe_json(resp))
    return _safe_json(resp)


def _get(path: str) -> dict[str, Any]:
    resp = requests.get(f"{API_BASE}{path}", headers=_headers(), timeout=30)
    if resp.status_code >= 400:
        raise TelnyxApiError(resp.status_code, _safe_json(resp))
    return _safe_json(resp)


def _safe_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text[:500]}


def purchase_dedicated_ip() -> dict[str, Any]:
    """POST /email/dedicated_ips \u2014 requires Idempotency-Key."""
    body = _post(
        "/email/dedicated_ips",
        {"region": REGION, "ip_version": IP_VERSION},
        idempotency_key=str(uuid.uuid4()),
    )
    return body["data"]


def start_warmup(ip_id: str) -> dict[str, Any]:
    """POST /email/dedicated_ips/{id}/actions/start_warmup."""
    return _post(f"/email/dedicated_ips/{ip_id}/actions/start_warmup", {})


def create_default_pool(name: str) -> dict[str, Any]:
    """POST /email/ip_pools with is_default=true."""
    body = _post("/email/ip_pools", {"name": name, "is_default": True})
    return body["data"]


def add_ip_to_pool(pool_id: str, ip_id: str) -> dict[str, Any]:
    """POST /email/ip_pools/{id}/ips."""
    return _post(f"/email/ip_pools/{pool_id}/ips", {"dedicated_ip_id": ip_id})


def get_dedicated_ip(ip_id: str) -> dict[str, Any]:
    """GET /email/dedicated_ips/{id}."""
    return _get(f"/email/dedicated_ips/{ip_id}")["data"]


def wait_for_send_ready(ip_id: str) -> dict[str, Any]:
    """Poll until status == warming_up AND provisioning.dns_status == dns_confirmed."""
    deadline = time.monotonic() + WARMUP_TIMEOUT
    while time.monotonic() < deadline:
        data = get_dedicated_ip(ip_id)
        provisioning = data.get("provisioning") or {}
        if data.get("status") == "warming_up" and provisioning.get("dns_status") == "dns_confirmed":
            return data
        time.sleep(POLL_INTERVAL)
    raise TimeoutError("IP not send-ready; mail may be held by the pool")


def send_test_email() -> dict[str, Any]:
    """POST /email_messages via the SDK (answer #3: 202 + status queued + message id)."""
    client = telnyx.Client(api_key=TELNYX_API_KEY)
    message = client.email_messages.create(
        from_=EMAIL_FROM,
        to=[EMAIL_TO],
        subject="Dedicated IP routing verification",
        text_body="This message verifies routing through the dedicated IP pool.",
    )
    payload = message.model_dump(exclude_none=True)
    status = payload.get("status")
    message_id = payload.get("id")
    if status != "queued" or not message_id:
        raise RuntimeError(
            f"Routing check failed: expected status 'queued' with a message id, got {payload}"
        )
    return payload


def run_provisioning_flow() -> dict[str, Any]:
    """Orchestrate the full demo flow. Returns a JSON-serializable summary."""
    result: dict[str, Any] = {"demo_mode": DEMO_MODE}

    if DEMO_MODE:
        result["dedicated_ip"] = {
            "id": "demo-ip-uuid",
            "ip_address": "203.0.113.10",
            "status": "provisioning",
            "region": REGION,
            "ip_version": IP_VERSION,
        }
        result["warmup"] = {"status": "warming_up", "dns_status": "dns_confirmed"}
        result["pool"] = {"id": "demo-pool-uuid", "name": "demo-default-pool", "is_default": True}
        result["pool_membership"] = {"dedicated_ip_id": "demo-ip-uuid", "added": True}
        result["warmup_422_demo"] = {
            "status": 422,
            "note": "Second start_warmup on a warming_up IP returns 422 (demonstrated in live mode).",
        }
        result["email"] = {
            "id": "demo-message-uuid",
            "status": "queued",
            "note": "Demo mode: no real email sent.",
        }
        return result

    if not TELNYX_API_KEY:
        raise RuntimeError("TELNYX_API_KEY is required in live mode")
    if not EMAIL_FROM or not EMAIL_TO:
        raise RuntimeError("TELNYX_EMAIL_FROM and TELNYX_EMAIL_TO are required in live mode")

    ip = purchase_dedicated_ip()
    result["dedicated_ip"] = ip
    ip_id = ip["id"]

    start_warmup(ip_id)
    ready = wait_for_send_ready(ip_id)
    result["warmup"] = {
        "status": ready.get("status"),
        "dns_status": (ready.get("provisioning") or {}).get("dns_status"),
    }

    pool = create_default_pool(f"dip-pool-{uuid.uuid4().hex[:8]}")
    result["pool"] = pool
    add_ip_to_pool(pool["id"], ip_id)
    result["pool_membership"] = {"dedicated_ip_id": ip_id, "pool_id": pool["id"], "added": True}

    # Demonstrate the 422 case: second start_warmup on a warming_up IP.
    try:
        start_warmup(ip_id)
        result["warmup_422_demo"] = {"status": 200, "note": "Unexpected: second warmup succeeded"}
    except TelnyxApiError as exc:
        result["warmup_422_demo"] = {"status": exc.status, "body": exc.body}

    message = send_test_email()
    result["email"] = message
    return result


@app.route("/health", methods=["GET"])
def health() -> tuple[dict[str, Any], int]:
    return {"status": "ok", "demo_mode": DEMO_MODE}, 200


@app.route("/run", methods=["POST"])
def run() -> tuple[dict[str, Any], int]:
    try:
        return jsonify(run_provisioning_flow()), 200
    except TimeoutError as exc:
        app.logger.warning("Warm-up timeout: %s", exc)
        return {"error": "IP not send-ready; mail may be held by the pool"}, 504
    except TelnyxApiError as exc:
        app.logger.exception("Telnyx API error")
        return {"error": "Telnyx API request failed", "status": exc.status}, 502
    except Exception:
        app.logger.exception("Provisioning flow failed")
        return {"error": "Internal server error"}, 500


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        try:
            import json

            print(json.dumps(run_provisioning_flow(), indent=2))
        except Exception as exc:  # noqa: BLE001 - CLI surface
            print(f"Flow failed: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
