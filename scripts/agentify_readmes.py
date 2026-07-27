#!/usr/bin/env python3
"""Retrofit all example READMEs with agent-friendly content.

Adds three things to each example README.md:

1. "Agent / CLI access" blockquote after the Environment Variables table
2. <details> "Programmatic / CLI setup" block after the Setup bash block
3. "## Agent Discovery" section before ## Resources (or at end)

Idempotent — checks for sentinel strings before inserting.

Usage:
    python scripts/agentify_readmes.py              # Update all examples
    python scripts/agentify_readmes.py --only send-sms-python
    python scripts/agentify_readmes.py --dry-run     # Preview without writing
"""

import argparse
import re
import sys
from pathlib import Path

import yaml


SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent

# ---------------------------------------------------------------------------
# Env-var → CLI command mapping
# ---------------------------------------------------------------------------

ENV_VAR_CLI_COMMANDS: dict[str, list[str]] = {
    "TELNYX_PHONE_NUMBER": [
        "telnyx available-phone-numbers list --country US",
        "telnyx number-orders create --phone-number +15551234567",
    ],
    "MAIN_NUMBER": [
        "telnyx available-phone-numbers list --country US",
        "telnyx number-orders create --phone-number +15551234567",
    ],
    "TELNYX_FROM_NUMBER": [
        "telnyx available-phone-numbers list --country US",
        "telnyx number-orders create --phone-number +15551234567",
    ],
    "FROM_NUMBER": [
        "telnyx available-phone-numbers list --country US",
        "telnyx number-orders create --phone-number +15551234567",
    ],
    "TELNYX_MESSAGING_PROFILE_ID": [
        "telnyx messaging-profiles create --name my-profile",
    ],
    "MESSAGING_PROFILE_ID": [
        "telnyx messaging-profiles create --name my-profile",
    ],
    "TELNYX_CONNECTION_ID": [
        "telnyx call-control-applications list",
    ],
    "CONNECTION_ID": [
        "telnyx call-control-applications list",
    ],
    "TELNYX_SIP_CONNECTION_ID": [
        "telnyx credential-connections list",
    ],
    "TELNYX_SIM_CARD_ID": [
        "telnyx sim-cards list",
    ],
    "SIM_CARD_ID": [
        "telnyx sim-cards list",
    ],
    "TELNYX_ASSISTANT_ID": [
        "telnyx ai-assistants list",
    ],
    "ASSISTANT_ID": [
        "telnyx ai-assistants list",
    ],
}

# Sentinel strings for idempotency
SENTINEL_CLI_BLOCKQUOTE = "Agent / CLI access"
SENTINEL_AGENT_DISCOVERY = "## Agent Discovery"
SENTINEL_CLI_SETUP = "Programmatic / CLI setup"

# ---------------------------------------------------------------------------
# Portal → CLI link mapping for env var tables
# ---------------------------------------------------------------------------

CLI_DOCS_URL = "https://developers.telnyx.com/development/cli"

PORTAL_TO_CLI: dict[str, str] = {
    "portal.telnyx.com/api-keys": "[CLI: `telnyx auth`]({cli})",
    "portal.telnyx.com/app/api-keys": "[CLI: `telnyx auth`]({cli})",
    "portal.telnyx.com/#/app/account/keys": "[CLI: `telnyx auth`]({cli})",
    "portal.telnyx.com/numbers": "[CLI: `telnyx number-orders`]({cli})",
    "portal.telnyx.com/numbers/my-numbers": "[CLI: `telnyx number-orders`]({cli})",
    "portal.telnyx.com/call-control": "[CLI: `telnyx call-control-applications`]({cli})",
    "portal.telnyx.com/call-control/applications": "[CLI: `telnyx call-control-applications`]({cli})",
    "portal.telnyx.com/messaging/profiles": "[CLI: `telnyx messaging-profiles`]({cli})",
    "portal.telnyx.com/verify/profiles": "[CLI: `telnyx verify-profiles`]({cli})",
    "portal.telnyx.com/ai/assistants": "[CLI: `telnyx ai-assistants`]({cli})",
    "portal.telnyx.com/#/ai/assistants": "[CLI: `telnyx ai-assistants`]({cli})",
    "portal.telnyx.com/storage": "[CLI: `telnyx storage`]({cli})",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def extract_env_var_names(readme: str) -> list[str]:
    """Extract env var names from the Environment Variables table."""
    env_vars = []
    # Match table rows with `VAR_NAME` pattern
    for match in re.finditer(r"\|\s*`(\w+)`\s*\|", readme):
        var_name = match.group(1)
        # Skip header-like values
        if var_name.lower() not in ("variable", "type", "example", "required", "description"):
            env_vars.append(var_name)
    return env_vars


def build_cli_commands(env_vars: list[str]) -> list[str]:
    """Map env vars to relevant CLI commands, deduped and ordered."""
    seen = set()
    commands = []
    for var in env_vars:
        for cmd in ENV_VAR_CLI_COMMANDS.get(var, []):
            if cmd not in seen:
                seen.add(cmd)
                commands.append(cmd)
    return commands


def build_cli_blockquote(env_vars: list[str]) -> str:
    """Build the 'Agent / CLI access' blockquote for given env vars."""
    cli_commands = build_cli_commands(env_vars)

    lines = [
        "> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):",
        ">",
        "> ```bash",
        "> telnyx auth login",
    ]
    for cmd in cli_commands:
        lines.append(f"> {cmd}")
    lines.extend([
        "> ```",
        ">",
        "> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)",
    ])
    return "\n".join(lines)


def build_cli_setup_details() -> str:
    """Build the <details> programmatic/CLI setup block."""
    return """<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>"""


def build_agent_discovery() -> str:
    """Build the fixed Agent Discovery section."""
    return """## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`"""


def rewrite_env_var_portal_links(readme: str) -> str:
    """Append CLI alternatives alongside Portal links in env var table rows.

    Idempotent — skips rows that already contain a CLI link.
    """
    def replace_portal_link(match: re.Match) -> str:
        full = match.group(0)
        # Already has a CLI link appended — skip
        if "CLI" in full.split("|")[-2] if full.count("|") > 1 else "":
            return full

        for portal_path, cli_template in PORTAL_TO_CLI.items():
            if portal_path in full:
                cli_link = cli_template.format(cli=CLI_DOCS_URL)
                portal_link_match = re.search(
                    r"\[Portal\]\(https://portal\.telnyx\.com/[^)]*\)", full
                )
                if portal_link_match and cli_link not in full:
                    old_link = portal_link_match.group(0)
                    new_link = f"{old_link} · {cli_link}"
                    return full.replace(old_link, new_link)
        return full

    # Only rewrite lines inside the env var table (lines starting with |)
    lines = readme.split("\n")
    in_env_section = False
    result = []

    for line in lines:
        if re.match(r"^## Environment Variables\b", line):
            in_env_section = True
        elif re.match(r"^## ", line) and in_env_section:
            in_env_section = False

        if in_env_section and line.startswith("|") and "Portal" in line and "CLI" not in line:
            for portal_path, cli_template in PORTAL_TO_CLI.items():
                if portal_path in line:
                    cli_link = cli_template.format(cli=CLI_DOCS_URL)
                    portal_match = re.search(
                        r"\[Portal\]\(https://portal\.telnyx\.com/[^)]*\)", line
                    )
                    if portal_match:
                        old_link = portal_match.group(0)
                        line = line.replace(old_link, f"{old_link} · {cli_link}")
                    break  # One rewrite per row

        result.append(line)

    return "\n".join(result)


# ---------------------------------------------------------------------------
# Insertion logic
# ---------------------------------------------------------------------------

def insert_cli_blockquote(readme: str) -> str:
    """Insert Agent/CLI blockquote after the Environment Variables table."""
    if SENTINEL_CLI_BLOCKQUOTE in readme:
        return readme

    # Find the end of the env var table: look for ## Environment Variables,
    # then the last table row (line starting with |), then insert after it.
    env_section = re.search(r"^## Environment Variables\b", readme, re.MULTILINE)
    if not env_section:
        return readme

    # Find the last table row after the section header
    pos = env_section.end()
    remaining = readme[pos:]

    # Find all table rows (lines starting with |)
    last_table_end = None
    for match in re.finditer(r"^\|.+\|$", remaining, re.MULTILINE):
        last_table_end = pos + match.end()

    if last_table_end is None:
        return readme

    env_vars = extract_env_var_names(readme)
    blockquote = build_cli_blockquote(env_vars)

    return readme[:last_table_end] + "\n\n" + blockquote + "\n" + readme[last_table_end:]


def insert_cli_setup_details(readme: str) -> str:
    """Insert <details> CLI setup block after the Setup bash block."""
    if SENTINEL_CLI_SETUP in readme:
        return readme

    setup_section = re.search(r"^## Setup\b", readme, re.MULTILINE)
    if not setup_section:
        return readme

    pos = setup_section.end()
    remaining = readme[pos:]

    # Find the first ``` code block end after ## Setup
    # Pattern: look for the closing ``` of the first code block
    code_block = re.search(r"```\w*\n.*?```", remaining, re.DOTALL)
    if not code_block:
        return readme

    insert_pos = pos + code_block.end()

    details = build_cli_setup_details()

    return readme[:insert_pos] + "\n\n" + details + "\n" + readme[insert_pos:]


def insert_agent_discovery(readme: str) -> str:
    """Insert or replace ## Agent Discovery section before ## Resources (or at end)."""
    discovery = build_agent_discovery()

    # If section already exists, replace it in-place
    if SENTINEL_AGENT_DISCOVERY in readme:
        # Match from "## Agent Discovery" to the next H2 or end of file
        pattern = r"^## Agent Discovery\b.*?(?=^## |\Z)"
        replaced = re.sub(pattern, discovery + "\n\n", readme, count=1, flags=re.MULTILINE | re.DOTALL)
        return replaced

    # Try to insert before ## Resources
    resources_match = re.search(r"^## Resources\b", readme, re.MULTILINE)
    if resources_match:
        insert_pos = resources_match.start()
        return readme[:insert_pos] + discovery + "\n\n" + readme[insert_pos:]

    # Fallback: append at end
    return readme.rstrip() + "\n\n" + discovery + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def agentify_readme(readme_path: Path, dry_run: bool = False) -> tuple[bool, list[str]]:
    """Apply all agent-friendly changes to a single README.

    Returns (changed, list_of_changes).
    """
    original = readme_path.read_text()
    changes = []

    result = original

    new = insert_cli_blockquote(result)
    if new != result:
        changes.append("Added Agent / CLI access blockquote")
        result = new

    new = insert_cli_setup_details(result)
    if new != result:
        changes.append("Added Programmatic / CLI setup details")
        result = new

    new = insert_agent_discovery(result)
    if new != result:
        changes.append("Added/updated Agent Discovery section")
        result = new

    new = rewrite_env_var_portal_links(result)
    if new != result:
        changes.append("Added CLI alternatives to Portal links in env var table")
        result = new

    if result != original and not dry_run:
        readme_path.write_text(result)

    return result != original, changes


def load_mapping() -> list[dict]:
    """Load examples_mapping.yaml."""
    mapping_path = SCRIPTS_DIR / "examples_mapping.yaml"
    with open(mapping_path) as f:
        data = yaml.safe_load(f)
    return data.get("examples", [])


def main():
    parser = argparse.ArgumentParser(
        description="Retrofit example READMEs with agent-friendly content.",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Process only the specified folder name",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing files",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()

    mapping = load_mapping()

    if args.only:
        mapping = [e for e in mapping if e["folder"] == args.only]
        if not mapping:
            print(f"No mapping entry found for: {args.only}")
            sys.exit(1)

    total = 0
    changed = 0
    skipped = 0

    for entry in mapping:
        folder_name = entry["folder"]
        readme_path = REPO_ROOT / folder_name / "README.md"

        if not readme_path.exists():
            if args.verbose:
                print(f"  SKIP     {folder_name}/ (no README.md)")
            skipped += 1
            continue

        total += 1
        was_changed, changes = agentify_readme(readme_path, dry_run=args.dry_run)

        if was_changed:
            changed += 1
            prefix = "WOULD" if args.dry_run else "UPDATED"
            print(f"  {prefix}  {folder_name}/")
            if args.verbose:
                for c in changes:
                    print(f"           - {c}")
        elif args.verbose:
            print(f"  OK       {folder_name}/ (already up to date)")

    print()
    print(f"Total: {total}  Changed: {changed}  Skipped: {skipped}")
    if args.dry_run:
        print("(dry run — no files were modified)")


if __name__ == "__main__":
    main()
