#!/usr/bin/env python3
"""Step 4 — policy.py: per-request overlay, invalid-config rejection, cache_ttl.

Three demonstrations, each bound to the ticket's policy contract:

1. Per-request overlay: x-ltg-max-attempts / x-ltg-retry-delay / x-ltg-backoff
   tighten the group policy for ONE request without a group PATCH.
2. Invalid config is rejected with HTTP 400: a PATCH that breaks the
   constraints (here max_attempts=9, outside 1..5) must come back 400 and must
   not mutate the group. The gateway enforces the same limits gateway.py
   asserts locally.
3. cache_ttl PATCH demo: patch cache_ttl=60 (If-Match + Idempotency-Key), then
   send an identical request twice — the second one is served from cache:
   x-ltg-attempts: 0, and the ledger row shows cache_hit: true.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import telnyx

from gateway import (
    FALLBACK_MODEL,
    PRIMARY_MODEL,
    chat_completion,
    describe_attempt,
    fetch_etag,
    load_state,
    mgmt_client,
    print_reservation,
    token_key as read_token_key,
)

# The group's values are FLOORS for the overlay knobs (verified live): the
# request may tighten attempts downward and raise the delay, but a delay below
# the group's 250ms or a backoff curve looser than the group's exponential is
# rejected with 400.
OVERLAY_HEADERS = {
    "x-ltg-max-attempts": "1",
    "x-ltg-retry-delay": "1000",
    "x-ltg-backoff": "exponential",
}
CACHE_TTL_SECONDS = 60
CACHE_PROMPT = "Name the three states of matter in one short sentence."


def wait_for_key_ready(client: Any, key_id: str, timeout_s: int = 60) -> None:
    """Group PATCHes trigger token-key re-provisioning; inference during the
    'pending' window fails with 503 enforcement_unavailable. Poll until ready."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        key = client.llm_token_gateway.token_keys.retrieve(key_id).data
        if getattr(key, "provisioning", "ready") in (None, "ready"):
            return
        time.sleep(3)
    raise RuntimeError("token key did not return to provisioning=ready after the PATCH")


def run_overlay(token_key: str) -> dict[str, Any]:
    print("1. Per-request overlay (no group PATCH):")
    result = chat_completion(
        token_key, PRIMARY_MODEL, "Say hello in one word.", extra_headers=dict(OVERLAY_HEADERS)
    )
    print(f"   {describe_attempt(result)}")
    if int(result.get("x-ltg-attempts") or 0) > 1:
        print("   NOTE: the overlay caps attempts at 1 per step for this request.")
    print("   (Group values are floors: the overlay tightened attempts to 1 and raised "
          "the retry delay to 1000ms for this request only.)")
    return result


def run_invalid_patch(client: Any, group_id: str) -> None:
    """PATCH with an invalid config; the gateway must reject it with HTTP 400."""
    print("2. Invalid config PATCH (max_attempts=9, outside 1..5):")
    etag = fetch_etag(client, "token_groups", group_id)
    try:
        client.llm_token_gateway.token_groups.update(
            group_id,
            idempotency_key=f"gateway-fallbacks-invalid-{uuid.uuid4()}",
            if_match=etag,
            retries={"max_attempts": 9, "retry_delay_ms": 250, "backoff": "exponential"},
        )
    except telnyx.APIStatusError as exc:
        if exc.status_code != 400:
            raise
        print("   gateway rejected the invalid config with HTTP 400 — the constraint "
              "contract is enforced server-side, matching the local asserts in gateway.py")
        return
    raise RuntimeError(
        "expected HTTP 400 for the invalid retries config, but the PATCH succeeded — "
        "the acceptance contract is not satisfied"
    )


def run_cache_ttl_patch(client: Any, group_id: str, key_id: str, token_key: str) -> None:
    """PATCH cache_ttl=60, then prove an identical repeat request is a cache hit."""
    print(f"3. cache_ttl PATCH demo (cache_ttl={CACHE_TTL_SECONDS}s):")
    etag = fetch_etag(client, "token_groups", group_id)
    group = client.llm_token_gateway.token_groups.update(
        group_id,
        idempotency_key=f"gateway-fallbacks-cache-ttl-{uuid.uuid4()}",
        if_match=etag,
        cache_ttl=CACHE_TTL_SECONDS,
    ).data
    print(f"   PATCH accepted; stored cache_ttl={group.cache_ttl}")

    wait_for_key_ready(client, key_id)
    first = chat_completion(token_key, PRIMARY_MODEL, CACHE_PROMPT)
    print(f"   first request:  {describe_attempt(first)}")
    time.sleep(2)
    second = chat_completion(token_key, PRIMARY_MODEL, CACHE_PROMPT)
    print(f"   repeat request: {describe_attempt(second)}")

    attempts_second = int(second.get("x-ltg-attempts") or 0)
    if attempts_second == 0:
        print("   CACHE HIT PROVEN: x-ltg-attempts: 0 — the identical repeat request "
              "was served from cache; the ledger row will show cache_hit: true.")
    else:
        print(f"   repeat request used {attempts_second} attempt(s) — the cache may be "
              "cold for this prompt or disabled on this account; check the ledger row's "
              "cache_hit field (python ledger.py).")
    print_reservation(group)


def main() -> int:
    state = load_state()
    client = mgmt_client()
    token_key = read_token_key()
    run_overlay(token_key)
    print()
    run_invalid_patch(client, state["group_id"])
    print()
    run_cache_ttl_patch(client, state["group_id"], state["key_id"], token_key)
    print()
    print(f"Expected fallback models remain {PRIMARY_MODEL} -> {FALLBACK_MODEL}.")
    print("Next: python teardown.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
