"""Shared helpers for the gateway-fallbacks demo.

Two planes and one observation layer:

- Management plane (api.telnyx.com/v2/llm_token_gateway) via the Telnyx SDK,
  authenticated with the Telnyx *account* API key.
- Inference plane (llm.telnyx.com/v1) via the OpenAI SDK pointed at the
  gateway, authenticated with the *token key* only (account keys are rejected).
- Observation layer: x-ltg-served-model / x-ltg-attempts response headers on
  the live path, GET /spend/events as the ledger.

The OpenAI client is built with max_retries=0: SDK retries are additional
requests on top of gateway attempts — they double-bill and inflate attempt
counts. The gateway owns all retry/fallback behavior.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import telnyx
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

INFER_BASE = os.getenv("TELNYX_INFER_BASE", "https://llm.telnyx.com/v1")
PRIMARY_MODEL = os.getenv("PRIMARY_MODEL", "Kimi-K3")
FALLBACK_MODEL = os.getenv("FALLBACK_MODEL", "GLM-5.3-Flash")

# Step 1 writes IDs here (never the token secret); later steps read them.
STATE_FILE = Path(os.getenv("GATEWAY_STATE_FILE", ".gateway_state.json"))

# Policy constraints, asserted in code before any API call (acceptance criteria):
# fallback chain depth <= 3, max_attempts in 1..5, and
# max_attempts * (1 + longest chain) <= 8 — the gateway's attempt ceiling.
MAX_CHAIN_DEPTH = 3
MAX_ATTEMPTS = 5
MAX_TOTAL_ATTEMPTS = 8


def api_key() -> str:
    key = os.getenv("TELNYX_API_KEY", "")
    if not key:
        raise SystemExit("TELNYX_API_KEY is not set — copy .env.example to .env first")
    return key


def token_key() -> str:
    """The inference-plane secret. provision.py prints it exactly once; it is
    never written to disk, so later steps must export it."""
    key = os.getenv("GATEWAY_TOKEN_KEY", "")
    if not key:
        raise SystemExit(
            "GATEWAY_TOKEN_KEY is not set — export the secret that provision.py "
            "printed exactly once (it is not retrievable afterwards)"
        )
    return key


def mgmt_client() -> telnyx.Telnyx:
    return telnyx.Telnyx(api_key=api_key())


def inference_client(token_key: str) -> OpenAI:
    """Client for the inference plane. max_retries=0 — see module docstring."""
    return OpenAI(api_key=token_key, base_url=INFER_BASE, max_retries=0)


def validate_policy(
    allowed_models: list[str],
    fallbacks: dict[str, list[str]],
    retries: dict[str, Any],
) -> None:
    """Assert the policy constraints the gateway itself enforces (400 otherwise).

    - Every fallback chain lives inside allowed_models, has no duplicates and
      never references its own primary.
    - Chain depth is at most MAX_CHAIN_DEPTH (3).
    - max_attempts is in 1..MAX_ATTEMPTS (5).
    - max_attempts * (1 + longest chain) <= MAX_TOTAL_ATTEMPTS (8).
    """
    for primary, chain in fallbacks.items():
        if primary not in allowed_models:
            raise ValueError(f"fallback primary {primary} not in allowed_models")
        if len(chain) > MAX_CHAIN_DEPTH:
            raise ValueError(f"fallback chain for {primary} exceeds depth {MAX_CHAIN_DEPTH}")
        if primary in chain:
            raise ValueError(f"fallback chain for {primary} self-references")
        if len(set(chain)) != len(chain):
            raise ValueError(f"fallback chain for {primary} has duplicates")
        for model in chain:
            if model not in allowed_models:
                raise ValueError(f"fallback model {model} not in allowed_models")
    max_attempts = int(retries.get("max_attempts", 1))
    if not 1 <= max_attempts <= MAX_ATTEMPTS:
        raise ValueError(f"max_attempts must be in 1..{MAX_ATTEMPTS}")
    longest = max((len(chain) for chain in fallbacks.values()), default=0)
    if max_attempts * (1 + longest) > MAX_TOTAL_ATTEMPTS:
        raise ValueError(
            f"max_attempts * (1 + longest chain) must not exceed {MAX_TOTAL_ATTEMPTS}"
        )


# ---------------------------------------------------------------------------
# State file: group/key IDs only — the token secret never lands in a file.
# ---------------------------------------------------------------------------
def save_state(group_id: str, key_id: str, created_at: str) -> None:
    STATE_FILE.write_text(
        json.dumps({"group_id": group_id, "key_id": key_id, "created_at": created_at}, indent=2)
        + "\n",
        encoding="utf-8",
    )


def state_or_none() -> dict[str, str] | None:
    """Non-throwing variant of load_state() for tools that degrade gracefully."""
    if not STATE_FILE.exists():
        return None
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    for field in ("group_id", "key_id"):
        if not state.get(field):
            return None
    return state


def load_state() -> dict[str, str]:
    state = state_or_none()
    if state is None:
        raise SystemExit(
            "No provisioned group found — run `python provision.py` first "
            f"(expected state file: {STATE_FILE})"
        )
    return state


def clear_state() -> None:
    STATE_FILE.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Date range for ledger queries: half-open UTC [start, end), overridable via
# START_DATE / END_DATE so the demo can be replayed on any day.
# ---------------------------------------------------------------------------
def spend_date_range() -> tuple[str, str]:
    start = os.getenv("START_DATE") or date.today().strftime("%Y-%m-%d")
    end = os.getenv("END_DATE") or (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
    return start, end


# ---------------------------------------------------------------------------
# Inference helpers. Headers come off the raw response so the observation
# layer works for both streaming and non-streaming calls.
# ---------------------------------------------------------------------------
def chat_completion(
    token_key: str,
    model: str,
    prompt: str,
    extra_headers: dict[str, str] | None = None,
    stream: bool = False,
    max_tokens: int = 256,
) -> dict[str, Any]:
    """Send one chat completion; return the serving model + x-ltg-* headers.

    For streaming calls the gateway's x-ltg-* headers are attached to the
    initial response, so we read them from the SDK's with_raw_response wrapper
    before consuming the stream.
    """
    client = inference_client(token_key)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }
    if extra_headers:
        kwargs["extra_headers"] = extra_headers

    raw = client.chat.completions.with_raw_response.create(**kwargs)
    headers = raw.response.headers
    if stream:
        raw_stream = raw.parse()
        try:
            first = next(iter(raw_stream), None)
        finally:
            raw_stream.close()
        return {
            "model": getattr(first, "model", None) if first else None,
            "x-ltg-served-model": headers.get("x-ltg-served-model"),
            "x-ltg-attempts": headers.get("x-ltg-attempts"),
            "streamed": True,
        }
    parsed = raw.parse()
    return {
        "model": parsed.model,
        "x-ltg-served-model": headers.get("x-ltg-served-model"),
        "x-ltg-attempts": headers.get("x-ltg-attempts"),
        "streamed": False,
    }


def describe_attempt(result: dict[str, Any]) -> str:
    return (
        f"model={result.get('model')!r} x-ltg-served-model={result.get('x-ltg-served-model')!r} "
        f"x-ltg-attempts={result.get('x-ltg-attempts')!r}"
    )


# ---------------------------------------------------------------------------
# Reservation model: budget/TPM capacity for planned attempts is reserved up
# front and released at settlement. Print the raw budget/reservation fields
# the group GET returns rather than assuming exact naming.
# ---------------------------------------------------------------------------
def print_reservation(group: Any) -> None:
    print("  reservation after call:")
    for field in ("spend", "reserved_spend", "max_budget", "budget_duration"):
        value = getattr(group, field, None)
        if value is not None:
            print(f"    {field} = {value}")


# ---------------------------------------------------------------------------
# ETag handling: the docs' mutation-safety pattern. Read the ETag from a GET
# right before every mutating call (PATCH/DELETE); never accept it as input.
# ---------------------------------------------------------------------------
def fetch_etag(client: telnyx.Telnyx, kind: str, resource_id: str) -> str:
    if kind == "token_groups":
        raw = client.llm_token_gateway.token_groups.with_raw_response.retrieve(resource_id)
    elif kind == "token_keys":
        raw = client.llm_token_gateway.token_keys.with_raw_response.retrieve(resource_id)
    else:
        raise ValueError(f"unknown resource kind {kind}")
    etag = raw.response.headers.get("ETag")
    if not etag:
        raise RuntimeError(f"GET /{kind}/{resource_id} returned no ETag header")
    return etag


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
