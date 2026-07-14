## `POST /query`

Generate SQL from a natural-language question using your own schema.

### Request

```json
{
  "question": "Show me the top 10 customers by total order revenue",
  "dialect": "postgresql",
  "schema": "CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(255)); CREATE TABLE orders (id INT, customer_id INT, total DECIMAL(10,2), created_at TIMESTAMP);"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | **yes** | Natural-language question |
| `schema` | `string` | **yes** | DDL statements describing the tables |
| `dialect` | `string` | no | SQL dialect (default `postgresql`) |

### Response `200`

```json
{
  "id": "sql-1750280400",
  "question": "Show me the top 10 customers by total order revenue",
  "sql": "SELECT c.name, SUM(o.total) AS revenue FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.name ORDER BY revenue DESC LIMIT 10;",
  "explanation": "Sums order totals per customer and returns the top 10.",
  "tables_used": ["customers", "orders"],
  "is_select": true,
  "dialect": "postgresql",
  "generated_at": "2026-07-15T14:30:00Z"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/query \
  -H "Content-Type: application/json" \
  -d '{"question":"top 5 by revenue","dialect":"postgresql","schema":"CREATE TABLE customers (id INT PRIMARY KEY, name TEXT); CREATE TABLE orders (id INT, customer_id INT, total REAL);"}'
```

---

## `POST /query/sample`

Generate SQL and execute it against the bundled sample dataset.

### Request

```json
{
  "question": "Show me the top 3 customers by total order revenue"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | **yes** | Natural-language question |

### Response `200`

```json
{
  "id": "sql-1750280401",
  "question": "Show me the top 3 customers by total order revenue",
  "sql": "SELECT customer_id, SUM(total) AS total_revenue FROM orders GROUP BY customer_id ORDER BY total_revenue DESC LIMIT 3;",
  "explanation": "Sums order totals per customer.",
  "tables_used": ["orders"],
  "is_select": true,
  "dialect": "sqlite",
  "schema_used": "sample",
  "execution": {
    "columns": ["customer_id", "total_revenue"],
    "rows": [
      {"customer_id": 1, "total_revenue": 1597.9},
      {"customer_id": 4, "total_revenue": 1048.99}
    ],
    "row_count": 2
  },
  "generated_at": "2026-07-15T14:30:00Z"
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/query/sample \
  -H "Content-Type: application/json" \
  -d '{"question":"Show me all orders with status pending"}'
```

---

## `POST /validate`

Validate a SQL string by dry-running it against the sample dataset.

### Request

```json
{
  "sql": "SELECT * FROM orders WHERE total > 100",
  "sample": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sql` | `string` | **yes** | SQL string to validate |
| `sample` | `boolean` | no | Use sample dataset (default `true`) |

### Response `200`

```json
{
  "is_valid": true,
  "columns": ["id", "customer_id", "total", "status", "created_at"],
  "rows": [...],
  "row_count": 5
}
```

**Try it:**

```bash
curl -X POST http://localhost:5000/validate \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT COUNT(*) FROM customers"}'
```

---

## `GET /queries`

List all recent generated queries (most recent 50).

### Response `200`

```json
{
  "queries": [
    {
      "id": "sql-1750280400",
      "question": "top 5 by revenue",
      "sql": "SELECT ...",
      "is_select": true
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/queries
```

---

## `GET /queries/<id>`

Get a specific query by ID.

### Response `200`

```json
{
  "id": "sql-1750280400",
  "question": "top 5 by revenue",
  "sql": "SELECT ...",
  "explanation": "..."
}
```

### Response `404`

```json
{"error": "query not found"}
```

**Try it:**

```bash
curl http://localhost:5000/queries/sql-1750280400
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "queries": 0,
  "version": "1.0.0"
}
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{
  "error": "invalid request body"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `404` | Query not found |
| `500` | Server error |
