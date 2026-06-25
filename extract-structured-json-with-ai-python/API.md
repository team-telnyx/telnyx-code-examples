# API Reference

## `POST /extract`

Extract structured JSON from unstructured text with Telnyx AI Inference.

### Request

```json
{
  "text": "Account: Acme Health. Production verification jobs started failing after an API key rotation. Users cannot finish signup. Logs show 401 errors.",
  "model": "moonshotai/Kimi-K2.6",
  "schema": {
    "type": "object",
    "properties": {
      "company": {"type": "string"},
      "summary": {"type": "string"}
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | **yes** | Unstructured text to extract from |
| `model` | `string` | no | Telnyx AI Inference model name |
| `schema` | `object` | no | JSON Schema that describes the desired output shape |

### Response `200`

```json
{
  "model": "moonshotai/Kimi-K2.6",
  "result": {
    "company": "Acme Health",
    "summary": "Production verification jobs are failing after an API key rotation."
  }
}
```

### Errors

| Status | Meaning |
|--------|---------|
| `400` | Missing text or invalid schema |
| `500` | Missing server configuration |
| `502` | Telnyx AI Inference failed or returned invalid JSON |

## `GET /sample`

Returns sample input text and the default schema.

## `GET /health`

Returns service status and the configured model.
