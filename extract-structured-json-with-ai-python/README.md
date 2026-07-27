---
name: extract-structured-json-with-ai
title: "Extract Structured JSON with AI"
description: "Extract structured JSON from support tickets, emails, leads, or incident reports with Telnyx AI Inference."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# Extract Structured JSON with AI

Extract structured JSON from support tickets, emails, leads, or incident reports with Telnyx AI Inference.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  Unstructured text
        |
        v
  Flask API validates request
        |
        v
  Telnyx AI Inference extracts JSON
        |
        v
  Structured JSON response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Models](https://developers.telnyx.com/docs/inference/models) |
| `HOST` | `string` | `127.0.0.1` | no | Local server host | - |
| `PORT` | `integer` | `5000` | no | Local server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/extract-structured-json-with-ai-python
cp .env.example .env
pip install -r requirements.txt
python app.py
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

### `POST /extract`

Extract structured data from text. If you do not provide a schema, the app uses a default support-ticket schema.

```bash
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Account: Acme Health. Production verification jobs started failing after an API key rotation. Users cannot finish signup. Logs show 401 errors."
  }'
```

**Response:**

```json
{
  "model": "moonshotai/Kimi-K2.6",
  "result": {
    "company": "Acme Health",
    "category": "authentication",
    "priority": "urgent",
    "summary": "Production verification jobs are failing after an API key rotation.",
    "affected_environment": "production",
    "affected_region": "unknown",
    "customer_impact": "Users cannot finish signup.",
    "error_codes": ["401"],
    "suspected_cause": "The new API key may be invalid or missing required permissions.",
    "requested_action": "Check API key configuration and permissions."
  }
}
```

### `GET /sample`

Returns sample text and the default schema.

### `GET /health`

Returns service status and configured model.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing Telnyx API key | Verify `TELNYX_API_KEY` in `.env` |
| `400 Bad Request` | Missing `text` or invalid `schema` | Send a non-empty `text` string and a JSON object schema |
| `502 Model response was not valid JSON` | The selected model did not return parseable JSON | Retry with the default model or simplify the schema |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Run LLM Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md)
- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md)
- [Fax to Structured Data Pipeline (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/fax-to-structured-data-pipeline-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
