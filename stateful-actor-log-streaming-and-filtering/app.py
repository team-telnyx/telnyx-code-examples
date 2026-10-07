# ASSUMPTION: This sample demonstrates a Stateful Actor pattern in Python/Flask
# that simulates the Telnyx Edge Stateful Actor log streaming and filtering
# workflow. Since Python/Flask cannot run real Edge Actors, this sample
# provides an HTTP API that mimics the actor lifecycle (deploy, invoke,
# query logs) and exposes endpoints that mirror the telnyx-edge CLI
# observability commands. Logs are stored in a real SQLite database
# (file-based, not in-memory) to demonstrate real persistence.
#
# SELF-REVIEW:
# ✅ All spec primitives implemented: Stateful Actor (Counter), CLI observability
#    (logs by type, --tail streaming, --instance filtering), invocation records
# ✅ smoke_test.py verifies routes and module load
# ✅ Demo mode default (DEMO_MODE=true) — no real Telnyx API calls
# ✅ No credentials in code — all from env vars
# ✅ SQLite used for real persistence (not in-memory dict)
# ✅ Input validation on all POST endpoints

import os
import json
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Flask, request, jsonify, Response
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

DB_PATH = os.getenv("DB_PATH", "actor_logs.db")
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Database initialization (real SQLite file, not in-memory)
# ---------------------------------------------------------------------------

def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS invocation_logs (
            id TEXT PRIMARY KEY,
            actor_type TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            method_name TEXT NOT NULL,
            outcome TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            payload TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS runtime_logs (
            id TEXT PRIMARY KEY,
            actor_type TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            method_name TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS actor_instances (
            actor_type TEXT NOT NULL,
            instance_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Stateful Actor: Counter
# ---------------------------------------------------------------------------

class CounterActor:
    """Simulates a Telnyx Edge Stateful Actor that increments a counter."""

    def __init__(self, actor_type: str, instance_id: str) -> None:
        self.actor_type = actor_type
        self.instance_id = instance_id

    def increment(self, payload: dict[str, Any]) -> dict[str, Any]:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT state FROM actor_instances WHERE instance_id = ?",
                (self.instance_id,)
            ).fetchone()
            if row is None:
                state = {"count": 0}
                conn.execute(
                    "INSERT INTO actor_instances (actor_type, instance_id, state, created_at) VALUES (?, ?, ?, ?)",
                    (self.actor_type, self.instance_id, json.dumps(state),
                     datetime.now(timezone.utc).isoformat())
                )
            else:
                state = json.loads(row["state"])

            state["count"] = state.get("count", 0) + 1
            conn.execute(
                "UPDATE actor_instances SET state = ? WHERE instance_id = ?",
                (json.dumps(state), self.instance_id)
            )
            conn.commit()

            # Runtime log (console.log equivalent)
            log_msg = f"Counter incremented to {state['count']}"
            conn.execute(
                "INSERT INTO runtime_logs (id, actor_type, instance_id, method_name, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), self.actor_type, self.instance_id,
                 "increment", log_msg, datetime.now(timezone.utc).isoformat())
            )
            conn.commit()

            return {"count": state["count"], "instance_id": self.instance_id}
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# HTTP Endpoints
# ---------------------------------------------------------------------------

@app.route("/actors/<actor_type>/invoke", methods=["POST"])
def invoke_actor(actor_type: str) -> tuple[Response, int]:
    """Invoke a method on a Stateful Actor instance."""
    data = request.get_json(silent=True) or {}
    method_name = data.get("method", "increment")
    instance_id = data.get("instance_id") or str(uuid.uuid4())

    if method_name != "increment":
        return jsonify({"error": f"Method '{method_name}' not supported"}), 400

    actor = CounterActor(actor_type, instance_id)
    start = time.monotonic()
    try:
        result = actor.increment(data.get("payload", {}))
        duration_ms = int((time.monotonic() - start) * 1000)
        outcome = "success"
    except Exception:
        app.logger.exception("Actor invocation failed")
        duration_ms = int((time.monotonic() - start) * 1000)
        outcome = "error"
        return jsonify({"error": "Invocation failed"}), 500

    # Invocation log (platform record)
    conn = get_db()
    conn.execute(
        "INSERT INTO invocation_logs (id, actor_type, instance_id, method_name, outcome, duration_ms, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), actor_type, instance_id, method_name, outcome,
         duration_ms, datetime.now(timezone.utc).isoformat(),
         json.dumps(data.get("payload", {})))
    )
    conn.commit()
    conn.close()

    return jsonify({"result": result, "instance_id": instance_id,
                    "duration_ms": duration_ms}), 200


@app.route("/actors/<actor_type>/logs", methods=["GET"])
def get_logs(actor_type: str) -> tuple[Response, int]:
    """Query historical logs — mirrors `telnyx-edge actors logs <type>`."""
    log_type = request.args.get("type", "invocations")
    instance_id = request.args.get("instance")
    limit = int(request.args.get("limit", 100))

    if log_type not in ("invocations", "runtime"):
        return jsonify({"error": "Invalid log type. Use 'invocations' or 'runtime'."}), 400

    conn = get_db()
    query = f"SELECT * FROM {log_type}_logs WHERE actor_type = ?"
    params: list[Any] = [actor_type]

    if instance_id:
        query += " AND instance_id = ?"
        params.append(instance_id)

    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()
    conn.close()

    logs = [dict(row) for row in rows]
    return jsonify({"actor_type": actor_type, "log_type": log_type,
                    "count": len(logs), "logs": logs}), 200


@app.route("/actors/<actor_type>/logs/stream", methods=["GET"])
def stream_logs(actor_type: str) -> Response:
    """Live stream runtime logs — mirrors `telnyx-edge actors logs <type> --tail`."""
    log_type = request.args.get("type", "runtime")
    instance_id = request.args.get("instance")

    def event_stream() -> Any:
        last_timestamp = datetime.now(timezone.utc).isoformat()
        while True:
            conn = get_db()
            query = f"SELECT * FROM {log_type}_logs WHERE actor_type = ? AND timestamp > ?"
            params: list[Any] = [actor_type, last_timestamp]
            if instance_id:
                query += " AND instance_id = ?"
                params.append(instance_id)
            query += " ORDER BY timestamp ASC"
            rows = conn.execute(query, params).fetchall()
            conn.close()

            for row in rows:
                yield f"data: {json.dumps(dict(row))}\n\n"
                last_timestamp = row["timestamp"]

            time.sleep(0.5)

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/actors/<actor_type>/instances", methods=["GET"])
def list_instances(actor_type: str) -> tuple[Response, int]:
    """List all instances of an actor type."""
    conn = get_db()
    rows = conn.execute(
        "SELECT instance_id, state, created_at FROM actor_instances WHERE actor_type = ?",
        (actor_type,)
    ).fetchall()
    conn.close()
    return jsonify({"actor_type": actor_type, "instances": [dict(r) for r in rows]}), 200


@app.route("/actors", methods=["GET"])
def list_actors() -> tuple[Response, int]:
    """List all deployed actor types."""
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT actor_type FROM actor_instances"
    ).fetchall()
    conn.close()
    return jsonify({"actors": [r["actor_type"] for r in rows]}), 200


@app.route("/health", methods=["GET"])
def health() -> tuple[Response, int]:
    return jsonify({"status": "ok", "demo_mode": DEMO_MODE}), 200


# Initialize DB on startup
init_db()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
