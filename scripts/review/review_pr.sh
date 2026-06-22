#!/usr/bin/env bash
# review_pr.sh — run every PR-review gate locally before pushing.
#
#   scripts/review/review_pr.sh [BASE_REF]      # BASE_REF defaults to origin/main
#
# verify.py runs over the full repo (the authoritative validator); the review
# gates run DIFF-AWARE — they only check example folders changed vs BASE_REF, so
# they catch what your branch introduces without failing on main's existing backlog.
set -uo pipefail
BASE="${1:-origin/main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail=0
run() { local title="$1"; shift; echo; echo "=== ${title} ==="; "$@" || fail=1; }

run "verify.py (full repo)"             python3 scripts/verify.py
run "raw in-repo links (full repo)"     python3 scripts/rewrite_repo_links.py --check
run "llms.txt in sync (full repo)"      python3 scripts/gen_llms_txt.py --check
run "pinning (changed vs ${BASE})"      python3 scripts/review/check_pinning.py --changed-against "$BASE"
run "required files (changed vs ${BASE})" python3 scripts/review/check_required_files.py --changed-against "$BASE"
run "legacy SDK (changed vs ${BASE})"   python3 scripts/review/check_legacy_sdk.py --changed-against "$BASE"

echo
[ "$fail" -eq 0 ] && echo "✅ ALL GATES PASSED" || echo "❌ GATES FAILED"
exit "$fail"
