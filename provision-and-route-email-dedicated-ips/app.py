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
# Optional: resume a previous live run's IP instead of purchasing a new one.
# Every purchase starts a $14/month MRC, so a plain re-run buys a second IP.
REUSE_DEDICATED_IP_ID = os.getenv("REUSE_DEDICATED_IP_ID", "")

class TelnyxApiError(RuntimeError):
    """Raised when the Telnyx REST API returns a non-success status."""

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Telnyx API error {status}: {body}")


class PreflightError(RuntimeError):
    """Raised when the pre-purchase email-setup check finds a known blocker.

    The message is user-facing instructional text (no secrets), so the HTTP
    route returns it in the response body.
    """


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


def find_default_pool() -> dict[str, Any] | None:
    """Return the account's existing default pool, if any (GET /email/ip_pools)."""
    pools = _get("/email/ip_pools").get("data", [])
    return next((p for p in pools if p.get("is_default")), None)


def resolve_default_pool(name: str) -> dict[str, Any]:
    """Reuse the account's existing default pool, or create one.

    An account has at most one default pool; accounts that already send email
    usually have one, and creating a second returns an error.
    """
    existing = find_default_pool()
    if existing:
        return existing
    return create_default_pool(name)


def add_ip_to_pool(pool_id: str, ip_id: str) -> dict[str, Any]:
    """POST /email/ip_pools/{id}/ips."""
    return _post(f"/email/ip_pools/{pool_id}/ips", {"dedicated_ip_id": ip_id})


def pool_has_ip(pool_id: str, ip_id: str) -> bool:
    """Check pool membership without adding (GET /email/ip_pools/{id})."""
    pool = _get(f"/email/ip_pools/{pool_id}")
    ips = pool.get("data", {}).get("ips", []) or []
    return any(m.get("id") == ip_id for m in ips)


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
    raise TimeoutError(
        f"IP not send-ready; mail may be held by the pool. "
        f"Re-run with REUSE_DEDICATED_IP_ID={ip_id} to resume this IP's warm-up "
        f"instead of purchasing a new one."
    )


def list_email_domains() -> list[dict[str, Any]]:
    """GET /email_domains — best effort; returns [] when the API is unavailable."""
    try:
        return _get("/email_domains").get("data", [])
    except TelnyxApiError:
        return []


def whoami_email() -> str:
    """Best-effort account owner email via GET /whoami (read-only)."""
    try:
        return (_get("/whoami").get("data") or {}).get("user_email", "")
    except TelnyxApiError:
        return ""


def preflight_email_setup() -> list[str]:
    """Validate the email setup BEFORE the billed IP purchase.

    Raises RuntimeError on a known blocker (FROM domain not verified); returns
    non-fatal warnings otherwise. The purchase starts a $14/month MRC, so it
    must never run with a from-address that cannot send.
    """
    warnings: list[str] = []
    domains = list_email_domains()
    from_domain = EMAIL_FROM.rsplit("@", 1)[-1].lower() if EMAIL_FROM else ""
    verified = [d for d in domains if d.get("usable_for_sending") or d.get("status") == "verified"]
    match = next((d for d in verified if d.get("domain", "").lower() == from_domain), None)

    if not domains:
        warnings.append(
            "Could not list sending domains; skipping domain preflight. "
            "The final send may fail if TELNYX_EMAIL_FROM is not a verified domain."
        )
    elif not match:
        raise PreflightError(
            f"'{from_domain}' is not a verified sending domain on this account, so the "
            "purchase would be billed and the email send would fail. Register and verify "
            "your domain first (POST /email_domains, publish the DNS records, then "
            "POST /email_domains/{id}/verify), or use a shared domain with zero setup: "
            "TELNYX_EMAIL_FROM=onboarding@mail.telnyx.com (recipients must be the account "
            "owner's verified email address)."
        )
    elif match.get("type") == "shared":
        warnings.append(
            "Shared sending domain detected: reputation is not isolated to this account. "
            "Verify a custom domain for production sending."
        )
        owner_email = whoami_email()
        if owner_email and EMAIL_TO.strip().lower() != owner_email.lower():
            warnings.append(
                f"Shared-domain sends are sandboxed to the account's verified email "
                f"({owner_email}); the send step will be rejected with 400 code 10015 "
                "unless TELNYX_EMAIL_TO matches it or a custom domain is verified."
            )
    return warnings


def send_test_email() -> dict[str, Any]:
    """POST /email_messages via the SDK (answer #3: 202 + status queued + message id)."""
    client = telnyx.Client(api_key=TELNYX_API_KEY)
    message = client.email_messages.create(
        from_=EMAIL_FROM,
        to=[EMAIL_TO],
        subject="Dedicated IP routing verification",
        text_body="This message verifies routing through the dedicated IP pool.",
    )
    payload = message.model_dump(mode="json", exclude_none=True)
    # The SDK response dumps as a Telnyx envelope: {"data": {message fields}}.
    data = payload["data"] if isinstance(payload.get("data"), dict) else payload
    status = data.get("status")
    message_id = data.get("id")
    if status != "queued" or not message_id:
        raise RuntimeError(
            f"Routing check failed: expected status 'queued' with a message id, got {data}"
        )
    return data


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

    # Validate the email setup before spending anything: the purchase starts a
    # $14/month MRC and cannot be "un-sent" if the from-address can't deliver.
    result["preflight"] = preflight_email_setup()

    if REUSE_DEDICATED_IP_ID:
        ip = get_dedicated_ip(REUSE_DEDICATED_IP_ID)
        result["dedicated_ip"] = ip
        result["reused_ip"] = True
        ip_id = ip["id"]
        if ip.get("status") == "provisioning":
            start_warmup(ip_id)
    else:
        ip = purchase_dedicated_ip()
        if ip.get("status") != "provisioning" or not ip.get("ip_address"):
            raise RuntimeError(
                f"Unexpected purchase response: expected status 'provisioning' with an "
                f"ip_address, got {ip}"
            )
        result["dedicated_ip"] = ip
        ip_id = ip["id"]
        start_warmup(ip_id)

    ready = wait_for_send_ready(ip_id)
    result["warmup"] = {
        "status": ready.get("status"),
        "dns_status": (ready.get("provisioning") or {}).get("dns_status"),
    }

    pool = resolve_default_pool(f"dip-pool-{uuid.uuid4().hex[:8]}")
    result["pool"] = pool
    if pool_has_ip(pool["id"], ip_id):
        result["pool_membership"] = {
            "dedicated_ip_id": ip_id,
            "pool_id": pool["id"],
            "added": True,
            "already_member": True,
        }
    else:
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
    except PreflightError as exc:
        app.logger.warning("Preflight blocked: %s", exc)
        return {"error": str(exc)}, 400
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

            print(json.dumps(run_provisioning_flow(), indent=2, default=str))
        except Exception as exc:  # noqa: BLE001 - CLI surface
            print(f"Flow failed: {exc}", file=sys.stderr)
            sys.exit(1)
    else:
        app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
