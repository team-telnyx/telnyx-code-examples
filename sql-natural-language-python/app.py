#!/usr/bin/env python3
"""AI SQL Natural Language — turn natural-language questions into SQL with schema context and validation via Telnyx AI Inference."""
import os, json, time, sqlite3, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "moonshotai/Kimi-K2.6")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
queries = {}
SAMPLE_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "sample_schema.sql")

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

def build_sql_prompt(question, schema, dialect="postgresql"):
    return f"""You are a {dialect} expert. Convert the natural-language question into a single SQL query.

Schema (DDL):
{schema}

Rules:
- Generate a READ-ONLY query (SELECT only). Never produce INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE.
- Return JSON with these fields:
  - sql (string): the SQL query, ending with a semicolon
  - explanation (string): one or two sentences explaining what the query does
  - tables_used (array of strings): table names referenced
  - is_select (boolean): always true for a read-only query

Question: {question}"""

def get_sample_schema_text():
    with open(SAMPLE_SCHEMA_PATH, "r") as f:
        return f.read()

def get_sample_schema_ddl():
    text = get_sample_schema_text()
    statements = [s.strip() for s in text.split(";") if s.strip() and s.strip().upper().startswith("CREATE TABLE")]
    return ";\n".join(statements) + ";"

def run_sample_sql(sql):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(get_sample_schema_text())
        cursor = conn.execute(sql)
        columns = [d[0] for d in cursor.description]
        rows = [dict(r) for r in cursor.fetchall()]
        return {"columns": columns, "rows": rows, "row_count": len(rows)}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()

@app.route("/query", methods=["POST"])
def generate_query():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    question = data.get("question", "").strip()
    schema = data.get("schema", "").strip()
    dialect = data.get("dialect", "postgresql")
    if not question:
        return jsonify({"error": "question field is required"}), 400
    if not schema:
        return jsonify({"error": "schema field is required"}), 400
    prompt = build_sql_prompt(question, schema, dialect)
    try:
        result = call_inference([
            {"role": "system", "content": "You are a SQL expert. Generate read-only SQL from natural language. Return JSON only."},
            {"role": "user", "content": prompt},
        ])
        query_obj = json.loads(result)
        query_id = f"sql-{int(time.time())}"
        query_obj["id"] = query_id
        query_obj["question"] = question
        query_obj["dialect"] = dialect
        query_obj["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        queries[query_id] = query_obj
        return jsonify(query_obj), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("SQL generation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/query/sample", methods=["POST"])
def generate_and_run_sample():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    question = data.get("question", "").strip()
    if not question:
        return jsonify({"error": "question field is required"}), 400
    schema = get_sample_schema_ddl()
    dialect = "sqlite"
    prompt = build_sql_prompt(question, schema, dialect)
    try:
        result = call_inference([
            {"role": "system", "content": "You are a SQL expert. Generate read-only SQLite queries from natural language. Return JSON only."},
            {"role": "user", "content": prompt},
        ])
        query_obj = json.loads(result)
        query_id = f"sql-{int(time.time())}"
        query_obj["id"] = query_id
        query_obj["question"] = question
        query_obj["dialect"] = dialect
        query_obj["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        query_obj["schema_used"] = "sample"
        sql = query_obj.get("sql", "")
        if not sql:
            return jsonify(query_obj), 200
        sql_clean = sql.rstrip(";").strip()
        exec_result = run_sample_sql(sql_clean)
        query_obj["execution"] = exec_result
        queries[query_id] = query_obj
        return jsonify(query_obj), 200
    except json.JSONDecodeError:
        return jsonify({"raw": result}), 200
    except Exception:
        app.logger.exception("sample SQL generation failed")
        return jsonify({"error": "internal error"}), 500

@app.route("/validate", methods=["POST"])
def validate_sql():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid request body"}), 400
    sql = data.get("sql", "").strip()
    if not sql:
        return jsonify({"error": "sql field is required"}), 400
    use_sample = data.get("sample", True)
    if use_sample:
        exec_result = run_sample_sql(sql.rstrip(";").strip())
    else:
        return jsonify({"error": "custom schema validation not supported in this endpoint; use /query/sample"}), 400
    is_valid = "error" not in exec_result
    return jsonify({"is_valid": is_valid, **exec_result}), 200

@app.route("/queries", methods=["GET"])
def list_queries():
    results = list(queries.values())[-50:]
    return jsonify({"queries": results}), 200

@app.route("/queries/<query_id>", methods=["GET"])
def get_query(query_id):
    query_obj = queries.get(query_id)
    if not query_obj:
        return jsonify({"error": "query not found"}), 404
    return jsonify(query_obj), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "queries": len(queries), "version": "1.0.0"}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
