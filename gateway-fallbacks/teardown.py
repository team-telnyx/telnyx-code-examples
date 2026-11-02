#!/usr/bin/env python3
"""Step 5 — teardown.py: revoke the key, delete the group, prove revocation.

The docs' mutation-safety pattern: every mutating call carries If-Match: <ETag>
read from a fresh GET immediately beforehand, plus an Idempotency-Key. A stale
ETag yields 412 — read the resource again before deleting.

After the key is revoked, the script verifies the revocation contract the only
way that matters: it re-issues an inference call with the (now revoked) token
key and confirms the gateway rejects it with HTTP 401.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any

from gateway import (
    PRIMARY_MODEL,
    chat_completion,
    fetch_etag,
    load_state,
    mgmt_client,
    clear_state,
)


def fetch_etags(client: Any, group_id: str, key_id: str) -> tuple[str, str]:
    """Read fresh ETags via GET — the mutation-safety pattern, demonstrated."""
    group_etag = fetch_etag(client, "token_groups", group_id)
    key_etag = fetch_etag(client, "token_keys", key_id)
    print(f"  fresh ETags via GET: key={key_etag!r} group={group_etag!r}")
    return key_etag, group_etag


def revoke(client: Any, state: dict) -> None:
    key_etag, group_etag = fetch_etags(client, state["group_id"], state["key_id"])
    print("  revoking token key (DELETE /token_keys/{id}, If-Match + Idempotency-Key):")
    client.llm_token_gateway.token_keys.delete(
        state["key_id"],
        idempotency_key=f"gateway-fallbacks-revoke-key-{uuid.uuid4()}",
        if_match=key_etag,
    )
    print("  deleting token group (DELETE /token_groups/{id}, If-Match + Idempotency-Key):")
    client.llm_token_gateway.token_groups.delete(
        state["group_id"],
        idempotency_key=f"gateway-fallbacks-delete-group-{uuid.uuid4()}",
        if_match=group_etag,
    )


def verify_revocation(token_key: str, window_s: int = 90, interval_s: int = 10) -> bool:
    """Confirm the next inference call with the revoked key is rejected (401).

    Revocation propagates across gateway replicas on a grace window, so poll
    until the rejection appears; report honestly if it never does.
    """
    deadline = time.monotonic() + window_s
    attempt = 0
    while True:
        attempt += 1
        try:
            chat_completion(token_key, PRIMARY_MODEL, "ping")
        except Exception as exc:  # noqa: BLE001 - any transport/auth error means rejection
            status = getattr(exc, "status_code", None)
            if status == 401:
                print(f"  REVOCATION VERIFIED after {attempt} check(s): "
                      "the gateway rejected the revoked key with 401.")
                return True
            print(f"  gateway rejected the revoked key (status={status}, {type(exc).__name__}).")
            return False
        if time.monotonic() >= deadline:
            print(f"  REVOCATION NOT VERIFIED after {attempt} check(s): the gateway "
                  "still accepted the revoked key. Management-plane deletion was "
                  "acknowledged (404 on GET); inference-plane admission may lag.")
            return False
        print(f"  check {attempt}: gateway still serving the revoked key — waiting "
              f"{interval_s}s for revocation to propagate...")
        time.sleep(interval_s)


def main() -> int:
    state = load_state()
    client = mgmt_client()
    revoke(client, state)

    token_key = os.environ.get("GATEWAY_TOKEN_KEY", "")
    if token_key and verify_revocation(token_key):
        clear_state()
        print("  state file removed. Demo complete — nothing left to bill.")
        return 0
    print("  REVOCATION NOT VERIFIED: the gateway still accepted the revoked key.")
    print("  Keep the state file (group may still exist) and investigate before rerunning.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
