#!/usr/bin/env python3
"""Step 2 — inference.py: chat completions through the gateway, with the failover proof.

Flow:
  1. GET /v1/models with the token key — proves the group's allowed_models
     names are real before any chat call.
  2. A normal (non-stream) completion against the primary — headers show the
     primary served with one attempt.
  3. The forced-failure run: a *streaming* request against the primary with
     the per-request overlay `x-ltg-request-timeout: 1000` and a heavy
     long-form prompt. The overlay bounds each streaming attempt's time to its
     first provider event, so the primary's first event misses the 1 s
     deadline, the attempt times out, and the gateway moves to the fallback.
     The script asserts x-ltg-served-model == fallback and x-ltg-attempts >= 2;
     if the primary happens to answer inside 1 s it retries (max 3) with
     progressively heavier prompts, and reports honestly if the fallback
     never fired.

After every call the script GETs the token group and prints the raw
budget/reservation fields (reserved_spend is the reservation for planned
attempts, released at settlement), so the reservation story is visible
regardless of exact field naming.
"""

from __future__ import annotations

from gateway import (
    FALLBACK_MODEL,
    PRIMARY_MODEL,
    chat_completion,
    describe_attempt,
    inference_client,
    load_state,
    mgmt_client,
    print_reservation,
    token_key as read_token_key,
)

# The primary's first provider event must miss this deadline (ms) for the
# gateway to classify the attempt as an uncertain failure and fall back.
FORCED_FAILURE_TIMEOUT_MS = "1000"
FORCED_FAILURE_MAX_TOKENS = 4096  # long-form generation, but bounded
FORCED_FAILURE_MAX_TRIES = 3

FORCED_FAILURE_PROMPT_BASE = (
    "Write an extremely long, detailed, exhaustive essay about distributed "
    "systems consensus algorithms, covering Paxos, Raft, and Byzantine fault "
    "tolerance in depth. Do not stop early. "
)


def list_models(token_key: str) -> list[str]:
    client = inference_client(token_key)
    return [model.id for model in client.models.list().data]


def run_forced_failure(token_key: str) -> dict:
    """Trip the primary via streaming + 1 s timeout overlay; prove the fallback.

    Returns {"ok": bool, "result": {...}, "tries": int}. ok is True only when
    the gateway actually served the fallback model with more than one attempt.
    """
    base = FORCED_FAILURE_PROMPT_BASE
    result: dict = {}
    for attempt in range(1, FORCED_FAILURE_MAX_TRIES + 1):
        # Progressively heavier prompt widens the time-to-first-event window,
        # making the 1 s deadline progressively harder to meet.
        prompt = base * attempt
        print(f"  forced-failure try {attempt}/{FORCED_FAILURE_MAX_TRIES}: "
              f"streaming against {PRIMARY_MODEL} with x-ltg-request-timeout: {FORCED_FAILURE_TIMEOUT_MS} "
              f"(prompt x{attempt})")
        result = chat_completion(
            token_key,
            PRIMARY_MODEL,
            prompt,
            extra_headers={"x-ltg-request-timeout": FORCED_FAILURE_TIMEOUT_MS},
            stream=True,
            max_tokens=FORCED_FAILURE_MAX_TOKENS,
        )
        print(f"    {describe_attempt(result)}")
        served = result.get("x-ltg-served-model")
        attempts = int(result.get("x-ltg-attempts") or 0)
        if served == FALLBACK_MODEL and attempts >= 2:
            return {"ok": True, "result": result, "tries": attempt}
    return {"ok": False, "result": result, "tries": FORCED_FAILURE_MAX_TRIES}


def main() -> int:
    state = load_state()
    token_key = read_token_key()
    client = mgmt_client()

    print("1. Key-scoped model discovery (GET /v1/models):")
    models = list_models(token_key)
    for model in models:
        if model in (PRIMARY_MODEL, FALLBACK_MODEL):
            print(f"   {model}  <- in the group's allowed_models")
        else:
            print(f"   {model}")
    missing = [m for m in (PRIMARY_MODEL, FALLBACK_MODEL) if m not in models]
    if missing:
        print(f"   WARNING: {missing} not in the key-scoped model list")

    print()
    print("2. Normal completion (non-stream) against the primary:")
    normal = chat_completion(token_key, PRIMARY_MODEL, "Say hello in one word.")
    print(f"   {describe_attempt(normal)}")

    group = client.llm_token_gateway.token_groups.retrieve(state["group_id"]).data
    print_reservation(group)

    print()
    print("3. Forced failure (streaming + x-ltg-request-timeout: 1000):")
    forced = run_forced_failure(token_key)
    if forced["ok"]:
        result = forced["result"]
        print()
        print(f"   FAILOVER PROVEN after {forced['tries']} try(ies): "
              f"requested {PRIMARY_MODEL}, gateway served {result.get('x-ltg-served-model')} "
              f"in {result.get('x-ltg-attempts')} attempts.")
    else:
        print()
        print("   The fallback never fired on this run — the primary answered inside "
              "the 1 s deadline on all tries. This is the honest outcome when the "
              "primary is healthy; rerun for a failover, or lower "
              "FORCED_FAILURE_TIMEOUT_MS.")
    print()
    print("Next: python ledger.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
