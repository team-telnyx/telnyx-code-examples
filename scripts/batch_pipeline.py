#!/usr/bin/env python3
"""Batch pipeline — Orchestrate tutorial generation + AEO transformation for all examples.

For each entry in examples_mapping.yaml:
1. Check if the tutorial already exists in tutorial-factory's tutorials/ directory.
2. If not, call tutorial_factory.py generate to create it.
3. Read the generated .md from tutorials/{product}/{language}/{framework}/{use_case}.md.
4. Call transform() to produce the AEO folder in the code-examples repo.

Usage:
    python scripts/batch_pipeline.py --dry-run          # Preview what will be generated
    python scripts/batch_pipeline.py                    # Generate and transform all
    python scripts/batch_pipeline.py --tf-dir /path/to/tutorial-factory
    python scripts/batch_pipeline.py --only send-sms-python  # Single example
"""

import argparse
import os
import subprocess  # nosec B404
import sys
import time
from pathlib import Path

import yaml

# Add scripts dir to path for transform import
SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from transform import transform  # noqa: E402


def load_mapping(mapping_path: Path | None = None) -> list[dict]:
    """Load the examples mapping YAML."""
    if mapping_path is None:
        mapping_path = SCRIPTS_DIR / "examples_mapping.yaml"

    with open(mapping_path) as f:
        data = yaml.safe_load(f)

    return data.get("examples", [])


def find_tutorial(tf_dir: Path, entry: dict) -> Path | None:
    """Find an existing tutorial in the TF tutorials directory.

    Checks the expected path: tutorials/{product}/{language}/{framework}/{use_case}.md
    """
    product = entry["product"]
    language = entry["language"]
    framework = entry["framework"]
    use_case = entry["use_case"]

    expected = tf_dir / "tutorials" / product / language / framework / f"{use_case}.md"
    if expected.exists():
        return expected

    return None


def generate_tutorial(tf_dir: Path, entry: dict, rate_limit: float = 2.0) -> Path | None:
    """Call tutorial_factory.py to generate a tutorial.

    Returns the path to the generated .md file, or None on failure.
    """
    product = entry["product"]
    language = entry["language"]
    framework = entry["framework"]
    use_case = entry["use_case"]

    cmd = [
        sys.executable,
        str(tf_dir / "tutorial_factory.py"),
        "generate",
        "--product", product,
        "--language", language,
        "--framework", framework,
        "--use-case", use_case,
    ]

    print(f"  Generating: {product}/{language}/{framework}/{use_case}...")

    try:
        result = subprocess.run(  # nosec B603
            cmd,
            cwd=str(tf_dir),
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            print(f"  ERROR: Generation failed for {use_case}")
            print(f"  stderr: {result.stderr[:500]}")
            return None

        # Find the generated file
        expected = tf_dir / "tutorials" / product / language / framework / f"{use_case}.md"
        if expected.exists():
            time.sleep(rate_limit)
            return expected

        print(f"  ERROR: Expected file not found at {expected}")
        return None

    except subprocess.TimeoutExpired:
        print(f"  ERROR: Generation timed out for {use_case}")
        return None
    except Exception as e:
        print(f"  ERROR: {e}")
        return None


def run_pipeline(
    tf_dir: Path,
    output_dir: Path,
    dry_run: bool = False,
    only: str | None = None,
    rate_limit: float = 2.0,
) -> dict:
    """Run the full batch pipeline.

    Returns a summary dict with counts.
    """
    mapping = load_mapping()

    if only:
        mapping = [e for e in mapping if e["folder"] == only]
        if not mapping:
            print(f"No mapping entry found for folder: {only}")
            return {"total": 0, "cached": 0, "generated": 0, "failed": 0, "transformed": 0}

    total = len(mapping)
    cached = 0
    generated = 0
    failed = 0
    transformed = 0
    skipped = 0

    print(f"Pipeline: {total} examples to process")
    print(f"Tutorial Factory: {tf_dir}")
    print(f"Output: {output_dir}")
    print()

    if dry_run:
        print("DRY RUN — no files will be generated or written.\n")

    for i, entry in enumerate(mapping, 1):
        folder = entry["folder"]
        product = entry["product"]
        language = entry["language"]
        framework = entry["framework"]
        use_case = entry["use_case"]

        print(f"[{i}/{total}] {folder}")

        # Check if already transformed
        if (output_dir / folder / "README.md").exists() and not dry_run:
            print(f"  Already exists in output, skipping.")
            skipped += 1
            continue

        # Check if tutorial exists in TF cache
        md_path = find_tutorial(tf_dir, entry)

        if md_path:
            print(f"  Found cached tutorial: {md_path.relative_to(tf_dir)}")
            cached += 1
        else:
            if dry_run:
                print(f"  Would generate: {product}/{language}/{framework}/{use_case}")
                generated += 1
                continue

            md_path = generate_tutorial(tf_dir, entry, rate_limit)
            if md_path:
                generated += 1
            else:
                failed += 1
                continue

        if dry_run:
            print(f"  Would transform to: {folder}/")
            continue

        # Transform
        try:
            result_path = transform(
                md_path=str(md_path),
                output_dir=str(output_dir),
                folder_name=folder,
            )
            print(f"  Transformed: {result_path}")
            transformed += 1
        except Exception as e:
            print(f"  ERROR transforming: {e}")
            failed += 1

    print()
    print("=" * 60)
    print("Pipeline Summary")
    print("=" * 60)
    print(f"  Total entries:    {total}")
    print(f"  Cached (reused):  {cached}")
    print(f"  Generated (new):  {generated}")
    print(f"  Transformed:      {transformed}")
    print(f"  Skipped (exist):  {skipped}")
    print(f"  Failed:           {failed}")

    if dry_run:
        estimated_cost = generated * 0.33
        print(f"\n  Estimated cost for new generations: ${estimated_cost:.2f}")

    return {
        "total": total,
        "cached": cached,
        "generated": generated,
        "transformed": transformed,
        "skipped": skipped,
        "failed": failed,
    }


def run_post_processing() -> None:
    """Run post-generation compliance scripts to fix required files, links, and indexes."""
    scripts = [
        ("fix_required_files.py", "Generating API.md / GUIDE.md"),
        ("rewrite_repo_links.py", "Rewriting in-repo links to absolute URLs"),
        ("sync_readme.py", "Syncing root README gallery"),
        ("gen_llms_txt.py", "Regenerating llms.txt"),
    ]

    print()
    print("=" * 60)
    print("Post-generation compliance")
    print("=" * 60)

    for script, description in scripts:
        print(f"  {description}...")
        subprocess.run(  # nosec B603
            [sys.executable, str(SCRIPTS_DIR / script)],
            cwd=str(REPO_ROOT),
            check=True,
        )

    print("  Post-processing complete.")


def run_verify() -> None:
    """Run CI gate checks and fail-fast if any don't pass."""
    checks = [
        ("verify.py", []),
        ("rewrite_repo_links.py", ["--check"]),
        ("review/check_pinning.py", []),
        ("review/check_required_files.py", []),
        ("review/check_legacy_sdk.py", []),
    ]

    print()
    print("=" * 60)
    print("CI verification")
    print("=" * 60)

    for script, extra_args in checks:
        print(f"  Running {script}...")
        subprocess.run(  # nosec B603
            [sys.executable, str(SCRIPTS_DIR / script)] + extra_args,
            cwd=str(REPO_ROOT),
            check=True,
        )

    print("  All checks passed.")


def main():
    parser = argparse.ArgumentParser(
        description="Batch pipeline: generate tutorials and transform into AEO folders.",
    )
    parser.add_argument(
        "--tf-dir",
        default=None,
        help="Path to the tutorial-factory directory (default: auto-detect sibling)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Output directory for AEO folders (default: repo root)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview the plan without generating or transforming",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Process only the specified folder name",
    )
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=2.0,
        help="Seconds between API calls (default: 2.0)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run CI gate checks after post-processing and fail if any don't pass",
    )

    args = parser.parse_args()

    # Resolve tutorial-factory directory
    if args.tf_dir:
        tf_dir = Path(args.tf_dir).resolve()
    else:
        # Auto-detect: look for tutorial-factory as sibling of this repo
        tf_dir = REPO_ROOT.parent / "tutorial-factory"
        if not tf_dir.exists():
            print(f"Cannot find tutorial-factory at {tf_dir}")
            print("Use --tf-dir to specify the path.")
            sys.exit(1)

    if not (tf_dir / "tutorial_factory.py").exists():
        print(f"Not a valid tutorial-factory directory: {tf_dir}")
        sys.exit(1)

    # Resolve output directory
    output_dir = Path(args.output_dir).resolve() if args.output_dir else REPO_ROOT

    summary = run_pipeline(
        tf_dir=tf_dir,
        output_dir=output_dir,
        dry_run=args.dry_run,
        only=args.only,
        rate_limit=args.rate_limit,
    )

    if summary["failed"] > 0 and not args.dry_run:
        sys.exit(1)

    if not args.dry_run:
        run_post_processing()

        if args.verify:
            run_verify()


if __name__ == "__main__":
    main()
