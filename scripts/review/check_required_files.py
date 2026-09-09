#!/usr/bin/env python3
"""check_required_files.py — per-example structural gate for the PR-review toolkit.

Confirms each example folder has the required files, the right language
code+dependency files, and NONE of the forbidden deploy-scaffolding files
(Dockerfile/Makefile) that CLAUDE.md bans. Knows the newer languages
(php/java/csharp) that the in-repo verify.py mappings don't yet cover.

    python scripts/review/check_required_files.py
    python scripts/review/check_required_files.py --path /tmp/some-pr-worktree

Exits non-zero on any violation, so it can gate CI.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REQUIRED_DOCS = ["README.md", "API.md", "GUIDE.md", ".env.example"]
FORBIDDEN = ["Dockerfile", "Makefile", "docker-compose.yml", "docker-compose.yaml", "Procfile"]

# language suffix -> (code-file matcher, dependency file)
LANG = {
    "python": (["app.py"], "requirements.txt"),
    "nodejs": (["server.js"], "package.json"),
    "go": (["main.go"], "go.mod"),
    "ruby": (["app.rb"], "Gemfile"),
    "php": (["index.php"], "composer.json"),
    "java": (["*.java"], "pom.xml"),
    "csharp": (["*.cs"], "*.csproj"),
    # edge-compute uses func.toml as the "code" entry; handled loosely below
}


def lang_of(folder: str) -> str | None:
    for suffix in LANG:
        if folder.endswith(f"-{suffix}"):
            return suffix
    return None


def has(folder: Path, patterns: list[str]) -> bool:
    for pat in patterns:
        if "*" in pat:
            if any(folder.glob(pat)):
                return True
        elif (folder / pat).is_file():
            return True
    return False


def check_example(folder: Path) -> list[tuple[str, str]]:
    """Return list of (severity, message)."""
    out = []
    lang = lang_of(folder.name)
    if lang is None:
        return out  # not a recognized example folder; skip
    # required docs + env
    for f in REQUIRED_DOCS:
        if not (folder / f).is_file():
            out.append(("error", f"missing {f}"))
    # code + dependency files
    code_pats, dep = LANG[lang]
    # Edge Compute examples ship func.toml + a function/ package instead of a
    # single app.py — verify.py treats func.toml as the code file, so mirror that
    # here to avoid false-positives on those folders.
    if (folder / "func.toml").is_file():
        code_pats = ["func.toml"]
    if not has(folder, code_pats):
        out.append(("error", f"missing code file ({'/'.join(code_pats)})"))
    if not has(folder, [dep]):
        out.append(("error", f"missing dependency file ({dep})"))
    # forbidden scaffolding
    for f in FORBIDDEN:
        if (folder / f).is_file():
            out.append(("error", f"forbidden file present: {f}"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Per-example required/forbidden file gate.")
    ap.add_argument("--path", default=".", help="root containing example folders (default: cwd)")
    ap.add_argument("--changed-against", metavar="REF",
                    help="diff-aware: only check example folders changed vs this git ref (CI mode)")
    ap.add_argument("--verbose", action="store_true", help="list clean folders too")
    args = ap.parse_args()

    root = Path(args.path).resolve()
    only = None
    if args.changed_against:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from _changed import changed_example_dirs
        only = set(changed_example_dirs(root, args.changed_against))
        if not only:
            print(f"Structural check (diff-aware): no example folders changed vs {args.changed_against}.\n\nPASS")
            return 0
        print(f"Structural check (diff-aware): {len(only)} changed folder(s) vs {args.changed_against}")
    bad = 0
    checked = 0
    langs_seen: dict[str, int] = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        lang = lang_of(folder.name)
        if lang is None:
            continue
        if only is not None and folder.name not in only:
            continue
        checked += 1
        langs_seen[lang] = langs_seen.get(lang, 0) + 1
        issues = check_example(folder)
        if issues:
            bad += 1
            print(f"  ✗ {folder.name}")
            for sev, msg in issues:
                print(f"      - {msg}")
        elif args.verbose:
            print(f"  ✓ {folder.name}")

    print(f"\nStructural check: {checked} example folders ({langs_seen})")
    print(f"  folders with violations: {bad}")
    if bad:
        print("\nFAIL — every example needs README/API.md/GUIDE.md/.env.example + code + dep file, and no Dockerfile/Makefile.")
        return 1
    print("\nPASS — all example folders are structurally complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
