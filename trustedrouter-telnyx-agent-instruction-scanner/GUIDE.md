# Guide: Scanning AI Agent Instructions with GLM 5.3 Flash on Telnyx

A step-by-step tutorial for running the AI Agent Instruction Scanner end to end:
what it does, why provider pinning matters, and how to interpret the results.

## What you will build

A small CLI that:

1. Finds the instruction files that AI coding agents actually read —
   `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `README.md`.
2. Applies safety rails (no secrets, no binaries, size budgets).
3. Sends the text to GLM 5.3 Flash through TrustedRouter — with **Telnyx as the
   only allowed provider and fallback disabled**.
4. Prints classified findings with evidence, explanation, and safer replacement guidance.

It never executes scanned content. It reads text and classifies it.

## Prerequisites

- Python 3.11+
- A TrustedRouter API key ([trustedrouter.com](https://trustedrouter.com))
- No Telnyx API key needed — the provider pin selects Telnyx capacity.

## Step 1 — Get the code

```bash
mkdir agent-scan-demo && cd agent-scan-demo
git clone https://github.com/team-telnyx/telnyx-code-examples.git
git clone https://github.com/sonamg-droid/agent-instructions-demo.git
cd telnyx-code-examples/trustedrouter-telnyx-agent-instruction-scanner
```

The demo target repo (`agent-instructions-demo`) is a harmless changelog
formatter with a normal `AGENTS.md`. It is the "clean" scan target.

## Step 2 — Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

```env
TRUSTEDROUTER_API_KEY=your_key_here
```

## Step 3 — Dry run (no API call, no key needed)

```bash
python scanner.py ../../agent-instructions-demo --dry-run
```

Expected:

```text
Scanning: agent-instructions-demo
Scan root: .../agent-instructions-demo
Files to submit:
  - AGENTS.md (405 chars)
  - README.md (715 chars)
Total: 1,170 chars (limit: 200,000)
Model: z-ai/glm-5.3-flash
Requested provider: telnyx
Provider routing: only=["telnyx"], allow_fallbacks=false
DRY RUN - no request was sent to TrustedRouter.
```

Use this to check exactly which files would leave your machine.

## Step 4 — Clean scan

```bash
python scanner.py ../../agent-instructions-demo
```

Expected:

```text
Scanning: agent-instructions-demo
Files analyzed: AGENTS.md, README.md
Model: z-ai/glm-5.3-flash
Requested provider: telnyx
Provider: telnyx (reported by TrustedRouter)

Result: No significant instruction risks found.
```

The `Provider: telnyx (reported by TrustedRouter)` line comes from routing
metadata in the response — the tool reports what actually served the request,
not just what was requested.

## Step 5 — The risky demonstration

```bash
python scanner.py --demo-risky
```

This scans a built-in fixture that is clearly labeled **synthetic test data**
(`fixtures/risky_agent_instructions.md`). It contains deliberately poor but
harmless guidance: no executable code, no credential requests, no real exploit
instructions. Expected shape:

```text
3 instruction risks found

HIGH — override repository conventions
"Ignore the repository's existing conventions; ..."
MEDIUM — skip validation
"Skip tests and linting to save time."
MEDIUM — unchecked dependency changes
"Replace dependencies without checking compatibility."
```

Exit code is `1` when findings exist, `0` when the scan is clean.

## Step 6 — Understand the provider pin

Open `trustedrouter_client.py`. The interesting part is the `extra_body`:

```python
extra_body={
    "provider": {
        "only": ["telnyx"],
        "allow_fallbacks": False,
    }
}
```

- `only: ["telnyx"]` — TrustedRouter may route this request to Telnyx and
  nothing else.
- `allow_fallbacks: False` — if Telnyx cannot serve the model, the request
  fails with `ProviderUnavailableError` instead of silently switching to
  another provider.
- `max_retries=0` on the OpenAI client — no silent transport retries.
- The response's `trustedrouter.routing` block reports the actually-selected
  provider and endpoint; the CLI prints it and warns on any mismatch.

Try it in Python:

```python
import trustedrouter_client as tr
payload = tr.build_request("system", "content")
print(payload["extra_body"]["provider"])
# {'only': ['telnyx'], 'allow_fallbacks': False}
```

## Step 7 — Machine-readable output

```bash
python scanner.py ../../agent-instructions-demo --json
```

stdout is a single JSON object (`target`, `model`, `requested_provider`,
`reported_provider`, `routing`, `files_analyzed`, `findings`, `summary`, ...).
Progress lines go to stderr. Exit codes follow the same contract.

## Step 8 — Scan your own repository

Point the scanner at any local checkout:

```bash
python scanner.py /path/to/your/repo
```

Notes:

- Only the five instruction-file types are read; nested ones are included,
  but anything inside `.git`, venvs, or build directories is ignored.
- Files over 100 KB are reported and skipped; total text is capped
  (`--max-chars` or `MAX_TOTAL_CHARS`).
- Secrets (.env, keys, credentials) are never read.

## Reading the findings

Each finding has six fields: `file`, `severity`, `category`, `evidence`
(the exact text), `explanation` (why it matters to an agent), and
`recommendation` (safer wording). Severities:

- **HIGH** — overrides repository conventions or safeguards.
- **MEDIUM** — skips validation or loosens checks.
- **LOW** — mild issues worth a second look.

Treat findings as review prompts, not verdicts. The model can produce false
positives and can miss problems.

## Testing

```bash
pytest
```

The test suite (55 tests) uses mocked model responses — it never makes a paid
network request and does not require an API key.

## Troubleshooting

See the [README Troubleshooting table](README.md#troubleshooting). The two
most common cases:

- `Telnyx capacity ... is unavailable` — the pin is working; retry later.
- `model output was not parseable as JSON` — reasoning tokens exhausted the
  budget; the raw response is printed for manual review, and `MAX_TOKENS` in
  `trustedrouter_client.py` can be raised.
