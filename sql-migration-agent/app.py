import os
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

import telnyx
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

app = Flask(__name__)

# Configure Telnyx SDK
telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.public_key = os.getenv("TELNYX_PUBLIC_KEY")

# In-memory migration state (in production, use a distributed store)
# Key: migration_id, Value: {status, current_step, total_steps, error, started_at}
MIGRATION_STATE: Dict[str, Dict] = {}

# Schema version tracking table (in-memory for demo; use SQL DB in production)
SCHEMA_VERSIONS: Dict[str, int] = {}


class MigrationError(Exception):
    """Custom exception for migration failures."""
    pass


def get_schema_version(db_name: str) -> int:
    """Get the current schema version for a database."""
    return SCHEMA_VERSIONS.get(db_name, 0)


def set_schema_version(db_name: str, version: int) -> None:
    """Set the schema version for a database."""
    SCHEMA_VERSIONS[db_name] = version


def fetch_migration_script(migration_id: str) -> Optional[str]:
    """
    Fetch migration script from CloudFS.
    In production, this would call the Telnyx CloudFS API.
    """
    # Simulate fetching from CloudFS
    # In production: use telnyx.CloudFS.get_file(migration_id)
    mock_scripts = {
        "migration_001": "CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));",
        "migration_002": "ALTER TABLE users ADD COLUMN email VARCHAR(255);",
        "migration_003": "CREATE INDEX idx_users_email ON users(email);",
    }
    return mock_scripts.get(migration_id)


def execute_migration_step(script: str, step_index: int) -> None:
    """
    Execute a single migration step.
    In production, this would execute against your SQL database.
    """
    # Simulate execution - in production, use your DB connection
    app.logger.info(f"Executing step {step_index}: {script[:50]}...")
    time.sleep(0.5)  # Simulate work


def rollback_migration(migration_id: str, executed_steps: List[int]) -> None:
    """
    Rollback a failed migration.
    In production, this would execute rollback scripts.
    """
    app.logger.warning(f"Rolling back migration {migration_id}, steps: {executed_steps}")
    # In production, execute rollback scripts in reverse order


def send_sms_notification(to_number: str, message: str) -> None:
    """
    Send SMS notification via Telnyx.
    """
    try:
        telnyx.Message.create(
            from_=os.getenv("TELNYX_FROM_NUMBER"),
            to=to_number,
            text=message,
        )
        app.logger.info(f"SMS sent to {to_number}")
    except Exception as e:
        app.logger.exception(f"Failed to send SMS: {e}")


def run_migration(migration_id: str, db_name: str, notify_number: str) -> None:
    """
    Execute a migration with proper state tracking and rollback support.
    """
    migration_state = MIGRATION_STATE[migration_id]
    migration_state["status"] = "running"
    migration_state["current_step"] = 0

    try:
        # Fetch migration script from CloudFS
        script = fetch_migration_script(migration_id)
        if not script:
            raise MigrationError(f"Migration script {migration_id} not found in CloudFS")

        # Split into steps (in production, parse SQL properly)
        steps = [step.strip() for step in script.split(";") if step.strip()]
        migration_state["total_steps"] = len(steps)
        executed_steps: List[int] = []

        # Execute each step
        for i, step in enumerate(steps):
            migration_state["current_step"] = i + 1
            try:
                execute_migration_step(step, i)
                executed_steps.append(i)
            except Exception as e:
                raise MigrationError(f"Step {i} failed: {str(e)}")

        # Update schema version
        new_version = get_schema_version(db_name) + 1
        set_schema_version(db_name, new_version)
        migration_state["status"] = "completed"
        migration_state["schema_version"] = new_version

        # Send success notification
        if notify_phone:
            send_sms_notification(
                notify_phone,
                f"✅ Migration {migration_id} completed successfully. Schema version: {new_version}",
            )

    except Exception as e:
        # Rollback on failure
        migration_state["status"] = "failed"
        migration_state["error"] = str(e)
        rollback_migration(migration_id, executed_steps)

        # Send failure notification
        if notify_phone:
            send_sms_notification(
                notify_phone,
                f"❌ Migration {migration_id} failed: {str(e)}. Rollback initiated.",
            )


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.route("/migrations", methods=["POST"])
def create_migration():
    """
    Create and queue a new migration.
    This endpoint uses this.queue() pattern for multi-instance rollout.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    migration_id = data.get("migration_id")
    db_name = data.get("db_name", "default")
    notify_phone = data.get("notify_phone")

    if not migration_id:
        return jsonify({"error": "migration_id is required"}), 400

    # Generate unique migration ID if not provided
    if migration_id == "auto":
        migration_id = f"migration_{uuid.uuid4().hex[:8]}"

    # Check if migration already exists
    if migration_id in MIGRATION_STATE:
        return jsonify({"error": f"Migration {migration_id} already exists"}), 409

    # Initialize state
    MIGRATION_STATE[migration_id] = {
        "id": migration_id,
        "db_name": db_name,
        "status": "queued",
        "current_step": 0,
        "total_steps": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notify_phone": notify_phone,
    }

    # Queue the migration for execution
    # In production, this would use a proper queue system
    # The `this.queue()` pattern ensures multi-instance rollout
    app.logger.info(f"Migration {migration_id} queued for execution")

    # For demo, execute immediately (in production, worker would pick this up)
    run_migration(migration_id, db_name, notify_phone)

    return jsonify({"migration_id": migration_id, "status": "queued"}), 202


@app.route("/migrations/<migration_id>", methods=["GET"])
def get_migration(migration_id: str):
    """Get migration status."""
    if migration_id not in MIGRATION_STATE:
        return jsonify({"error": "Migration not found"}), 404

    return jsonify(MIGRATION_STATE[migration_id])


@app.route("/migrations", methods=["GET"])
def list_migrations():
    """List all migrations."""
    return jsonify({"migrations": list(MIGRATION_STATE.values())})


@app.route("/migrations/<migration_id>", methods=["DELETE"])
def cancel_migration(migration_id: str):
    """Cancel a queued migration."""
    if migration_id not in MIGRATION_STATE:
        return jsonify({"error": "Migration not found"}), 404

    if MIGRATION_STATE[migration_id]["status"] == "queued":
        MIGRATION_STATE[migration_id]["status"] = "cancelled"
        return jsonify({"status": "cancelled"})
    else:
        return jsonify({"error": "Cannot cancel migration in current state"}), 400


@app.route("/schema/<db_name>", methods=["GET"])
def get_schema(db_name: str):
    """Get current schema version."""
    return jsonify({"db_name": db_name, "schema_version": get_schema_version(db_name)})


@app.route("/webhooks/telnyx", methods=["POST"])
def telnyx_webhook():
    """
    Handle Telnyx webhooks (e.g., SMS delivery status).
    """
    try:
        # Verify the Telnyx signature
        event = telnyx.webhooks.unwrap(request)
        app.logger.info(f"Received webhook: {event['data']['event_type']}")

        # Extract event data from data.payload
        payload = event["data"]["payload"]
        message_id = payload.get("id")
        status = payload.get("status")

        app.logger.info(f"Message {message_id} status: {status}")
        return jsonify({"status": "ok"}), 200

    except Exception as e:
        app.logger.exception(f"Webhook verification failed: {e}")
        return jsonify({"error": "Invalid signature"}), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
