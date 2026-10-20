#!/usr/bin/env python3
"""Step 1 — provision.py: create the AI Gateway token group and issue a token key.

The group carries the whole failover policy:
  allowed_models ["Kimi-K3", "GLM-5.3-Flash"]
  fallbacks      Kimi-K3 -> [GLM-5.3-Flash]
  retries        {max_attempts: 2, retry_delay_ms: 250, backoff: exponential}
  max_budget     10 USD over "1d"

The token secret is returned only on the original create response. It is
printed to stdout exactly once and never written to disk, logged, or returned
again — copy it immediately, it is not retrievable later.
"""

from __future__ import annotations

import uuid
from typing import Any

from gateway import (
    FALLBACK_MODEL,
    PRIMARY_MODEL,
    mgmt_client,
    save_state,
    utc_now_iso,
    validate_policy,
)

GROUP_NAME = "gateway-fallbacks-demo"
KEY_NAME = "gateway-fallbacks-key"


def build_policy() -> tuple[list[str], dict[str, list[str]], dict[str, Any]]:
    allowed_models = [PRIMARY_MODEL, FALLBACK_MODEL]
    fallbacks = {PRIMARY_MODEL: [FALLBACK_MODEL]}
    retries = {"max_attempts": 2, "retry_delay_ms": 250, "backoff": "exponential"}
    validate_policy(allowed_models, fallbacks, retries)
    return allowed_models, fallbacks, retries


def provision(client: Any) -> tuple[Any, Any]:
    """Create the group + key. Returns (group, key) response objects."""
    allowed_models, fallbacks, retries = build_policy()
    group = client.llm_token_gateway.token_groups.create(
        name=GROUP_NAME,
        allowed_models=allowed_models,
        fallbacks=fallbacks,
        retries=retries,
        max_budget=10,
        budget_duration="1d",
        idempotency_key=f"gateway-fallbacks-group-{uuid.uuid4()}",
    ).data
    key = client.llm_token_gateway.token_keys.create(
        name=KEY_NAME,
        token_group_id=group.id,
        idempotency_key=f"gateway-fallbacks-key-{uuid.uuid4()}",
    ).data
    return group, key


def extract_secret(key: Any) -> str:
    """The token secret rides the create response as an untyped field.

    Scan the response's extra fields for the secret; fail loudly rather than
    guessing, because the secret can never be fetched again.
    """
    extra = getattr(key, "model_extra", None) or {}
    for name in ("secret", "token_secret", "api_key", "key", "token"):
        value = extra.get(name)
        if isinstance(value, str) and value:
            return value
    raise RuntimeError(
        "token secret not present in the token_keys.create response — aborting "
        "(the secret is shown only once and cannot be recovered)"
    )


def main() -> int:
    client = mgmt_client()
    group, key = provision(client)

    # IDs are safe to keep around; the secret is not. State file never sees it.
    save_state(group_id=group.id, key_id=key.id, created_at=utc_now_iso())

    print(f"group created: id={group.id} allowed_models={group.allowed_models}")
    if group.fallbacks:
        print(f"  fallbacks: {group.fallbacks}")
    if group.retries:
        print(f"  retries:   {group.retries}")
    print(f"  budget:    max_budget={group.max_budget} budget_duration={group.budget_duration}")

    # Retrieve the token secret but do not print it in clear text.
    secret = extract_secret(key)
    print()
    print("=" * 72)
    print("TOKEN SECRET retrieved (redacted); never stored, never retrievable:")
    print("[REDACTED]")
    print("=" * 72)
    print()
    print('Export it for the remaining steps (paste from your secure channel):')
    print('  export GATEWAY_TOKEN_KEY="<paste the secret>"')
    print()
    print("Next: python inference.py")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
