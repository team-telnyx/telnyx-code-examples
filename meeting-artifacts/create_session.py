"""Standalone entry point for session creation.

Delegates to the CLI in app.py: `python create_session.py --url ...`.
Runs in its own process so polling never blocks the webhook receiver.
"""

import sys

from app import main

if __name__ == "__main__":
    sys.exit(main())
