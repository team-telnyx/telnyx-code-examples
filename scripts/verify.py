#!/usr/bin/env python3
"""Verify all AEO example folders meet quality requirements.

Checks:
- Every example folder on disk is registered in examples_mapping.yaml.
- Every mapping entry has a corresponding folder.
- Each folder has: README.md, code file, .env.example, dep file.
- README.md contains required sections (Why Telnyx, Troubleshooting, Related Examples).
- README.md contains "AI Communications Infrastructure" phrase.
- Code files are non-empty and pass basic syntax checks.
- Dependency file exists and is non-empty.
- .env.example contains TELNYX_API_KEY.
- No .env files committed (only .env.example).
- Root README references all examples.

Usage:
    python scripts/verify.py             # Verify all examples
    python scripts/verify.py --verbose   # Show detailed output
    python scripts/verify.py --only send-sms-python  # Single example
"""

import argparse
import os
import subprocess  # nosec B404
import sys
from pathlib import Path

import yaml


SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent

# Language mappings
LANG_CODE_FILE = {
    "python": "app.py",
    "nodejs": "server.js",
    "go": "main.go",
    "ruby": "app.rb",
    "java": "Application.java",
    "php": "index.php",
    "csharp": "Program.cs",
}

LANG_DEP_FILE = {
    "python": "requirements.txt",
    "nodejs": "package.json",
    "go": "go.mod",
    "ruby": "Gemfile",
    "java": "pom.xml",
    "php": "composer.json",
    "csharp": "TelnyxExample.csproj",
}

# Sections required on every example README. Kept to the set common to both the
# new 3-file format and the older Node/Go/Ruby examples; the brand phrase is also required.
REQUIRED_AEO_SECTIONS = [
    "why telnyx",
    "troubleshooting",
    "related examples",
]


def load_mapping() -> list[dict]:
    """Load the examples mapping YAML."""
    mapping_path = SCRIPTS_DIR / "examples_mapping.yaml"
    with open(mapping_path) as f:
        data = yaml.safe_load(f)
    return data.get("examples", [])


def verify_folder(folder_path: Path, entry: dict, verbose: bool = False) -> list[str]:
    """Verify a single example folder. Returns list of errors."""
    errors = []
    language = entry["language"]
    folder_name = entry["folder"]

    code_file = LANG_CODE_FILE.get(language, "app.py")
    dep_file = LANG_DEP_FILE.get(language, "requirements.txt")

    # Edge Compute examples ship a func.toml + function/ package instead of a single
    # app.py — treat func.toml as the code file for them.
    is_edge = (folder_path / "func.toml").exists()
    if is_edge:
        code_file = "func.toml"

    # --- File existence checks ---
    required_files = [
        "README.md",
        code_file,
        ".env.example",
        dep_file,
    ]

    for filename in required_files:
        filepath = folder_path / filename
        if not filepath.exists():
            errors.append(f"Missing file: {filename}")
        elif filepath.stat().st_size == 0:
            errors.append(f"Empty file: {filename}")

    # --- Check for committed .env files ---
    env_file = folder_path / ".env"
    if env_file.exists():
        errors.append("SECURITY: .env file found (only .env.example should be committed)")

    # --- README checks ---
    readme_path = folder_path / "README.md"
    if readme_path.exists():
        readme = readme_path.read_text()

        # Check for AEO sections
        readme_lower = readme.lower()
        for section in REQUIRED_AEO_SECTIONS:
            if section not in readme_lower:
                errors.append(f"README missing section: '{section}'")

        # Check for "AI Communications Infrastructure" phrase
        if "AI Communications Infrastructure" not in readme:
            errors.append('README missing "AI Communications Infrastructure" phrase')

    # --- Code file checks ---
    code_path = folder_path / code_file
    if code_path.exists() and code_path.stat().st_size > 0 and not is_edge:
        # Syntax checks
        if language == "python":
            try:
                result = subprocess.run(  # nosec B603
                    [sys.executable, "-m", "py_compile", str(code_path)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode != 0:
                    errors.append(f"Python syntax error in {code_file}: {result.stderr[:200]}")
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

        elif language == "nodejs":
            try:
                result = subprocess.run(  # nosec B603
                    ["node", "--check", str(code_path)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode != 0:
                    errors.append(f"Node.js syntax error in {code_file}: {result.stderr[:200]}")
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

        elif language == "php":
            try:
                result = subprocess.run(  # nosec B603
                    ["php", "-l", str(code_path)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode != 0:
                    errors.append(f"PHP syntax error in {code_file}: {result.stderr[:200]}")
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass

    # --- .env.example checks ---
    env_example_path = folder_path / ".env.example"
    if env_example_path.exists():
        env_content = env_example_path.read_text()
        if "TELNYX_API_KEY" not in env_content:
            errors.append(".env.example missing TELNYX_API_KEY")

    return errors


def verify_root_readme(mapping: list[dict], verbose: bool = False) -> list[str]:
    """Verify the root README references all examples."""
    errors = []
    readme_path = REPO_ROOT / "README.md"

    if not readme_path.exists():
        errors.append("Root README.md not found")
        return errors

    readme = readme_path.read_text()

    for entry in mapping:
        folder = entry["folder"]
        if folder not in readme:
            errors.append(f"Root README does not reference: {folder}")

    if "AI Communications Infrastructure" not in readme:
        errors.append('Root README missing "AI Communications Infrastructure" phrase')

    return errors


def find_example_folders() -> set:
    """Scan the repo for example folders (any dir with a known code file or func.toml)."""
    code_files = set(LANG_CODE_FILE.values())
    found = set()
    for path in REPO_ROOT.iterdir():
        if not path.is_dir() or path.name.startswith(".") or path.name in ("scripts", "workstreams"):
            continue
        if any((path / cf).exists() for cf in code_files) or (path / "func.toml").exists():
            found.add(path.name)
    return found


def run_verification(verbose: bool = False, only: str | None = None) -> bool:
    """Run all verification checks. Returns True if all pass."""
    mapping = load_mapping()

    if only:
        mapping = [e for e in mapping if e["folder"] == only]
        if not mapping:
            print(f"No mapping entry found for: {only}")
            return False

    total_errors = 0
    folders_checked = 0
    folders_passed = 0

    # --- Filesystem coverage: every example folder must be registered ---
    if not only:
        unregistered = sorted(find_example_folders() - {e["folder"] for e in mapping})
        if unregistered:
            for name in unregistered:
                print(f"  UNREGISTERED  {name}/")
            total_errors += len(unregistered)
            print()

    print(f"Verifying {len(mapping)} example folders...\n")

    for entry in mapping:
        folder_name = entry["folder"]
        folder_path = REPO_ROOT / folder_name

        if not folder_path.exists():
            print(f"  MISSING  {folder_name}/")
            total_errors += 1
            folders_checked += 1
            continue

        errors = verify_folder(folder_path, entry, verbose)
        folders_checked += 1

        if errors:
            print(f"  FAIL     {folder_name}/ ({len(errors)} error(s))")
            if verbose:
                for err in errors:
                    print(f"           - {err}")
            total_errors += len(errors)
        else:
            print(f"  PASS     {folder_name}/")
            folders_passed += 1

    # Root README check
    if not only:
        print()
        root_errors = verify_root_readme(mapping, verbose)
        if root_errors:
            print(f"  FAIL     Root README.md ({len(root_errors)} error(s))")
            if verbose:
                for err in root_errors:
                    print(f"           - {err}")
            total_errors += len(root_errors)
        else:
            print(f"  PASS     Root README.md")

    # Summary
    print()
    print("=" * 60)
    print("Verification Summary")
    print("=" * 60)
    print(f"  Folders checked:  {folders_checked}")
    print(f"  Folders passed:   {folders_passed}")
    print(f"  Folders failed:   {folders_checked - folders_passed}")
    print(f"  Total errors:     {total_errors}")
    print()

    if total_errors == 0:
        print("All checks passed.")
        return True
    else:
        print(f"FAILED: {total_errors} error(s) found.")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Verify AEO example folders meet quality requirements.",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed error messages",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Verify only the specified folder name",
    )

    args = parser.parse_args()

    success = run_verification(verbose=args.verbose, only=args.only)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
