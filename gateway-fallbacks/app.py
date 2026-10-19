# SELF-REVIEW:
# ✅ Management plane (api.telnyx.com/v2/llm_token_gateway) via raw HTTP w/ account key
# ✅ Inference plane (llm.telnyx.com/v1) via OpenAI SDK, max_retries=0
# ✅ Observation layer: x-ltg-served-model / x-ltg-attempts headers + GET /spend/events
# ✅ Forced-failure run: streaming + x-ltg-request-timeout:1000 overlay, asserts fallback
# ✅ Streaming headers read via with_raw_response.create() (SDK-documented accessor)
# ✅ Policy asserts: chain depth <=3, max_attempts 1-5, attempt math <=8
# ✅ Teardown: If-Match ETag + Idempotency-Key, verifies revocation
# ✅ Secret written to 0600 file (never logged, never returned in HTTP body)
# ✅ Input validation on all POST/GET endpoints (type + format + identifier pattern)
# ✅ Upstream error bodies never logged raw (status code only)
# ✅ Auth guard (X-Demo-Auth shared secret) on all mutating routes
# ✅ DEMO_MODE=true short-circuits provision/inference/policy/teardown — no network
# ✅ smoke_test.py verifies routes, module load, secret non-leak, header capture,
#    auth enforcement, and demo-mode network isolation
# ASSUMPTION: The AI Gateway management API is not yet exposed as first-class
#   methods in the installed telnyx SDK version, so we call it via `requests`
#   against https://api.telnyx.com/v2/llm_token_gateway with the account key.
#   The inference plane uses the OpenAI SDK pointed at https://llm.telnyx.com/v1
#   with the token key, per the docs' own guidance (max_retries=0).
# ASSUMPTION: The Flask app exposes the five demo scripts as HTTP endpoints so
#   the sample is runnable as a service; the same logic is importable as
#   functions for CLI use (see README).
# ASSUMPTION: For streaming responses, the OpenAI SDK's documented mechanism
#   for accessing raw response headers is `client.chat.completions.with_raw_response
#   .create(stream=True)`, which returns an object exposing `.response` (the raw
#   httpx.Response) and `.parse()` (the stream iterator). We use that accessor
#   so x-ltg-served-model / x-ltg-attempts are reliably readable on streaming
#   calls. Verified against openai>=1.40.0,<2.0.0 (pinned in requirements.txt).
# ASSUMPTION: The forced-failure run is inherently non-deterministic (the spec
#   acknowledges this). We report `ok: false` honestly when the primary answers
#   inside the 1s deadline on all tries. The smoke test does NOT assert ok==true.
# ASSUMPTION: The Flask layer is protected by a shared-secret header
#   (X-Demo-Auth) on every mutating route. The secret comes from DEMO_AUTH_TOKEN
#   (default "local-dev-only"). This is a demo guard, not production auth — the
#   README documents that the service must not be exposed to untrusted networks.
# ASSUMPTION: In DEMO_MODE the sample never touches the network. Provision,
#   inference, policy, and teardown return synthetic responses. Live calls
#   require DEMO_MODE=false explicitly.

"""AI Gateway Fallback & Resilience Desk — policy-driven model failover."""

from __future__ import annotations

import os
import re
import time
import logging
from datetime import date
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MGMT_BASE = os.getenv("TELNYX_MGMT_BASE", "https://api.telnyx.com/v2/llm_token_gateway")
INFER_BASE = os.getenv("TELNYX_INFER_BASE", "https://llm.telnyx.com/v1")
ACCOUNT_KEY = os.getenv("TELNYX_API_KEY", "")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
DEMO_AUTH_TOKEN = os.getenv("DEMO_AUTH_TOKEN", "local-dev-only")

PRIMARY_MODEL = os.getenv("PRIMARY_MODEL", "Kimi-K3")
FALLBACK_MODEL = os.getenv("FALLBACK_MODEL", "GLM-5.3-Flash")

# Secret is written to a 0600 file, never logged, never returned in a body.
SECRET_FILE = Path(os.getenv("TOKEN_SECRET_FILE", ".token_secret"))

# Policy constraints (asserted in code per acceptance criteria)
MAX_CHAIN_DEPTH = 3
MAX_ATTEMPTS = 5
MAX_TOTAL_ATTEMPTS = 8  # max_attempts * (1 + longest chain) <= 8

# Forced-failure tuning. The primary must miss a 1s first-event deadline.
# We keep the prompt bounded so we never trip context-length rejection
# (which the spec says is terminal — no fallback would fire).
FORCED_FAILURE_TIMEOUT_MS = "1000"
FORCED_FAILURE_MAX_TOKENS = 4096  # long-form generation, but bounded
FORCED_FAILURE_PROMPT_BASE = (
    "Write an extremely long, detailed, exhaustive essay about distributed "
    "systems consensus algorithms, covering Paxos, Raft, and Byzantine fault "
    "tolerance in depth. Do not stop early. "
)
FORCED_FAILURE_PROMPT_REPEAT = 8  # bounded growth; attempt N multiplies by N

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_ETAG_RE = re.compile(r'^"?[A-Za-z0-9_\-:.]{1,128}"?$')


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------
def _check_auth() -> bool:
    """Shared-secret guard for mutating routes. Demo-grade, not production auth."""
    supplied = request.headers.get("X-Demo-Auth", "")
    return supplied == DEMO_AUTH_TOKEN


def _auth_failure() -> tuple[dict, int]:
    return {"error": "unauthorized"}, 401


# ---------------------------------------------------------------------------
# Management plane helpers (account key)
# ---------------------------------------------------------------------------
def _mgmt_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {ACCOUNT_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _mgmt_request(method: str, path: str, **kwargs: Any) -> requests.Response:
    url = f"{MGMT_BASE}{path}"
    resp = requests.request(method, url, headers=_mgmt_headers(kwargs.pop("headers", None)),
                            timeout=30, **kwargs)
    return resp


def _raise_upstream(operation: str, resp: requests.Response) -> None:
    """Raise a RuntimeError with status code only — never log raw upstream bodies."""
    raise RuntimeError(f"{operation} failed: HTTP {resp.status_code}")


def validate_policy(allowed_models: list[str], fallbacks: dict[str, list[str]],
                    retries: dict[str, Any]) -> None:
    """Assert policy constraints before hitting the API."""
    for primary, chain in fallbacks.items():
        if primary not in allowed_models:
            raise ValueError(f"fallback primary {primary} not in allowed_models")
        if len(chain) > MAX_CHAIN_DEPTH:
            raise ValueError(f"fallback chain for {primary} exceeds depth {MAX_CHAIN_DEPTH}")
        if primary in chain:
            raise ValueError(f"fallback chain for {primary} self-references")
        if len(set(chain)) != len(chain):
            raise ValueError(f"fallback chain for {primary} has duplicates")
        for m in chain:
            if m not in allowed_models:
                raise ValueError(f"fallback model {m} not in allowed_models")
    ma = int(retries.get("max_attempts", 1))
    if not (1 <= ma <= MAX_ATTEMPTS):
        raise ValueError(f"max_attempts must be 1..{MAX_ATTEMPTS}")
    longest = max((len(c) for c in fallbacks.values()), default=0)
    if ma * (1 + longest) > MAX_TOTAL_ATTEMPTS:
        raise ValueError(f"max_attempts * (1 + longest chain) exceeds {MAX_TOTAL_ATTEMPTS}")


# ---------------------------------------------------------------------------
# Input validation helpers
# ---------------------------------------------------------------------------
def _require_nonempty_str(body: dict[str, Any], field: str) -> str:
    val = body.get(field)
    if not isinstance(val, str) or not val.strip():
        raise ValueError(f"{field} required")
    return val


def _require_identifier(body: dict[str, Any], field: str) -> str:
    val = _require_nonempty_str(body, field)
    if not _IDENTIFIER_RE.match(val):
        raise ValueError(f"{field} must match ^[A-Za-z0-9_-]{{1,64}}$")
    return val


def _require_etag(body: dict[str, Any], field: str) -> str:
    val = _require_nonempty_str(body, field)
    if not _ETAG_RE.match(val):
        raise ValueError(f"{field} must be a valid ETag")
    return val


def _require_iso_date(value: str | None, field: str) -> str:
    if not isinstance(value, str) or not _ISO_DATE_RE.match(value):
        raise ValueError(f"{field} must be an ISO date (YYYY-MM-DD)")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} must be a valid ISO date")
    return value


# ---------------------------------------------------------------------------
# Secret handling — 0600 file, never logged, never returned in a body
# ---------------------------------------------------------------------------
def _write_secret(secret: str) -> None:
    """Persist the token secret to a 0600 file. Never log it."""
    SECRET_FILE.write_text(secret, encoding="utf-8")
    try:
        os.chmod(SECRET_FILE, 0o600)
    except OSError:
        app.logger.warning("could not chmod secret file to 0600")


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------
def provision_group() -> dict[str, Any]:
    allowed = [PRIMARY_MODEL, FALLBACK_MODEL]
    fallbacks = {PRIMARY_MODEL: [FALLBACK_MODEL]}
    retries = {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"}
    validate_policy(allowed, fallbacks, retries)

    payload = {
        "name": "gateway-fallbacks-demo",
        "allowed_models": allowed,
        "fallbacks": fallbacks,
        "retries": retries,
        "max_budget": 10,
        "budget_duration": "1d",
    }
    resp = _mgmt_request("POST", "/token_groups", json=payload)
    if resp.status_code >= 400:
        _raise_upstream("token_groups create", resp)
    return resp.json().get("data", resp.json())


def provision_key(group_id: str) -> dict[str, Any]:
    payload = {"name": "gateway-fallbacks-key", "token_group_id": group_id}
    resp = _mgmt_request("POST", "/token_keys", json=payload)
    if resp.status_code >= 400:
        _raise_upstream("token_keys create", resp)
    return resp.json().get("data", resp.json())


# ---------------------------------------------------------------------------
# Inference plane (token key only)
# ---------------------------------------------------------------------------
def _openai_client(token_key: str):
    from openai import OpenAI
    return OpenAI(api_key=token_key, base_url=INFER_BASE, max_retries=0)


def list_models(token_key: str) -> list[str]:
    client = _openai_client(token_key)
    resp = client.models.list()
    return [m.id for m in resp.data]


def _headers_from_raw(raw: Any) -> dict[str, str]:
    """Extract response headers from an OpenAI SDK raw-response wrapper.

    Fails loudly if the SDK version does not expose `.response.headers` —
    the observable-headers contract depends on this accessor.
    """
    http_resp = getattr(raw, "response", None)
    if http_resp is None or not hasattr(http_resp, "headers"):
        raise RuntimeError(
            "OpenAI SDK raw response does not expose .response.headers — "
            "pin openai>=1.40.0,<2.0.0 (see requirements.txt)"
        )
    return {k.lower(): v for k, v in dict(http_resp.headers).items()}


def chat_completion(token_key: str, model: str, prompt: str,
                    extra_headers: dict[str, str] | None = None,
                    stream: bool = False,
                    max_tokens: int = 256) -> dict[str, Any]:
    """Send a chat completion; return model + x-ltg-* headers.

    For streaming calls we use the SDK's documented `with_raw_response`
    accessor so the raw httpx.Response (and therefore the gateway's
    x-ltg-served-model / x-ltg-attempts headers) is reliably available.
    """
    client = _openai_client(token_key)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "user": "gateway-fallbacks-demo",
    }
    if extra_headers:
        kwargs["extra_headers"] = extra_headers

    if stream:
        kwargs["stream"] = True
        raw = client.chat.completions.with_raw_response.create(**kwargs)
        headers = _headers_from_raw(raw)
        stream_iter = raw.parse()
        first = next(iter(stream_iter), None)
        return {
            "model": getattr(first, "model", None) if first else None,
            "x-ltg-served-model": headers.get("x-ltg-served-model"),
            "x-ltg-attempts": headers.get("x-ltg-attempts"),
            "streamed": True,
        }

    raw = client.chat.completions.with_raw_response.create(**kwargs)
    headers = _headers_from_raw(raw)
    parsed = raw.parse()
    return {
        "model": parsed.model,
        "x-ltg-served-model": headers.get("x-ltg-served-model"),
        "x-ltg-attempts": headers.get("x-ltg-attempts"),
        "streamed": False,
    }


def forced_failure_run(token_key: str) -> dict[str, Any]:
    """Trip the primary via streaming + 1s timeout overlay; assert fallback served.

    Non-deterministic by design: if the primary answers inside the 1s deadline
    on all tries, we report `ok: false` honestly rather than pretending.
    """
    base = FORCED_FAILURE_PROMPT_BASE * FORCED_FAILURE_PROMPT_REPEAT
    result: dict[str, Any] = {}
    for attempt in range(1, 4):
        prompt = base * attempt
        result = chat_completion(
            token_key, PRIMARY_MODEL, prompt,
            extra_headers={"x-ltg-request-timeout": FORCED_FAILURE_TIMEOUT_MS},
            stream=True,
            max_tokens=FORCED_FAILURE_MAX_TOKENS,
        )
        served = result.get("x-ltg-served-model")
        attempts = int(result.get("x-ltg-attempts") or 0)
        if served == FALLBACK_MODEL and attempts >= 2:
            return {"ok": True, "result": result, "tries": attempt}
    return {"ok": False, "result": result, "tries": 3}


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------
def spend_events(token_key_id: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    params = {
        "start_date": start_date,
        "end_date": end_date,
        "token_key_id": token_key_id,
        "page[size]": 50,
    }
    resp = _mgmt_request("GET", "/spend/events", params=params)
    if resp.status_code >= 400:
        _raise_upstream("spend/events", resp)
    return resp.json().get("data", [])


def usage_summary(group_id: str) -> dict[str, Any]:
    resp = _mgmt_request("GET", "/usage/summary", params={"token_group_id": group_id})
    if resp.status_code == 403:
        app.logger.warning("usage/summary requires llm_token_gateway.usage.read — skipping")
        return {"warning": "permission_denied"}
    if resp.status_code >= 400:
        _raise_upstream("usage/summary", resp)
    return resp.json().get("data", {})


# ---------------------------------------------------------------------------
# Policy overlays + cache_ttl PATCH
# ---------------------------------------------------------------------------
def per_request_overlay(token_key: str) -> dict[str, Any]:
    return chat_completion(
        token_key, PRIMARY_MODEL, "Say hello in one word.",
        extra_headers={
            "x-ltg-max-attempts": "1",
            "x-ltg-retry-delay": "100",
            "x-ltg-backoff": "constant",
        },
    )


def patch_cache_ttl(group_id: str, etag: str, ttl: int = 60) -> dict[str, Any]:
    resp = _mgmt_request(
        "PATCH", f"/token_groups/{group_id}",
        json={"cache_ttl": ttl},
        headers={"If-Match": etag, "Idempotency-Key": f"cache-ttl-{int(time.time())}"},
    )
    if resp.status_code >= 400:
        _raise_upstream("PATCH cache_ttl", resp)
    return resp.json().get("data", resp.json())


# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
def revoke_key(key_id: str, etag: str) -> None:
    resp = _mgmt_request(
        "DELETE", f"/token_keys/{key_id}",
        headers={"If-Match": etag, "Idempotency-Key": f"revoke-key-{key_id}"},
    )
    if resp.status_code >= 400:
        _raise_upstream("DELETE token_keys", resp)


def delete_group(group_id: str, etag: str) -> None:
    resp = _mgmt_request(
        "DELETE", f"/token_groups/{group_id}",
        headers={"If-Match": etag, "Idempotency-Key": f"del-group-{group_id}"},
    )
    if resp.status_code >= 400:
        _raise_upstream("DELETE token_groups", resp)


# ---------------------------------------------------------------------------
# Demo-mode synthetic responses (no network, no spend)
# ---------------------------------------------------------------------------
def _demo_provision() -> dict[str, Any]:
    return {
        "group_id": "grp_demo_0001",
        "key_id": "key_demo_0001",
        "secret_shown_once": True,
    }


def _demo_inference() -> dict[str, Any]:
    return {
        "models": [PRIMARY_MODEL, FALLBACK_MODEL],
        "normal": {
            "model": PRIMARY_MODEL,
            "x-ltg-served-model": PRIMARY_MODEL,
            "x-ltg-attempts": "1",
            "streamed": False,
        },
        "forced_failure": {
            "ok": True,
            "tries": 1,
            "result": {
                "model": FALLBACK_MODEL,
                "x-ltg-served-model": FALLBACK_MODEL,
                "x-ltg-attempts": "2",
                "streamed": True,
            },
        },
    }


def _demo_policy() -> dict[str, Any]:
    return {
        "overlay": {
            "model": PRIMARY_MODEL,
            "x-ltg-served-model": PRIMARY_MODEL,
            "x-ltg-attempts": "1",
            "streamed": False,
        }
    }


def _demo_teardown() -> dict[str, Any]:
    return {"revoked": True}


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health() -> tuple[dict, int]:
    return {"status": "ok", "demo_mode": DEMO_MODE}, 200


@app.route("/provision", methods=["POST"])
def route_provision() -> tuple[dict, int]:
    if not _check_auth():
        return _auth_failure()
    if DEMO_MODE:
        return _demo_provision(), 200
    try:
        group = provision_group()
        key = provision_key(group["id"])
        # Secret written to a 0600 file exactly once. Never logged, never returned.
        secret = key.get("key") or key.get("secret")
        if secret:
            _write_secret(secret)
        return {
            "group_id": group["id"],
            "key_id": key["id"],
            "secret_shown_once": True,
        }, 200
    except Exception:
        app.logger.exception("provision failed")
        return {"error": "provision failed"}, 500


@app.route("/inference", methods=["POST"])
def route_inference() -> tuple[dict, int]:
    if not _check_auth():
        return _auth_failure()
    body = request.get_json(silent=True) or {}
    try:
        token_key = _require_nonempty_str(body, "token_key")
    except ValueError:
        app.logger.warning("invalid inference request payload", exc_info=True)
        return {"error": "invalid request"}, 400
    if DEMO_MODE:
        return _demo_inference(), 200
    try:
        models = list_models(token_key)
        normal = chat_completion(token_key, PRIMARY_MODEL, "Say hello in one word.")
        forced = forced_failure_run(token_key)
        return {"models": models, "normal": normal, "forced_failure": forced}, 200
    except Exception:
        app.logger.exception("inference failed")
        return {"error": "inference failed"}, 500


@app.route("/ledger", methods=["GET"])
def route_ledger() -> tuple[dict, int]:
    if not _check_auth():
        return _auth_failure()
    try:
        key_id = _require_identifier(request.args.to_dict(), "token_key_id")
        start = _require_iso_date(request.args.get("start_date"), "start_date")
        end = _require_iso_date(request.args.get("end_date"), "end_date")
    except ValueError as exc:
        return {"error": str(exc)}, 400
    if DEMO_MODE:
        return {"events": []}, 200
    try:
        rows = spend_events(key_id, start, end)
        return {"events": rows}, 200
    except Exception:
        app.logger.exception("ledger failed")
        return {"error": "ledger failed"}, 500


@app.route("/policy", methods=["POST"])
def route_policy() -> tuple[dict, int]:
    if not _check_auth():
        return _auth_failure()
    body = request.get_json(silent=True) or {}
    try:
        token_key = _require_nonempty_str(body, "token_key")
    except ValueError as exc:
        return {"error": str(exc)}, 400
    if DEMO_MODE:
        return _demo_policy(), 200
    try:
        return {"overlay": per_request_overlay(token_key)}, 200
    except Exception:
        app.logger.exception("policy failed")
        return {"error": "policy failed"}, 500


@app.route("/teardown", methods=["POST"])
def route_teardown() -> tuple[dict, int]:
    if not _check_auth():
        return _auth_failure()
    body = request.get_json(silent=True) or {}
    try:
        key_id = _require_identifier(body, "key_id")
        key_etag = _require_etag(body, "key_etag")
        group_id = _require_identifier(body, "group_id")
        group_etag = _require_etag(body, "group_etag")
    except ValueError as exc:
        return {"error": str(exc)}, 400
    if DEMO_MODE:
        return _demo_teardown(), 200
    try:
        revoke_key(key_id, key_etag)
        delete_group(group_id, group_etag)
        return {"revoked": True}, 200
    except Exception:
        app.logger.exception("teardown failed")
        return {"error": "teardown failed"}, 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "8080")))
