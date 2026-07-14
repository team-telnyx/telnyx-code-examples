---
name: sql-natural-language
title: "AI SQL Natural Language"
description: "AI SQL Natural Language — turn plain-English questions into validated SQL with schema context via Telnyx AI Inference. Includes a sample dataset for live execution."
language: python
framework: flask
telnyx_products: [AI Inference]
---

# AI SQL Natural Language

AI SQL Natural Language — turn plain-English questions into validated SQL with schema context via Telnyx AI Inference. Includes a sample dataset for live execution.

## Telnyx API Endpoints Used

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  NL question + schema
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  └────────┬─────────┘
           │
           ├──► Telnyx AI Inference
           │
           ├──► SQL generation + explanation
           │
           ├──► SQLite dry-run (sample data)
           │
           ▼
     Structured JSON (sql, rows, explanation)
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
cd telnyx-code-examples/sql-natural-language-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

## API Reference

### `POST /query`

Generate SQL from a natural-language question using your own schema.

```bash
curl -X POST http://localhost:5000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Show me the top 10 customers by total order revenue in the last 30 days",
    "dialect": "postgresql",
    "schema": "CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(255)); CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT REFERENCES customers(id), total DECIMAL(10,2), created_at TIMESTAMP);"
  }'
```

**Response:**

```json
{
  "id": "sql-1750280400",
  "question": "Show me the top 10 customers by total order revenue in the last 30 days",
  "sql": "SELECT c.name, SUM(o.total) AS revenue FROM customers c JOIN orders o ON c.id = o.customer_id WHERE o.created_at >= NOW() - INTERVAL '30 days' GROUP BY c.name ORDER BY revenue DESC LIMIT 10;",
  "explanation": "Joins customers to orders, filters to last 30 days, sums total per customer, orders by revenue descending.",
  "tables_used": ["customers", "orders"],
  "is_select": true,
  "dialect": "postgresql",
  "generated_at": "2026-07-15T14:30:00Z"
}
```

### `POST /query/sample`

Generate SQL from a natural-language question and execute it against the bundled sample dataset (5 customers, 5 products, 10 orders in SQLite).

```bash
curl -X POST http://localhost:5000/query/sample \
  -H "Content-Type: application/json" \
  -d '{"question": "Show me the top 3 customers by total order revenue"}'
```

**Response:**

```json
{
  "id": "sql-1750280401",
  "question": "Show me the top 3 customers by total order revenue",
  "sql": "SELECT customer_id, SUM(total) AS total_revenue FROM orders GROUP BY customer_id ORDER BY total_revenue DESC LIMIT 3;",
  "explanation": "Sums order totals per customer and returns the top 3 by revenue.",
  "tables_used": ["orders"],
  "is_select": true,
  "dialect": "sqlite",
  "schema_used": "sample",
  "execution": {
    "columns": ["customer_id", "total_revenue"],
    "rows": [
      {"customer_id": 1, "total_revenue": 1597.9},
      {"customer_id": 4, "total_revenue": 1048.99},
      {"customer_id": 2, "total_revenue": 248.99}
    ],
    "row_count": 3
  },
  "generated_at": "2026-07-15T14:30:00Z"
}
```

### `POST /validate`

Validate a SQL string by dry-running it against the sample dataset.

```bash
curl -X POST http://localhost:5000/validate \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM orders WHERE total > 100"}'
```

**Response:**

```json
{
  "is_valid": true,
  "columns": ["id", "customer_id", "total", "status", "created_at"],
  "rows": [...],
  "row_count": 5
}
```

### `GET /queries`

List all recent generated queries.

```bash
curl http://localhost:5000/queries
```

### `GET /queries/<id>`

Get a specific query by ID.

```bash
curl http://localhost:5000/queries/sql-1750280400
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
  "queries": 0,
  "version": "1.0.0"
}
```

## Sample Dataset

The bundled `sample_schema.sql` contains:

- **customers** — 5 rows (Acme Corp, Globex Inc, Initech LLC, Umbrella AG, Soylent BV)
- **products** — 5 rows (SMS API Plan, Voice Minute Bundle, Number Rental, Storage Bucket, AI Inference Token)
- **orders** — 10 rows with statuses (paid, pending, refunded) across June–July 2025

Use `/query/sample` to run NL-generated SQL against this dataset without providing your own schema.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |
| Slow / empty response | Wrong model name | Verify `AI_MODEL` at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/models) |
| `raw` returned instead of JSON | Model didn't return parseable JSON | Retry with a shorter question or pin a stronger model |
| SQL execution error | LLM generated dialect-specific syntax not valid in SQLite | Use `dialect: sqlite` for the sample endpoint |

## Related Examples

- [AI Changelog Generator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md)
- [AI Error Explainer (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/error-explainer-python/README.md)
- [AI Customer Churn Predictor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-churn-predictor-python/README.md)
- [Extract Structured JSON with AI (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md)

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Chat Completions API Reference](https://developers.telnyx.com/api/inference/chat-completions)
- [Available Inference Models](https://developers.telnyx.com/docs/inference/models)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT on one private, global network.
