"""Repository-convention entry point for the Agent Instruction Scanner.

The implementation lives in scanner.py; this shim exists so the repo-wide
verifier finds the expected app.py code file. Run either:

    python app.py PATH
    python scanner.py PATH
"""

from scanner import main

if __name__ == "__main__":
    raise SystemExit(main())
