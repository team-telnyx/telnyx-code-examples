---
name: changelog-generator
title: "AI Changelog Generator"
description: "AI Changelog Generator — turn git commits and diffs into a clean, human-readable changelog via Telnyx AI Inference."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI Changelog Generator

AI Changelog Generator — turn git commits and diffs into a clean, human-readable changelog via Telnyx AI Inference.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  Git history / diff
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference
           │
           ├──► Grouping + summarization
           │
           ▼
     Structured changelog (JSON)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/changelog-generator-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

<details>
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

</details>


## API Reference

### `POST /generate`

Generate a changelog from a list of commit messages.

```bash
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "version": "v1.4.0",
    "repo_name": "billing-service",
    "commits": [
      "feat: add Stripe webhook retry with exponential backoff",
      "fix: correct tax calculation for EU VAT exemption",
      "chore: merge branch main into release",
      "docs: update API reference for invoice endpoint",
      "refactor: extract currency formatter into shared util"
    ]
  }'
```

**Response:**

```json
{
  "id": "cl-1750280400",
  "version": "v1.4.0",
  "date": "2026-07-15T14:30:00Z",
  "sections": [
    {"heading": "Features", "items": ["Add Stripe webhook retry with exponential backoff"]},
    {"heading": "Bug Fixes", "items": ["Correct tax calculation for EU VAT exemption"]},
    {"heading": "Improvements", "items": ["Extract currency formatter into shared util"]},
    {"heading": "Documentation", "items": ["Update API reference for invoice endpoint"]}
  ],
  "summary": "Adds resilient Stripe webhook handling and fixes EU VAT tax calculation.",
  "generated_at": "2026-07-15T14:30:15Z",
  "commit_count": 5
}
```

### `POST /generate/from-diff`

Generate a changelog from a git diff.

```bash
curl -X POST http://localhost:5000/generate/from-diff \
  -H "Content-Type: application/json" \
  -d '{
    "version": "v1.4.1",
    "diff": "diff --git a/app.py b/app.py\n+def retry_send(message, retries=3):"
  }'
```

**Response:**

```json
{
  "id": "cl-1750280401",
  "version": "v1.4.1",
  "sections": [
    {"heading": "Features", "items": ["Add retry_send helper with configurable retries"]}
  ],
  "summary": "Introduces a retry helper for sending messages.",
  "generated_at": "2026-07-15T14:31:00Z"
}
```

### `GET /changelogs`

List all generated changelogs.

```bash
curl http://localhost:5000/changelogs
```

**Response:**

```json
{
  "changelogs": [
    {
      "id": "cl-1750280400",
      "version": "v1.4.0",
      "summary": "Adds resilient Stripe webhook handling and fixes EU VAT tax calculation."
    }
  ]
}
```

### `GET /changelogs/<id>`

Get a specific changelog.

```bash
curl http://localhost:5000/changelogs/cl-1750280400
```

**Response:**

```json
{
  "id": "cl-1750280400",
  "version": "v1.4.0",
  "sections": [
    {"heading": "Features", "items": ["Add Stripe webhook retry with exponential backoff"]}
  ],
  "summary": "Adds resilient Stripe webhook handling and fixes EU VAT tax calculation."
}
```

### `GET /health`

Returns service health.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "changelogs": 3,
  "version": "1.0.0"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |
| Slow / empty response | Wrong model name | Verify `AI_MODEL` at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/models) |
| `raw` returned instead of JSON | Model didn't return parseable JSON | Retry with a shorter commit list or pin a stronger model |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [AI Customer Churn Predictor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-churn-predictor-python/README.md)
- [AI Content Translator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-content-translator-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)
- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
