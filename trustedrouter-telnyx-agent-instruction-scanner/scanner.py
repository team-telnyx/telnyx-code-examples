#!/usr/bin/env python3
"""AI Agent Instruction Scanner.

Scans repository instruction files (AGENTS.md, CLAUDE.md, .cursorrules,
.github/copilot-instructions.md, README.md) for guidance that could cause an
AI coding agent to behave poorly. The audit runs on GLM 5.3 Flash through
TrustedRouter with Telnyx-only routing and no provider fallback.

This tool never executes scanned content. It reads files as text and sends
only the selected text to inference.

Usage:
    python scanner.py PATH            # scan a repository directory
    python scanner.py --demo-risky    # scan the built-in synthetic fixture
    python scanner.py PATH --dry-run  # list what would be sent; no request
    python scanner.py PATH --json     # machine-readable output

Exit codes: 0 = clean or nothing to scan, 1 = findings reported,
2 = operational error (bad path, missing key, API failure).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

import trustedrouter_client as tr
from prompts import build_user_prompt, parse_model_output

HERE = Path(__file__).resolve().parent

ELIGIBLE_FILENAMES = frozenset({"AGENTS.md", "CLAUDE.md", ".cursorrules", "README.md"})
COPILOT_SUFFIX = ".github/copilot-instructions.md"
MAX_FILE_BYTES = 100 * 1024
DEFAULT_MAX_TOTAL_CHARS = 200_000
MAX_TOTAL_CHARS_ENV_VAR = "MAX_TOTAL_CHARS"
BINARY_SNIFF_BYTES = 8192
MIN_SECTION_CHARS = 200
BUDGET_RESERVE_CHARS = 300
TRUNCATION_NOTE = "[TRUNCATED: file exceeded the submission budget]"
SKIPPED_NOTE = "[NOT SUBMITTED - submission budget reached: {files}]"

IGNORED_DIRS = frozenset(
    {
        ".git", ".hg", ".svn",
        ".venv", "venv", "env", "virtualenv",
        "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache",
        ".ruff_cache", ".tox", ".nox", ".eggs", "site-packages",
        "build", "dist", "target", "vendor", "third_party",
    }
)
NEVER_READ_NAMES = frozenset(
    {".env", "credentials", "secrets", "netrc", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"}
)
NEVER_READ_SUFFIXES = frozenset(
    {".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".pfx"}
)


@dataclass(frozen=True)
class ScannedFile:
    """One file considered by the scanner, eligible or not."""

    display: str
    path: Path
    chars: int = 0
    reason: str | None = None

    @property
    def is_eligible(self) -> bool:
        return self.reason is None


@dataclass
class Submission:
    """The exact text assembled for inference, plus accounting details."""

    files: list[ScannedFile]
    skipped: list[ScannedFile] = field(default_factory=list)
    repo_content: str = ""
    budget: int = DEFAULT_MAX_TOTAL_CHARS
    dropped: list[str] = field(default_factory=list)
    truncated: list[str] = field(default_factory=list)

    @property
    def total_chars(self) -> int:
        return len(self.repo_content)

    @property
    def display_names(self) -> list[str]:
        return [f.display for f in self.files]


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    if args.demo_risky and args.path:
        parser.error("Provide either PATH or --demo-risky, not both.")
    if not args.demo_risky and not args.path:
        parser.error("Provide a repository PATH or use --demo-risky.")

    if args.demo_risky:
        target = demo_fixture_path()
        display = "built-in risky fixture (synthetic test data)"
    else:
        target = Path(args.path).expanduser().resolve()
        if not target.exists():
            print(f"Error: scan target does not exist: {target}", file=sys.stderr)
            return 2
        if not target.is_dir():
            print(
                f"Error: scan target must be a directory, not a file: {target}",
                file=sys.stderr,
            )
            return 2
        display = target.name

    load_dotenv(HERE / ".env")
    budget = _resolve_budget(args.max_chars)
    scanned = (
        load_demo_submission(budget)
        if args.demo_risky
        else build_submission(discover_files(target), budget)
    )

    if args.dry_run:
        if args.as_json:
            return _print_json_dry_run(display, scanned)
        _print_dry_run(display, scanned, target)
        return 0

    if not scanned.files:
        print(f"Scanning: {display}")
        print("No eligible instruction files found.")
        return 0

    header_stream = sys.stderr if args.as_json else sys.stdout
    print(f"Scanning: {display}", file=header_stream)
    print(f"Files analyzed: {', '.join(scanned.display_names)}", file=header_stream)
    print(f"Model: {tr.MODEL}", file=header_stream)
    print("Requested provider: telnyx", file=header_stream)
    print(
        f"Submitting {scanned.total_chars:,} characters (limit: {scanned.budget:,}).",
        file=header_stream,
    )

    try:
        api_key = tr.resolve_api_key()
        client = tr.build_client(api_key)
        result = tr.request_completion(
            client,
            system_prompt=_system_prompt(),
            user_content=build_user_prompt(scanned.repo_content),
            api_key=api_key,
        )
    except tr.TrustedRouterError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if args.as_json:
        return _print_json(display, scanned, result)
    return _print_report(result)


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="scanner",
        description=(
            "Scan repository instruction files for guidance that could cause an "
            "AI coding agent to behave poorly. Runs on GLM 5.3 Flash via "
            "TrustedRouter with Telnyx-only routing and no fallback."
        ),
    )
    parser.add_argument("path", nargs="?", help="Repository directory to scan.")
    parser.add_argument(
        "--demo-risky",
        action="store_true",
        help="Scan the built-in synthetic fixture instead of a repository path.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List the files that would be submitted; do not call TrustedRouter.",
    )
    parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Print a single machine-readable JSON object.",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=None,
        help=f"Total character budget (default: {DEFAULT_MAX_TOTAL_CHARS:,}, "
        f"or ${MAX_TOTAL_CHARS_ENV_VAR}).",
    )
    return parser


def discover_files(root: Path) -> list[ScannedFile]:
    """Find eligible instruction files, never reading credential or binary files."""
    results: list[ScannedFile] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS)
        for name in sorted(filenames):
            path = Path(dirpath) / name
            rel = path.relative_to(root).as_posix()
            if not _is_eligible_path(rel):
                continue
            if _is_never_read(name):
                results.append(
                    ScannedFile(rel, path, reason="credential file - never read")
                )
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if size > MAX_FILE_BYTES:
                results.append(
                    ScannedFile(
                        rel,
                        path,
                        reason=f"exceeds 100 KB limit ({size:,} bytes)",
                    )
                )
                continue
            if _looks_binary(path):
                results.append(ScannedFile(rel, path, reason="binary file - skipped"))
                continue
            text = _read_text(path)
            if text is None:
                results.append(
                    ScannedFile(rel, path, reason="not valid UTF-8 text - skipped")
                )
                continue
            results.append(ScannedFile(rel, path, chars=len(text)))
    results.sort(key=lambda item: item.display)
    return results


def build_submission(files: list[ScannedFile], budget: int) -> Submission:
    """Assemble file contents into one text block within the character budget."""
    eligible = [f for f in files if f.is_eligible]
    skipped = [f for f in files if not f.is_eligible]
    submitted: list[ScannedFile] = []
    sections: list[str] = []
    total = 0
    dropped: list[str] = []
    truncated: list[str] = []
    usable_budget = budget - BUDGET_RESERVE_CHARS

    for item in eligible:
        text = _read_text(item.path) or ""
        remaining = usable_budget - total
        if remaining <= MIN_SECTION_CHARS:
            dropped.append(item.display)
            continue
        section_text = text
        overhead = len(_file_section(item.display, "")) + len(TRUNCATION_NOTE)
        if len(text) + overhead > remaining:
            cut = remaining - overhead
            if cut <= MIN_SECTION_CHARS:
                dropped.append(item.display)
                continue
            section_text = text[:cut].rstrip() + "\n" + TRUNCATION_NOTE
            truncated.append(item.display)
        section = _file_section(item.display, section_text)
        sections.append(section)
        submitted.append(item)
        total += len(section) + 2

    if dropped:
        note = SKIPPED_NOTE.format(files=", ".join(dropped))
        sections.append(note)
    repo_content = "\n\n".join(sections) if sections else ""
    return Submission(
        files=submitted,
        skipped=skipped,
        repo_content=repo_content,
        budget=budget,
        dropped=dropped,
        truncated=truncated,
    )


def load_demo_submission(budget: int) -> Submission:
    """Load the built-in synthetic fixture as a single-file submission."""
    fixture = demo_fixture_path()
    text = fixture.read_text(encoding="utf-8")
    item = ScannedFile("fixtures/risky_agent_instructions.md", fixture, chars=len(text))
    return build_submission([item], budget)


def demo_fixture_path() -> Path:
    return HERE / "fixtures" / "risky_agent_instructions.md"


def _resolve_budget(max_chars: int | None) -> int:
    if max_chars is not None:
        return max_chars
    try:
        return int(os.environ.get(MAX_TOTAL_CHARS_ENV_VAR, DEFAULT_MAX_TOTAL_CHARS))
    except (TypeError, ValueError):
        return DEFAULT_MAX_TOTAL_CHARS


def _is_eligible_path(rel_posix: str) -> bool:
    name = rel_posix.rsplit("/", 1)[-1]
    if name in ELIGIBLE_FILENAMES:
        return True
    return rel_posix == COPILOT_SUFFIX or rel_posix.endswith("/" + COPILOT_SUFFIX)


def _is_never_read(name: str) -> bool:
    lowered = name.lower()
    if lowered in NEVER_READ_NAMES:
        return True
    if lowered.endswith(tuple(NEVER_READ_SUFFIXES)):
        return True
    if lowered.startswith(".env") or lowered.startswith("id_"):
        return True
    return "secret" in lowered or "credential" in lowered


def _looks_binary(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            chunk = fh.read(BINARY_SNIFF_BYTES)
    except OSError:
        return True
    return b"\x00" in chunk


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


def _file_section(display: str, text: str) -> str:
    return f"=== FILE: {display} ===\n{text}"


def _system_prompt() -> str:
    from prompts import SYSTEM_PROMPT

    return SYSTEM_PROMPT


def _print_dry_run(display: str, submission: Submission, target: Path) -> None:
    print(f"Scanning: {display}")
    print(f"Scan root: {target}")
    if submission.files:
        print("Files to submit:")
        for item in submission.files:
            print(f"  - {item.display} ({item.chars:,} chars)")
        print(f"Total: {submission.total_chars:,} chars (limit: {submission.budget:,})")
    else:
        print("Files to submit: (none)")
    for item in submission.skipped:
        print(f"  Skipping {item.display}: {item.reason}")
    if submission.truncated:
        print(f"Truncated to fit budget: {', '.join(submission.truncated)}")
    if submission.dropped:
        print(f"Dropped (budget): {', '.join(submission.dropped)}")
    print(f"Model: {tr.MODEL}")
    print("Requested provider: telnyx")
    print('Provider routing: only=["telnyx"], allow_fallbacks=false')
    print("DRY RUN - no request was sent to TrustedRouter.")


def _print_json_dry_run(display: str, submission: Submission) -> int:
    payload = {
        "target": display,
        "model": tr.MODEL,
        "requested_provider": "telnyx",
        "reported_provider": None,
        "routing": None,
        "files_analyzed": submission.display_names,
        "files_skipped": [
            {"file": f.display, "reason": f.reason} for f in submission.skipped
        ],
        "characters_submitted": submission.total_chars,
        "characters_budget": submission.budget,
        "truncated_files": submission.truncated,
        "dropped_files": submission.dropped,
        "parse_ok": None,
        "findings": [],
        "summary": "dry run - no request was sent to TrustedRouter",
        "dry_run": True,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _print_report(result: Any) -> int:
    routing = result.routing or {}
    reported = routing.get("selected_provider")
    if reported:
        print(f"Provider: {reported} (reported by TrustedRouter)")
        if reported.lower() != "telnyx":
            print(
                f"WARNING: the request was pinned to telnyx, but TrustedRouter "
                f"reports provider {reported!r}. Fallback may have occurred; "
                "treat these results accordingly."
            )
    else:
        print(
            "Provider: telnyx requested - TrustedRouter did not report routing "
            "metadata, so the actual provider is unknown."
        )
    fallback_count = routing.get("fallback_attempt_count")
    if isinstance(fallback_count, int) and fallback_count > 0:
        print(f"WARNING: {fallback_count} fallback attempt(s) were recorded.")

    parsed = parse_model_output(result.text)
    if not parsed.parse_ok:
        # Never report a degraded run as a clean result.
        print()
        print("Error: model output was not parseable as JSON; showing the raw response.")
        if parsed.raw_response.strip():
            print()
            print(parsed.raw_response)
        else:
            print()
            print(
                "The model returned no text. Reasoning models can exhaust the "
                "completion budget before answering; retry, or raise the token "
                "budget in trustedrouter_client.MAX_TOKENS."
            )
        return 2

    if parsed.is_clean:
        print()
        print("Result: No significant instruction risks found.")
        if parsed.summary:
            print(f"Summary: {parsed.summary}")
        return 0

    print()
    print(f"{len(parsed.findings)} instruction risks found")
    print()
    for finding in parsed.sorted_findings():
        evidence = f'"{finding.evidence}"' if finding.evidence else "(no evidence text)"
        print(f"{finding.severity.upper()} — {finding.category}")
        print(evidence)
        print(f"  File: {finding.file}")
        if finding.explanation:
            print(f"  Why: {finding.explanation}")
        if finding.recommendation:
            print(f"  Safer: {finding.recommendation}")
        print()
    if parsed.summary:
        print(f"Summary: {parsed.summary}")
    return 1


def _print_json(display: str, submission: Submission, result: Any) -> int:
    parsed = parse_model_output(result.text)
    routing = result.routing or {}
    payload = {
        "target": display,
        "model": result.model or tr.MODEL,
        "requested_provider": "telnyx",
        "reported_provider": routing.get("selected_provider"),
        "routing": routing or None,
        "files_analyzed": submission.display_names,
        "files_skipped": [
            {"file": f.display, "reason": f.reason} for f in submission.skipped
        ],
        "characters_submitted": submission.total_chars,
        "characters_budget": submission.budget,
        "truncated_files": submission.truncated,
        "dropped_files": submission.dropped,
        "parse_ok": parsed.parse_ok,
        "findings": [f.to_dict() for f in parsed.sorted_findings()],
        "summary": parsed.summary,
        "dry_run": False,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 1 if parsed.findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
