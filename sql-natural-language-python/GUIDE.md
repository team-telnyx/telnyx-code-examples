# Build an AI SQL Natural Language Query Generator

AI SQL Natural Language — turn plain-English questions into validated SQL with schema context via Telnyx AI Inference. Includes a sample dataset for live execution.

## How It Works

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

## Telnyx Products Used

- **AI Inference** — LLM inference with OpenAI-compatible API, runs on Telnyx infrastructure

## API Endpoints

- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sql-natural-language-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Helper Functions

- **`call_inference()`** — Sends the SQL prompt to Telnyx AI Inference and returns the model's response. Handles reasoning models with large `max_tokens` and strips markdown fences.
- **`build_sql_prompt()`** — Constructs the prompt that asks the LLM to convert a natural-language question into a read-only SQL query, returning JSON with `sql`, `explanation`, `tables_used`, and `is_select`.
- **`get_sample_schema_ddl()`** — Extracts the `CREATE TABLE` statements from `sample_schema.sql` to feed to the LLM.
- **`run_sample_sql()`** — Creates an in-memory SQLite DB from `sample_schema.sql`, executes the generated SQL, and returns the columns + rows.

### Sample Dataset

The bundled `sample_schema.sql` contains:
- **customers** — 5 rows (Acme Corp, Globex Inc, Initech LLC, Umbrella AG, Soylent BV)
- **products** — 5 rows (SMS API Plan, Voice Minute Bundle, Number Rental, Storage Bucket, AI Inference Token)
- **orders** — 10 rows with statuses (paid, pending, refunded) across June–July 2025

### Business Logic

- **`generate_query()`** — Accepts a question + your own schema, asks the LLM to produce SQL, and stores the result.
- **`generate_and_run_sample()`** — Accepts a question, generates SQL against the sample schema, and executes it against the in-memory SQLite DB to return actual rows.
- **`validate_sql()`** — Dry-runs a SQL string against the sample dataset to check validity.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/query` | Generate SQL from NL + your schema |
| `POST` | `/query/sample` | Generate + execute SQL against sample data |
| `POST` | `/validate` | Validate SQL against sample dataset |
| `GET` | `/queries` | List generated queries |
| `GET` | `/queries/<id>` | Get a specific query |
| `GET` | `/health` | Health check |

The inference helper sends the prompt to Telnyx AI and returns the response:

```python
def call_inference(messages, max_tokens=4000):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}, timeout=40)
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"].get("content")
    if content is None:
        raise ValueError("model returned no content (try a larger max_tokens or a non-reasoning model)")
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content
        content = content.rsplit("```", 1)[0]
        content = content.strip()
    return content
```

The sample query endpoint generates SQL and runs it against the sample data:

```python
@app.route("/query/sample", methods=["POST"])
def generate_and_run_sample():
    data = request.get_json()
    question = data.get("question", "").strip()
    schema = get_sample_schema_ddl()
    prompt = build_sql_prompt(question, schema, "sqlite")
    result = call_inference([
        {"role": "system", "content": "You are a SQL expert. Generate read-only SQLite queries. Return JSON only."},
        {"role": "user", "content": prompt},
    ])
    query_obj = json.loads(result)
    sql = query_obj.get("sql", "").rstrip(";").strip()
    query_obj["execution"] = run_sample_sql(sql)
    return jsonify(query_obj), 200
```

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Generate + execute against sample data:**

```bash
curl -X POST http://localhost:5000/query/sample \
  -H "Content-Type: application/json" \
  -d '{"question": "Show me the top 3 customers by total order revenue"}' | python3 -m json.tool
```

**Generate SQL from your own schema:**

```bash
curl -X POST http://localhost:5000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "How many orders were placed in June?",
    "dialect": "postgresql",
    "schema": "CREATE TABLE orders (id INT PRIMARY KEY, total DECIMAL(10,2), created_at TIMESTAMP);"
  }' | python3 -m json.tool
```

**Validate SQL:**

```bash
curl -X POST http://localhost:5000/validate \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT COUNT(*) AS total FROM orders WHERE status = '"'"'paid'"'"'"}' | python3 -m json.tool
```

**List queries:**

```bash
curl http://localhost:5000/queries | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage and a SQLite sample dataset. For production:

- **Database** — connect to your real database (PostgreSQL, MySQL, etc.) instead of in-memory SQLite
- **Read-only enforcement** — apply a read-only database user or a SQL firewall beyond the prompt
- **Authentication** — add API key validation on your endpoints
- **Schema management** — let users upload schema files or connect to a live DB to auto-extract DDL
- **Query limits** — enforce row limits and timeouts on generated queries
- **Rate limiting** — protect your endpoints from abuse
- **Prompt engineering** — tune the prompt for your database conventions and naming patterns

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Resources

- [Source code and reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sql-natural-language-python/README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [AI Inference docs](https://developers.telnyx.com/docs/inference)
- [Telnyx Portal](https://portal.telnyx.com)
