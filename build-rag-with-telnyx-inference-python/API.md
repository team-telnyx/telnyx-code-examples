# API Reference

## `POST /rag/ask`

Retrieve relevant documents and answer a question with Telnyx AI Inference.

### Request

```json
{
  "question": "Production signup broke after rotating an API key. Logs show 401 errors. What should we check first?",
  "top_k": 3,
  "model": "moonshotai/Kimi-K2.6"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | **yes** | Question to answer from retrieved context |
| `top_k` | `integer` | no | Number of documents to retrieve, from 1 to the document count |
| `model` | `string` | no | Telnyx chat model name |

### Response `200`

```json
{
  "answer": "Check that production services are using the new active API key and that the key has the required permissions.",
  "model": "moonshotai/Kimi-K2.6",
  "embedding_model": "thenlper/gte-large",
  "sources": [
    {"title": "API Key Authentication", "score": 0.9123}
  ]
}
```

### Errors

| Status | Meaning |
|--------|---------|
| `400` | Missing or empty question |
| `500` | Missing server configuration |
| `502` | Telnyx AI Inference request failed |

## `GET /documents`

Returns the sample knowledge base.

## `GET /health`

Returns service status, configured models, and document count.
