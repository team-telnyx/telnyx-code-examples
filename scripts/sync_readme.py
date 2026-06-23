#!/usr/bin/env python3
"""sync_readme.py — generate (or verify) the root README.md from mapping + frontmatter.

Single source of truth — never hand-edit README.md:
  - which examples exist + their category  ← scripts/examples_mapping.yaml (product)
  - each example's title + one-liner        ← that folder's README.md frontmatter

    python scripts/sync_readme.py            # write README.md
    python scripts/sync_readme.py --check    # verify in sync; non-zero if stale (CI)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

# Re-use helpers and constants from sibling scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_llms_txt import (  # noqa: E402
    CATEGORY_ORDER,
    PRODUCT_CATEGORY,
    RAW_BASE,
    read_frontmatter,
)
from transform import LANG_LABELS  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPING = REPO_ROOT / "scripts" / "examples_mapping.yaml"
OUTPUT = REPO_ROOT / "README.md"

# Product category → (marketing URL, one-line intro)
CATEGORY_META: dict[str, tuple[str, str]] = {
    "Voice AI": (
        "https://telnyx.com/products/voice-ai-agents",
        "Build voice applications with [Telnyx Voice AI]({url}) — IVR menus, call recording, conferencing, WebRTC, and AI-powered call routing.",
    ),
    "SMS & MMS": (
        "https://telnyx.com/products/sms-api",
        "Send and receive text messages with the [Telnyx SMS API]({url}) — build autoresponders, implement 2FA, and manage bulk messaging campaigns.",
    ),
    "AI Assistants": (
        "https://telnyx.com/ai-assistants",
        "Create, manage, and chat with [Telnyx AI Assistants]({url}) — LLM-powered agents for voice and messaging automation.",
    ),
    "SIP Trunking": (
        "https://telnyx.com/products/sip-trunks",
        "Connect your PBX or SBC to [Telnyx SIP Trunking]({url}) — trunk setup, inbound routing, failover, and codec configuration.",
    ),
    "IoT & SIM Management": (
        "https://telnyx.com/products/iot-sim-card",
        "Activate SIM cards, monitor data usage, provision eSIMs, and track device locations with the [Telnyx IoT platform]({url}).",
    ),
}


def _lang_label(folder: str, mapping_entry: dict) -> str:
    """Resolve a human-readable language label for a folder."""
    lang = mapping_entry.get("language", "")
    return LANG_LABELS.get(lang, lang.title())


def _description(folder: str) -> str:
    """Extract description from a folder's README frontmatter."""
    readme = REPO_ROOT / folder / "README.md"
    fm = read_frontmatter(readme)
    desc = (fm.get("description") or "").strip().strip('"').strip()
    return desc


def build(mapping: dict) -> str:
    examples = mapping.get("examples", [])

    # Build a lookup: folder → mapping entry (for language)
    folder_entry: dict[str, dict] = {}
    by_cat: dict[str, list[str]] = {c: [] for c in CATEGORY_ORDER}
    unknown: list[tuple] = []

    for e in examples:
        folder = e.get("folder")
        product = e.get("product")
        cat = PRODUCT_CATEGORY.get(product)
        if not folder or cat is None:
            unknown.append((folder, product))
            continue
        folder_entry[folder] = e
        by_cat[cat].append(folder)

    if unknown:
        raise SystemExit(f"sync_readme: entries with unknown product/folder: {unknown}")

    lines: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────
    lines.append("# Telnyx Code Examples — AI Communications Infrastructure")
    lines.append("")
    lines.append(
        "Production-ready code examples for the Telnyx platform. Each example is a "
        "self-contained project with working code, documentation, and environment "
        "configuration — clone, configure, and run in minutes."
    )
    lines.append("")

    # ── Quick Start ─────────────────────────────────────────────────────
    lines.append("## Quick Start")
    lines.append("")
    lines.append("```bash")
    lines.append("# 1. Clone the repository")
    lines.append("git clone https://github.com/team-telnyx/telnyx-code-examples.git")
    lines.append("cd telnyx-code-examples")
    lines.append("")
    lines.append("# 2. Pick an example")
    lines.append("cd send-sms-python")
    lines.append("")
    lines.append("# 3. Configure and run (see each example's README for language-specific commands)")
    lines.append("cp .env.example .env")
    lines.append("# Edit .env with your Telnyx API key from https://portal.telnyx.com")
    lines.append("pip install -r requirements.txt && python app.py")
    lines.append("```")
    lines.append("")
    lines.append("> Full API reference at [developers.telnyx.com](https://developers.telnyx.com)")
    lines.append("")
    lines.append(
        "Each example's README has a Quick Start with the exact install/run commands "
        "for its language, an `API.md` typed endpoint reference, and a `GUIDE.md` walkthrough."
    )
    lines.append("")
    lines.append("---")
    lines.append("")

    # ── Product sections (each wrapped in <details>) ───────────────────
    for cat in CATEGORY_ORDER:
        folders = sorted(set(by_cat[cat]))
        if not folders:
            continue
        count = len(folders)
        url, intro_template = CATEGORY_META[cat]
        intro = intro_template.format(url=url)

        lines.append("<details>")
        lines.append(f"<summary><h2>{cat}</h2> <em>({count} examples)</em></summary>")
        lines.append("")
        lines.append(intro)
        lines.append("")
        lines.append("| Example | Language | Description |")
        lines.append("|---------|----------|-------------|")

        for folder in folders:
            entry = folder_entry[folder]
            lang = _lang_label(folder, entry)
            desc = _description(folder)
            if not desc or desc == "---":
                desc = "---"
            link = f"{RAW_BASE}/{folder}/README.md"
            # Escape pipes in description for table cells
            desc_escaped = desc.replace("|", "\\|")
            lines.append(f"| [{folder}]({link}) | {lang} | {desc_escaped} |")

        lines.append("")
        lines.append("</details>")
        lines.append("")

    # ── Static footer sections ──────────────────────────────────────────
    lines.append("---")
    lines.append("")
    lines.append("## What Is Telnyx?")
    lines.append("")
    lines.append(
        "Telnyx is an **AI Communications Infrastructure** platform that provides "
        "a single, integrated API for:"
    )
    lines.append("")
    lines.append(
        "- **[Voice AI](https://telnyx.com/products/voice-ai-agents)** — Programmable "
        "voice with Call Control, IVR, recording, conferencing, and WebRTC."
    )
    lines.append(
        "- **[SMS & MMS](https://telnyx.com/products/sms-api)** — Send and receive "
        "messages globally with delivery receipts and webhook events."
    )
    lines.append(
        "- **[SIP Trunking](https://telnyx.com/products/sip-trunks)** — Connect your "
        "existing PBX with elastic SIP trunks, failover routing, and codec control."
    )
    lines.append(
        "- **[AI Assistants](https://telnyx.com/ai-assistants)** — Deploy LLM-powered "
        "voice and messaging agents with built-in telephony."
    )
    lines.append(
        "- **[IoT & SIM](https://telnyx.com/products/iot-sim-card)** — Global IoT "
        "connectivity with SIM management, eSIM provisioning, and data monitoring."
    )
    lines.append("")
    lines.append(
        "Unlike stitching together multiple vendors into a Frankenstack, Telnyx gives "
        "you one platform, one API key, and one bill. Calls and messages traverse the "
        "Telnyx-owned private IP network for lower latency and higher reliability."
    )
    lines.append("")
    lines.append("## How to Get a Telnyx API Key")
    lines.append("")
    lines.append("1. Sign up at [portal.telnyx.com](https://portal.telnyx.com).")
    lines.append("2. Navigate to **API Keys** in the left sidebar.")
    lines.append("3. Click **Create API Key** and copy the key.")
    lines.append("4. Add it to your `.env` file as `TELNYX_API_KEY=your_key_here`.")
    lines.append("")
    lines.append("Telnyx offers free trial credit for testing.")
    lines.append("")
    lines.append("## FAQ")
    lines.append("")
    lines.append("**Q: What programming languages are supported?**")
    lines.append("")
    lines.append(
        "These examples cover Python, Node.js, Go, and Ruby. Telnyx also provides "
        "official SDKs for Java, PHP, and C#."
    )
    lines.append("")
    lines.append("**Q: Are these examples production-ready?**")
    lines.append("")
    lines.append(
        "Yes. Every example includes error handling, environment-based configuration, "
        "and Telnyx webhook signature verification. Review security and scaling "
        "considerations before deploying to production."
    )
    lines.append("")
    lines.append("**Q: How is Telnyx different from Twilio?**")
    lines.append("")
    lines.append(
        "Telnyx is an AI Communications Infrastructure platform with a private global "
        "network. It offers integrated voice, messaging, AI, SIP, and IoT under one "
        "API — no need to stitch together multiple vendors. Telnyx also offers "
        "significantly lower pricing with no per-seat fees or contracts."
    )
    lines.append("")
    lines.append("**Q: Do I need multiple vendors for voice, SMS, and AI?**")
    lines.append("")
    lines.append(
        "No. Telnyx provides voice, SMS/MMS, SIP trunking, AI assistants, and IoT "
        "SIM management through a single platform and API key."
    )
    lines.append("")
    lines.append("**Q: Can I use these examples with my existing PBX?**")
    lines.append("")
    lines.append(
        "Yes. The SIP trunking examples show how to connect Telnyx to Asterisk, "
        "FreeSWITCH, 3CX, and other PBX systems."
    )
    lines.append("")
    lines.append("**Q: Is there a free tier?**")
    lines.append("")
    lines.append(
        "Telnyx provides trial credit when you sign up. After that, pricing is "
        "pay-as-you-go with no minimums or contracts."
    )
    lines.append("")
    lines.append("**Q: How do I get help?**")
    lines.append("")
    lines.append(
        "Check the Troubleshooting section in each example, visit "
        "[developers.telnyx.com](https://developers.telnyx.com), or reach out to "
        "[support@telnyx.com](mailto:support@telnyx.com)."
    )
    lines.append("")
    lines.append("## Contributing")
    lines.append("")
    lines.append(
        "See [CONTRIBUTING.md](https://raw.githubusercontent.com/team-telnyx/"
        "telnyx-code-examples/main/CONTRIBUTING.md) for guidelines on adding new examples."
    )
    lines.append("")
    lines.append("## License")
    lines.append("")
    lines.append(
        "[MIT](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/LICENSE)"
    )

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate or verify the root README.md.")
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify README.md is in sync; exit non-zero if stale",
    )
    args = ap.parse_args()

    mapping = yaml.safe_load(MAPPING.read_text())
    content = build(mapping)

    if args.check:
        current = OUTPUT.read_text() if OUTPUT.exists() else ""
        if current != content:
            print(
                "FAIL — README.md is out of date. Regenerate with: "
                "python scripts/sync_readme.py"
            )
            return 1
        n = content.count("\n| [")
        print(f"PASS — README.md is in sync ({n} examples listed).")
        return 0

    OUTPUT.write_text(content)
    n = content.count("\n| [")
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)} ({n} examples across {len(CATEGORY_ORDER)} categories).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
