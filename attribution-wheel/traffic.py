#!/usr/bin/env python3
"""traffic.py — the demo traffic driver for attribution-wheel.

Two modes, matching the README/GUIDE contract:

* DEMO_MODE=true (default): asks the actor to seed N days of clearly-marked
  synthetic baseline history via @rpc seed(days), then (optionally) writes a
  named traffic profile for a day via @rpc simulate(day, profile). The gateway
  cannot be backdated, so history is synthesized locally and never billed.
* DEMO_MODE=false: sends REAL tagged inference requests for today only —
  one per service — each carrying the x-ltg-metadata header
  {"service": ..., "env": "prod", "tenant": "acme"}, against
  https://llm.telnyx.com/v1/chat/completions with the per-service token key,
  always setting max_tokens. Those requests are billed and grouped under
  group_by=metadata:service on the next sweep.

Usage:
  python traffic.py --days 7                 # DEMO_MODE: seed 7 baseline days
  python traffic.py --profile spike          # DEMO_MODE: write a profile day
  DEMO_MODE=false python traffic.py          # LIVE: send one tagged request per service

Env (see .env.example): TELNYX_API_KEY, AI_GATEWAY_MODEL, DEMO_MODE,
ATTRIBUTION_ACTOR_URL (the deployed actor's /rpc endpoint), plus the actor's
per-service token keys in live mode (echoed by @rpc bootstrap()).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ACTOR_URL = os.environ.get("ATTRIBUTION_ACTOR_URL", "http://127.0.0.1:8787")
DEMO_MODE = os.environ.get("DEMO_MODE", "true").strip().lower() != "false"
MODEL = os.environ.get("AI_GATEWAY_MODEL", "Kimi-K3")
INFERENCE_URL = os.environ.get("AI_GATEWAY_INFERENCE_URL", "https://llm.telnyx.com/v1/chat/completions")

SERVICES = ("support", "billing", "docs")
PROMPTS = {
    "support": "Summarize our refund policy in one sentence for a patient portal.",
    "billing": "Classify this dispute: 'charged twice for the same visit'.",
    "docs": "Draft a one-paragraph changelog entry for the triage release.",
}
TAGS = {
    "support": {"service": "support", "env": "prod", "tenant": "acme"},
    "billing": {"service": "billing", "env": "prod", "tenant": "acme"},
    "docs": {"service": "docs", "env": "prod", "tenant": "acme"},
}


def rpc(method: str, params: list | None = None) -> dict:
    """Call an @rpc method on the deployed AttributionWheel actor.

    The worker's RPC contract is ``POST /rpc/<method>`` with a JSON array of
    positional arguments as the body — e.g. ``/rpc/sweep`` with
    ``["2026-11-11"]``.
    """
    body = json.dumps(params or []).encode()
    req = urllib.request.Request(
        f"{ACTOR_URL.rstrip('/')}/rpc/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def send_tagged_request(service: str, token_key: str) -> int:
    """Send one real tagged inference request. Returns the HTTP status."""
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": PROMPTS[service]}],
            "max_tokens": 64,
            "metadata": {"user_id": "attribution-wheel-demo"},
        }
    ).encode()
    req = urllib.request.Request(
        INFERENCE_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token_key}",
            "Content-Type": "application/json",
            # The tags the gateway attributes the request to. Exactly three:
            # service, env, tenant (keys 1-64 chars, values <=256 chars).
            "x-ltg-metadata": json.dumps(TAGS[service]),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        # 400 invalid_metadata never echoes the header — check tag shapes.
        print(f"  {service}: HTTP {err.code} — {err.read().decode()[:160]}", file=sys.stderr)
        return err.code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7, help="DEMO_MODE: baseline history days to seed")
    parser.add_argument("--profile", choices=("baseline", "spike", "recovery"), help="DEMO_MODE: write a profile day")
    args = parser.parse_args()

    if DEMO_MODE:
        seeded = rpc("seed", [args.days]) if args.days > 0 else None
        if seeded:
            print(f"seed: {json.dumps(seeded)}")
        if args.profile:
            from datetime import datetime, timedelta, timezone

            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            out = rpc("simulate", [day, args.profile])
            print(f"simulate: {json.dumps(out)}")
        elif not seeded:
            print("nothing to do (pass --days N and/or --profile NAME)")
        print("DEMO_MODE: no live inference traffic sent; the gateway is not billed.")
        return 0

    # LIVE mode: one real tagged request per service, using the per-service keys.
    boot = rpc("bootstrap")
    keys: dict[str, str] = boot.get("keys") or {}
    missing = [s for s in SERVICES if not keys.get(s)]
    if missing:
        print(f"missing token key(s) from bootstrap(): {', '.join(missing)}", file=sys.stderr)
        return 1
    ok = 0
    for service in SERVICES:
        status = send_tagged_request(service, keys[service])
        print(f"  {service}: HTTP {status}")
        ok += 1 if 200 <= status < 300 else 0
    print(f"{ok}/{len(SERVICES)} tagged requests landed; run @rpc sweep(day) to attribute.")
    return 0 if ok == len(SERVICES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
