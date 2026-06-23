#!/usr/bin/env python3
"""gen_llms_txt.py — generate (or verify) the root llms.txt and catalog.json.

llms.txt (https://llmstxt.org/) is an LLM-facing index of the repo: a curated,
flat map of every example so answer engines can navigate the whole catalog from
one file. This repo's audience IS answer engines, so it's directly on-mission.

catalog.json is a machine-readable JSON manifest of every example with structured
metadata (folder, title, description, product, language, framework, URL).

Single source of truth — never hand-edit llms.txt or catalog.json:
  - which examples exist + their category  ← scripts/examples_mapping.yaml (product)
  - each example's title + one-liner        ← that folder's README.md frontmatter

Links are absolute raw.githubusercontent.com URLs (same convention as every other
back-in-repo link — see rewrite_repo_links.py / CLAUDE.md), so an LLM that follows
a link gets the raw README markdown directly.

    python scripts/gen_llms_txt.py            # write llms.txt + catalog.json
    python scripts/gen_llms_txt.py --check     # verify in sync; non-zero if stale (CI)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPING = REPO_ROOT / "scripts" / "examples_mapping.yaml"
OUTPUT = REPO_ROOT / "llms.txt"
CATALOG_OUTPUT = REPO_ROOT / "catalog.json"
RAW_BASE = "https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main"
REPO_URL = "https://github.com/team-telnyx/telnyx-code-examples"

TITLE = "Telnyx Code Examples — AI Communications Infrastructure"
SUMMARY = (
    "Production-ready, deployable code examples for Telnyx APIs across voice, "
    "messaging, AI assistants, SIP trunking, and IoT. Each link is the raw README "
    "for a self-contained example you can clone, configure, and run independently."
)

# product (examples_mapping.yaml) -> category heading, in the order they appear in
# the root README. Every product must map to exactly one category.
PRODUCT_CATEGORY = {
    "voice": "Voice AI",
    "sms": "SMS & MMS",
    "ai": "AI Assistants",
    "sip": "SIP Trunking",
    "iot": "IoT & SIM Management",
}
CATEGORY_ORDER = ["Voice AI", "SMS & MMS", "AI Assistants", "SIP Trunking", "IoT & SIM Management"]

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)


def read_frontmatter(readme: Path) -> dict:
    try:
        text = readme.read_text()
    except OSError:
        return {}
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def first_h1(readme: Path) -> str | None:
    try:
        for line in readme.read_text().splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return None


def titleize(folder: str) -> str:
    return folder.replace("-", " ").title()


def label_and_note(folder: str) -> tuple[str, str]:
    """(link text, optional note) for an example, from its README."""
    readme = REPO_ROOT / folder / "README.md"
    fm = read_frontmatter(readme)
    title = (fm.get("title") or "").strip().strip('"').strip()
    desc = (fm.get("description") or "").strip().strip('"').strip()
    label = title or first_h1(readme) or titleize(folder)
    note = desc
    # Avoid an ugly "[sentence](url): same sentence" when title doubles as the
    # description (a few examples carry a sentence in both fields).
    if note and note.strip() == label.strip():
        note = ""
    return label, note


def build(mapping: dict) -> str:
    examples = mapping.get("examples", [])
    by_cat: dict[str, list] = {c: [] for c in CATEGORY_ORDER}
    unknown = []
    for e in examples:
        folder = e.get("folder")
        product = e.get("product")
        cat = PRODUCT_CATEGORY.get(product)
        if not folder or cat is None:
            unknown.append((folder, product))
            continue
        by_cat[cat].append(folder)
    if unknown:
        raise SystemExit(f"gen_llms_txt: entries with unknown product/folder: {unknown}")

    lines = [f"# {TITLE}", "", f"> {SUMMARY}", ""]
    for cat in CATEGORY_ORDER:
        folders = sorted(set(by_cat[cat]))
        if not folders:
            continue
        lines.append(f"## {cat}")
        lines.append("")
        for folder in folders:
            label, note = label_and_note(folder)
            url = f"{RAW_BASE}/{folder}/README.md"
            entry = f"- [{label}]({url})"
            if note:
                entry += f": {note}"
            lines.append(entry)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def generate_catalog(mapping: dict) -> str:
    """Build a JSON catalog of every example with structured metadata."""
    examples = mapping.get("examples", [])
    entries = []
    seen: set[str] = set()

    for e in examples:
        folder = e.get("folder")
        if not folder or folder in seen:
            continue
        seen.add(folder)
        product = e.get("product", "")
        language = e.get("language", "")
        framework = e.get("framework", "")

        readme = REPO_ROOT / folder / "README.md"
        fm = read_frontmatter(readme)
        title = (fm.get("title") or "").strip().strip('"').strip() or titleize(folder)
        desc = (fm.get("description") or "").strip().strip('"').strip()

        entries.append({
            "folder": folder,
            "title": title,
            "description": desc,
            "product": product,
            "language": language,
            "framework": framework,
            "url": f"{REPO_URL}/tree/main/{folder}",
        })

    catalog = {
        "name": "Telnyx Code Examples",
        "description": "Production-ready code examples for Telnyx AI Communications Infrastructure.",
        "homepage": "https://developers.telnyx.com",
        "repository": REPO_URL,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "example_count": len(entries),
        "examples": entries,
    }
    return json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"


def _catalog_equal(a: str, b: str) -> bool:
    """Compare two catalog JSON strings ignoring the generated_at timestamp."""
    try:
        da, db = json.loads(a), json.loads(b)
    except (json.JSONDecodeError, TypeError):
        return False
    da.pop("generated_at", None)
    db.pop("generated_at", None)
    return da == db


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Generate or verify the root llms.txt and catalog.json."
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify llms.txt and catalog.json are in sync; exit non-zero if stale",
    )
    args = ap.parse_args()

    mapping = yaml.safe_load(MAPPING.read_text())
    content = build(mapping)
    catalog = generate_catalog(mapping)
    failed = False

    if args.check:
        current = OUTPUT.read_text() if OUTPUT.exists() else ""
        if current != content:
            print("FAIL — llms.txt is out of date. Regenerate with: python scripts/gen_llms_txt.py")
            failed = True
        else:
            n = content.count("\n- [")
            print(f"PASS — llms.txt is in sync ({n} examples indexed).")

        current_catalog = CATALOG_OUTPUT.read_text() if CATALOG_OUTPUT.exists() else ""
        if not _catalog_equal(current_catalog, catalog):
            print("FAIL — catalog.json is out of date. Regenerate with: python scripts/gen_llms_txt.py")
            failed = True
        else:
            count = json.loads(catalog)["example_count"]
            print(f"PASS — catalog.json is in sync ({count} examples).")

        return 1 if failed else 0

    OUTPUT.write_text(content)
    n = content.count("\n- [")
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)} ({n} examples across {len(CATEGORY_ORDER)} categories).")

    CATALOG_OUTPUT.write_text(catalog)
    count = json.loads(catalog)["example_count"]
    print(f"Wrote {CATALOG_OUTPUT.relative_to(REPO_ROOT)} ({count} examples).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
