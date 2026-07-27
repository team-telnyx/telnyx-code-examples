---
name: error-explainer
title: "AI Error Explainer"
description: "AI Error Explainer — paste a stack trace, get a root-cause hypothesis, confidence, severity, and a suggested fix via Telnyx AI Inference."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI Error Explainer

AI Error Explainer — paste a stack trace, get a root-cause hypothesis, confidence, severity, and a suggested fix via Telnyx AI Inference.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  Stack trace
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference
           │
           ├──► Diagnosis + fix suggestion
           │
           ▼
     Structured JSON
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/error-explainer-python
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

### `POST /explain`

Submit a stack trace and get a structured root-cause diagnosis.

```bash
curl -X POST http://localhost:5000/explain \
  -H "Content-Type: application/json" \
  -d '{
    "language": "python",
    "context": "Flask production server with gunicorn",
    "stack_trace": "Traceback (most recent call last):\n  File \"app.py\", line 42, in handle_request\n    resp = requests.post(url)\n  File \"/usr/lib/python3.11/site-packages/requests/api.py\", line 115, in post\n    return request(\"post\", url, data=data, json=json, **kwargs)\nrequests.exceptions.ConnectionError: HTTPSConnectionPool(host=api.example.com, port=443): Max retries exceeded with url: / (Caused by NewConnectionError(<urllib3.connection.HTTPSConnection object at 0x7f>: Failed to establish a new connection: [Errno 111] Connection refused))"
  }'
```

**Response:**

```json
{
  "id": "ex-1750280400",
  "root_cause": "The requests.post() call has no timeout and no retry logic, so it fails immediately when the downstream API is unreachable.",
  "severity": "high",
  "confidence": 0.94,
  "likely_culprit": "app.py:42 — requests.post() call",
  "suggested_fix": "Add an explicit timeout parameter and wrap the call in a try/except for requests.exceptions.ConnectionError. Implement retry with exponential backoff for transient failures.",
  "fix_snippet": "resp = requests.post(url, timeout=15)",
  "related_errors": ["requests.exceptions.Timeout", "requests.exceptions.ReadTimeout"],
  "prevention": "Always set explicit timeouts on outbound HTTP calls and implement circuit breakers for downstream dependencies.",
  "generated_at": "2026-07-15T14:30:00Z",
  "language": "python"
}
```

### `GET /analyses`

List all recent error analyses.

```bash
curl http://localhost:5000/analyses
```

**Response:**

```json
{
  "analyses": [
    {
      "id": "ex-1750280400",
      "root_cause": "The requests.post() call has no timeout...",
      "severity": "high",
      "confidence": 0.94
    }
  ]
}
```

### `GET /analyses/<id>`

Get a specific analysis by ID.

```bash
curl http://localhost:5000/analyses/ex-1750280400
```

**Response:**

```json
{
  "id": "ex-1750280400",
  "root_cause": "The requests.post() call has no timeout...",
  "severity": "high",
  "confidence": 0.94,
  "likely_culprit": "app.py:42 — requests.post() call",
  "suggested_fix": "Add an explicit timeout parameter..."
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
  "analyses": 0,
  "version": "1.0.0"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |
| Slow / empty response | Wrong model name | Verify `AI_MODEL` at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/models) |
| `raw` returned instead of JSON | Model didn't return parseable JSON | Retry with a shorter stack trace or pin a stronger model |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [AI Changelog Generator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md)
- [AI Customer Churn Predictor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-churn-predictor-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)
- [Build RAG with Telnyx Inference (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
