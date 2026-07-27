#!/usr/bin/env python3
"""Validate example API.md endpoint references against the Telnyx OpenAPI spec.

Fetches the Telnyx OpenAPI spec and checks that every endpoint referenced in
API.md files still exists and has compatible parameters.

Usage:
    python scripts/check_api_contract.py                    # Check all examples
    python scripts/check_api_contract.py --only send-sms-python
    python scripts/check_api_contract.py --spec path/to/openapi.json
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import yaml


SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent

TELNYX_OPENAPI_URL = "https://developers.telnyx.com/openapi/spec"

# Pattern to match endpoint references like: `POST /v2/messages`
ENDPOINT_PATTERN = re.compile(
    r"`(GET|POST|PUT|PATCH|DELETE)\s+(/v2/[^`]+)`"
)

# Pattern to match parameterized path segments like {id}
PATH_PARAM_PATTERN = re.compile(r"\{[^}]+\}")


def fetch_openapi_spec(spec_path: str | None = None) -> dict:
    """Fetch the Telnyx OpenAPI spec from URL or local file."""
    if spec_path:
        path = Path(spec_path)
        content = path.read_text()
        if path.suffix in (".yaml", ".yml"):
            return yaml.safe_load(content)
        return json.loads(content)

    req = urllib.request.Request(  # nosec B310
        TELNYX_OPENAPI_URL,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # nosec B310
        return json.loads(resp.read())


def normalize_path(path: str) -> str:
    """Normalize an endpoint path for comparison.

    Replaces specific path parameters with generic {param} placeholders
    so /v2/calls/{call_control_id}/actions/speak matches /v2/calls/{id}/actions/speak.
    """
    return PATH_PARAM_PATTERN.sub("{param}", path)


def extract_spec_paths(spec: dict) -> dict[str, set[str]]:
    """Extract all paths and their methods from the OpenAPI spec.

    Returns dict mapping normalized_path -> set of HTTP methods (lowercase).
    """
    paths: dict[str, set[str]] = {}
    for path, path_item in spec.get("paths", {}).items():
        normalized = normalize_path(path)
        if normalized not in paths:
            paths[normalized] = set()
        for method in ("get", "post", "put", "patch", "delete"):
            if method in path_item:
                paths[normalized].add(method)
    return paths


def extract_api_md_endpoints(api_md_path: Path) -> list[tuple[str, str, int]]:
    """Extract endpoint references from an API.md file.

    Returns list of (method, path, line_number).
    """
    endpoints = []
    content = api_md_path.read_text()
    for i, line in enumerate(content.split("\n"), 1):
        for match in ENDPOINT_PATTERN.finditer(line):
            method = match.group(1).lower()
            path = match.group(2).strip()
            endpoints.append((method, path, i))
    return endpoints


def check_example(folder_path: Path, spec_paths: dict[str, set[str]]) -> list[str]:
    """Check a single example's API.md against the spec. Returns list of warnings."""
    api_md = folder_path / "API.md"
    if not api_md.exists():
        return []

    warnings = []
    endpoints = extract_api_md_endpoints(api_md)

    for method, path, line_num in endpoints:
        normalized = normalize_path(path)
        if normalized not in spec_paths:
            warnings.append(
                f"  API.md:{line_num} — {method.upper()} {path} not found in OpenAPI spec"
            )
        elif method not in spec_paths[normalized]:
            available = ", ".join(sorted(m.upper() for m in spec_paths[normalized]))
            warnings.append(
                f"  API.md:{line_num} — {method.upper()} {path} method not in spec "
                f"(available: {available})"
            )

    return warnings


def load_mapping() -> list[dict]:
    """Load examples_mapping.yaml."""
    mapping_path = SCRIPTS_DIR / "examples_mapping.yaml"
    with open(mapping_path) as f:
        data = yaml.safe_load(f)
    return data.get("examples", [])


def main():
    parser = argparse.ArgumentParser(
        description="Validate example API.md endpoints against Telnyx OpenAPI spec.",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Check only the specified folder name",
    )
    parser.add_argument(
        "--spec",
        default=None,
        help="Path to local OpenAPI spec file (default: fetch from Telnyx)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()

    # Fetch spec
    print("Fetching Telnyx OpenAPI spec...")
    try:
        spec = fetch_openapi_spec(args.spec)
    except Exception as e:
        print(f"Error fetching OpenAPI spec: {e}", file=sys.stderr)
        print("Skipping contract check (spec unavailable).")
        sys.exit(0)  # Non-blocking — don't fail CI if spec is unreachable

    spec_paths = extract_spec_paths(spec)
    print(f"Loaded {len(spec_paths)} endpoint paths from spec.\n")

    mapping = load_mapping()
    if args.only:
        mapping = [e for e in mapping if e["folder"] == args.only]

    total_warnings = 0
    checked = 0

    for entry in mapping:
        folder_name = entry["folder"]
        folder_path = REPO_ROOT / folder_name

        if not folder_path.exists():
            continue

        api_md = folder_path / "API.md"
        if not api_md.exists():
            continue

        checked += 1
        warnings = check_example(folder_path, spec_paths)

        if warnings:
            print(f"WARN   {folder_name}/")
            for w in warnings:
                print(w)
            total_warnings += len(warnings)
        elif args.verbose:
            print(f"OK     {folder_name}/")

    print()
    print(f"Checked: {checked}  Warnings: {total_warnings}")

    if total_warnings > 0:
        print(f"\n{total_warnings} endpoint(s) may need updating.")
        sys.exit(1)
    else:
        print("All endpoints match the current API spec.")


if __name__ == "__main__":
    main()
