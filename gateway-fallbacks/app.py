#!/usr/bin/env python3
"""AI Gateway Fallback & Resilience Desk — CLI dispatcher.

The five-step demo lives in five sibling scripts; this file routes between them
so the whole flow can also be driven with one entrypoint:

    python app.py provision    # step 1: create the token group + issue a token key
    python app.py inference    # step 2: models list, normal call, forced-failure proof
    python app.py ledger       # step 3: spend/events ledger + usage summary
    python app.py policy       # step 4: overlay, invalid-config 400, cache_ttl demo
    python app.py teardown     # step 5: revoke key, delete group, verify revocation

Each step is also runnable directly: `python provision.py`, etc.
"""

from __future__ import annotations

import sys

from inference import main as inference
from ledger import main as ledger
from policy import main as policy
from provision import main as provision
from teardown import main as teardown

COMMANDS: dict[str, str] = {
    "provision": "provision.py",
    "inference": "inference.py",
    "ledger": "ledger.py",
    "policy": "policy.py",
    "teardown": "teardown.py",
}

RUNNERS = {
    "provision": provision,
    "inference": inference,
    "ledger": ledger,
    "policy": policy,
    "teardown": teardown,
}


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in COMMANDS:
        print(__doc__.strip())
        print()
        print(f"steps: {', '.join(COMMANDS)}")
        return 2
    return RUNNERS[argv[0]]()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
