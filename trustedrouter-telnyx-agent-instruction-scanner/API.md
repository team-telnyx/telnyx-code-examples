# API Reference — AI Agent Instruction Scanner

This example is a CLI tool (no HTTP server). This document is the typed
reference for the CLI contract, the JSON output schema, and the internal
module API.

## CLI

### `python scanner.py PATH`

Scan a repository directory.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `PATH` | `path` (string) | yes (unless `--demo-risky`) | Repository directory to scan. Must exist and be a directory. |

Options:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--demo-risky` | `flag` | off | Scan the built-in synthetic fixture instead of `PATH`. Mutually exclusive with `PATH`. |
| `--dry-run` | `flag` | off | Discover and list files, show model/provider configuration, and exit without calling TrustedRouter. No API key required. |
| `--json` | `flag` | off | Print one machine-readable JSON object to stdout. Progress lines go to stderr. |
| `--max-chars N` | `int` | `MAX_TOTAL_CHARS` env, else `200000` | Total character budget for submitted text. |

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | Clean result, or no eligible instruction files, or dry run completed |
| `1` | Findings reported (human mode) / non-empty findings (JSON mode) |
| `2` | Operational error: bad path, missing API key, TrustedRouter error, or unparseable model output |

### `python app.py PATH`

Repository-convention entry point; identical to `python scanner.py PATH`.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `TRUSTEDROUTER_API_KEY` | yes (except `--dry-run`) | TrustedRouter API key. Never printed by the tool. |
| `MAX_TOTAL_CHARS` | no | Total character budget (default `200000`). |

`.env` is loaded from the directory containing `scanner.py`.

## JSON output schema

`--json` prints exactly this shape on stdout:

```json
{
  "target": "agent-instructions-demo",
  "model": "z-ai/glm-5.3-flash",
  "requested_provider": "telnyx",
  "reported_provider": "telnyx",
  "routing": {
    "selected_provider": "telnyx",
    "selected_model": "z-ai/glm-5.3-flash",
    "selected_endpoint": "z-ai/glm-5.3-flash@telnyx/prepaid",
    "fallback_attempt_count": 0,
    "upstream_attempt_count": 1,
    "source": "trustedrouter.routing"
  },
  "files_analyzed": ["AGENTS.md", "README.md"],
  "files_skipped": [{"file": "README.md", "reason": "exceeds 100 KB limit (204,800 bytes)"}],
  "characters_submitted": 1170,
  "characters_budget": 200000,
  "truncated_files": [],
  "dropped_files": [],
  "parse_ok": true,
  "findings": [
    {
      "file": "AGENTS.md",
      "severity": "low|medium|high",
      "category": "short category",
      "evidence": "exact relevant text",
      "explanation": "why this could affect an AI coding agent",
      "recommendation": "safer replacement guidance"
    }
  ],
  "summary": "one-sentence overall assessment",
  "dry_run": false
}
```

- `reported_provider` is `null` when TrustedRouter reports no routing metadata.
  The tool never claims the request used Telnyx based only on configuration.
- `routing.fallback_attempt_count > 0` is surfaced as a warning in human output.
- `parse_ok: false` means the model's text could not be parsed as JSON; exit code
  is `2` in human mode and the raw response is shown.

## Routing contract (`trustedrouter_client.py`)

Every completion request carries:

```python
extra_body={
    "provider": {
        "only": ["telnyx"],
        "allow_fallbacks": False,
    }
}
```

| Constant | Value | Notes |
|----------|-------|-------|
| `TRUSTEDROUTER_BASE_URL` | `https://api.trustedrouter.com/v1` | OpenAI-compatible endpoint |
| `MODEL` | `z-ai/glm-5.3-flash` | Never changed on failure — no model fallback |
| `PROVIDER_ONLY` | `["telnyx"]` | Telnyx is the only allowed provider |
| `MAX_TOKENS` | `4000` | Generous budget: reasoning tokens share it with the JSON answer |
| SDK `max_retries` | `0` | No silent transport retries |

Error types (all subclasses of `TrustedRouterError`):

| Error | Trigger |
|-------|---------|
| `MissingAPIKeyError` | `TRUSTEDROUTER_API_KEY` unset or empty |
| `AuthenticationError` | HTTP 401/403 |
| `RateLimitError` | HTTP 429 |
| `ProviderUnavailableError` | HTTP 5xx, or provider-availability wording in the error body |
| `TrustedRouterError` | Any other request failure |

API keys are redacted from all error messages.

## Module map

| File | Responsibility |
|------|----------------|
| `scanner.py` | CLI, file discovery, safety filters, submission budgeting, report rendering |
| `trustedrouter_client.py` | OpenAI SDK client for TrustedRouter, request payload, error mapping, routing metadata extraction |
| `prompts.py` | System prompt (untrusted-data rules), user prompt builder, tolerant JSON output parser |
| `app.py` | Repository-convention entry point (shim over `scanner.main`) |
