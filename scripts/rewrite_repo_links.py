#!/usr/bin/env python3
"""rewrite_repo_links.py — convert relative in-repo doc links to absolute raw URLs.

Marketing requirement: every "back-in-repo" link in the published docs must be an
absolute https://raw.githubusercontent.com/... URL (so answer engines / aggregators
that follow a link get clean raw markdown, not GitHub's HTML chrome).

Scope (the published doc surface only):
  - the root README.md
  - every example folder's README.md / API.md / GUIDE.md  (folders ending in a
    known language suffix)

Transform, per relative link target:
  - external (http/https), pure #anchors, and mailto: links      → left untouched
  - a link that resolves to a DIRECTORY (e.g. ../send-sms-python/) → that dir's
    README.md is appended (raw cannot serve a directory listing)
  - a link that resolves to a FILE (./API.md, ./app.rb, ...)       → used as-is
  Everything is rewritten to:  {BASE}{repo-relative-path}

Idempotent: links already pointing at BASE are skipped, so it is safe to re-run
(e.g. after adding examples). Fenced ``` code blocks are left untouched.

    python scripts/rewrite_repo_links.py            # rewrite in place
    python scripts/rewrite_repo_links.py --check     # report only, non-zero if any remain
    python scripts/rewrite_repo_links.py --verbose
"""
from __future__ import annotations

import argparse
import posixpath
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE = "https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/"

LANG_SUFFIXES = ("-python", "-nodejs", "-go", "-ruby", "-php", "-java", "-csharp")
EXAMPLE_DOCS = ("README.md", "API.md", "GUIDE.md")

# A markdown inline link: ](target) or ](target "title"). target has no whitespace.
LINK_RE = re.compile(r"\]\((?P<target>[^)\s]+)(?P<title>\s+\"[^\"]*\")?\)")


def is_example_dir(name: str) -> bool:
    return name.endswith(LANG_SUFFIXES)


def doc_files() -> list[Path]:
    files = []
    root_readme = REPO_ROOT / "README.md"
    if root_readme.is_file():
        files.append(root_readme)
    for d in sorted(REPO_ROOT.iterdir()):
        if d.is_dir() and is_example_dir(d.name):
            for doc in EXAMPLE_DOCS:
                p = d / doc
                if p.is_file():
                    files.append(p)
    return files


def rewrite_target(target: str, file_dir_rel: str) -> str | None:
    """Return the absolute raw URL for a relative target, or None to leave it alone."""
    if target.startswith(("http://", "https://", "mailto:", "#")):
        return None
    # split off any #anchor / ?query so it survives onto the new URL
    suffix = ""
    for sep in ("#", "?"):
        if sep in target:
            target, rest = target.split(sep, 1)
            suffix = sep + rest + suffix
    if target == "":  # was a pure anchor/query
        return None
    is_dir_hint = target.endswith("/")
    rel = posixpath.normpath(posixpath.join(file_dir_rel, target))
    if rel.startswith(".."):
        return None  # escapes the repo — leave it (shouldn't happen in practice)
    on_disk = REPO_ROOT / rel
    if is_dir_hint or on_disk.is_dir():
        rel = posixpath.join(rel, "README.md")
    return BASE + rel + suffix


def process_text(text: str, file_dir_rel: str) -> tuple[str, int]:
    lines = text.split("\n")
    in_fence = False
    changed = 0

    def repl(m: re.Match) -> str:
        nonlocal changed
        target = m.group("target")
        new = rewrite_target(target, file_dir_rel)
        if new is None or new == target:
            return m.group(0)
        changed += 1
        return f"]({new}{m.group('title') or ''})"

    out = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            out.append(line)
            continue
        out.append(line if in_fence else LINK_RE.sub(repl, line))
    return "\n".join(out), changed


def main() -> int:
    ap = argparse.ArgumentParser(description="Rewrite relative in-repo doc links to absolute raw URLs.")
    ap.add_argument("--check", action="store_true", help="report only; exit non-zero if any relative in-repo links remain")
    ap.add_argument("--verbose", action="store_true", help="list each file touched")
    args = ap.parse_args()

    files = doc_files()
    total_changed = 0
    files_touched = 0
    for f in files:
        rel_dir = str(f.parent.relative_to(REPO_ROOT))
        rel_dir = "" if rel_dir == "." else rel_dir
        original = f.read_text()
        new_text, changed = process_text(original, rel_dir)
        if changed:
            total_changed += changed
            files_touched += 1
            if args.verbose or args.check:
                print(f"  {'would fix' if args.check else 'fixed'} {f.relative_to(REPO_ROOT)}: {changed} link(s)")
            if not args.check:
                f.write_text(new_text)

    print(f"\nScanned {len(files)} doc files.")
    if args.check:
        if total_changed:
            print(f"FAIL — {total_changed} relative in-repo link(s) in {files_touched} file(s) are not absolute raw URLs.")
            return 1
        print("PASS — all in-repo doc links are absolute raw.githubusercontent.com URLs.")
        return 0
    print(f"Rewrote {total_changed} link(s) across {files_touched} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
