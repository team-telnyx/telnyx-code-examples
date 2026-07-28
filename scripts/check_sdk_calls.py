#!/usr/bin/env python3
"""Validate SDK method calls in example app.py files against the installed telnyx package.

AST-parses each Python example's app.py, finds ``client.X.Y(...)`` call chains
(where ``client`` is a ``telnyx.Telnyx(...)`` instance), and resolves every link
of the chain against the installed ``telnyx`` SDK to confirm the attribute or
method actually exists.

This catches the class of defect where an example references a SDK method or
field that does not exist on the current package — e.g. ``client.messages.create()``
(should be ``.send()``) or ``client.ai_assistants.create()`` (should be
``client.ai.assistants.create()``).

Usage:
    python scripts/check_sdk_calls.py                       # Check all Python examples
    python scripts/check_sdk_calls.py --only send-sms-python  # Check one example
    python scripts/check_sdk_calls.py --verbose               # Show OK lines too
"""

import argparse
import ast
import importlib
import inspect
import os
import sys
from pathlib import Path
from typing import Any, NamedTuple

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent


class SdkViolation(NamedTuple):
    file: str
    line: int
    chain: str
    problem: str


def _instantiate_client() -> Any:
    """Create a throwaway telnyx.Telnyx client for introspection."""
    import telnyx  # noqa: delayed import so the script can run even if telnyx is absent

    return telnyx.Telnyx(api_key="placeholder_for_introspection_only")


def _resolve_attr(obj: Any, name: str) -> tuple[Any, str | None]:
    """Resolve a single attribute access, returning (value, error).

    ``error`` is None on success, or a human-readable reason on failure.
    """
    # Built-in attributes that exist on every object — don't flag these.
    if name in ("data", "id", "model", "model_fields", "__fields__"):
        return getattr(obj, name, None), None
    if hasattr(obj, name):
        return getattr(obj, name), None
    # Pydantic models expose declared fields via model_fields/__fields__,
    # so check there before declaring the attribute missing.
    for fields_attr in ("model_fields", "__fields__", "__dataclass_fields__"):
        fields = getattr(obj, fields_attr, None)
        if isinstance(fields, dict) and name in fields:
            return getattr(obj, name, None), None
    return None, f"attribute '{name}' not found on {type(obj).__name__}"


def _resolve_chain(root: Any, parts: list[str]) -> str | None:
    """Walk ``root.a.b.c`` and return None if valid, or an error string."""
    current = root
    for i, part in enumerate(parts):
        current, err = _resolve_attr(current, part)
        if err is not None:
            chain_so_far = ".".join(parts[: i + 1])
            return f"{chain_so_far}: {err}"
    return None


class SdkCallVisitor(ast.NodeVisitor):
    """Walk an AST and collect ``client.X.Y(...)`` chains for validation."""

    def __init__(self, client_var_names: set[str]):
        self.client_var_names = client_var_names
        self.chains: list[tuple[int, list[str]]] = []

    def _is_telnyx_client_init(self, node: ast.Call) -> str | None:
        """Return the var name if this Call is `var = telnyx.Telnyx(...)`, else None."""
        if not isinstance(node.func, ast.Attribute):
            return None
        if node.func.attr != "Telnyx":
            return None
        # Check the module is `telnyx` — best-effort name match
        return None  # handled by _scan_for_client_vars instead

    def visit_Call(self, node: ast.Call) -> None:
        # Only consider calls of the form  client_var.a.b.c(...)
        func = node.func
        parts: list[str] = []
        while isinstance(func, ast.Attribute):
            parts.append(func.attr)
            func = func.value
        if isinstance(func, ast.Name) and func.id in self.client_var_names:
            parts.reverse()
            if len(parts) >= 2:  # at least "resource.method"
                self.chains.append((node.lineno, parts))
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        # Also catch non-call attribute access like `client.foo.bar` (no call)
        # only if it's a response.data-style access — but we focus on calls.
        self.generic_visit(node)


def _scan_for_client_vars(tree: ast.AST) -> set[str]:
    """Find variable names assigned from `telnyx.Telnyx(...)` calls."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        call = node.value
        # Match `telnyx.Telnyx(...)` or just `Telnyx(...)` at module level
        func = call.func
        is_telnyx_init = False
        if isinstance(func, ast.Attribute) and func.attr == "Telnyx":
            is_telnyx_init = True
        elif isinstance(func, ast.Name) and func.id == "Telnyx":
            is_telnyx_init = True
        if not is_telnyx_init:
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                names.add(target.id)
    return names


def check_file(file_path: Path, client: Any) -> list[SdkViolation]:
    """Parse a single app.py and return SDK violations found."""
    try:
        source = file_path.read_text()
    except OSError as e:
        return [SdkViolation(str(file_path), 0, "(read)", str(e))]

    try:
        tree = ast.parse(source, filename=str(file_path))
    except SyntaxError as e:
        return [SdkViolation(str(file_path), e.lineno or 0, "(parse)", str(e))]

    client_vars = _scan_for_client_vars(tree)
    if not client_vars:
        return []  # No client detected — nothing to check

    visitor = SdkCallVisitor(client_vars)
    visitor.visit(tree)

    violations: list[SdkViolation] = []
    for lineno, parts in visitor.chains:
        err = _resolve_chain(client, parts)
        if err is not None:
            chain_str = "client." + ".".join(parts)
            violations.append(SdkViolation(str(file_path.name), lineno, chain_str, err))
    return violations


def find_python_examples() -> list[Path]:
    """Discover every `<example>/app.py` under the repo root."""
    results: list[Path] = []
    for app_py in REPO_ROOT.rglob("app.py"):
        # Skip vendor/build dirs
        if any(
            part in ("node_modules", ".venv", "venv", "__pycache__")
            for part in app_py.parts
        ):
            continue
        # Only include if the parent dir looks like an example (has a README.md)
        if (app_py.parent / "README.md").exists():
            results.append(app_py)
    return sorted(results)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate SDK method calls in Python example app.py files.",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Check only the specified example folder name.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show OK lines as well as violations.",
    )
    args = parser.parse_args()

    # Import telnyx once; fail loudly if it isn't installed.
    try:
        client = _instantiate_client()
    except ImportError as e:
        print(f"ERROR: telnyx package not installed: {e}", file=sys.stderr)
        print("Install with: pip install telnyx", file=sys.stderr)
        return 2

    files = find_python_examples()
    if args.only:
        files = [f for f in files if f.parent.name == args.only]

    if not files:
        print("No Python app.py examples found.")
        return 0

    total_violations = 0
    checked = 0

    for file_path in files:
        checked += 1
        violations = check_file(file_path, client)
        folder = file_path.parent.name

        if violations:
            print(f"FAIL   {folder}/{file_path.name}")
            for v in violations:
                print(f"  line {v.line}: {v.chain} — {v.problem}")
            total_violations += len(violations)
        elif args.verbose:
            print(f"OK     {folder}/{file_path.name}")

    print()
    print(f"Checked: {checked}  Violations: {total_violations}")

    if total_violations > 0:
        print(f"\n{total_violations} SDK call(s) reference attributes or methods")
        print("that do not exist on the installed telnyx package.")
        return 1

    print("All SDK calls resolve against the installed telnyx package.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
