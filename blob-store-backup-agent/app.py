import os
import hashlib
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
import telnyx
from google.cloud import storage

load_dotenv()

app = Flask(__name__)

# Initialize Telnyx client
telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx_client = telnyx.TelnyxClient(api_key=os.getenv("TELNYX_API_KEY"))

# Configuration
BLOB_STORE_PATH = Path(os.getenv("BLOB_STORE_PATH", "./blob_store"))
BACKUP_BUCKET = os.getenv("BACKUP_BUCKET")
BACKUP_PREFIX = os.getenv("BACKUP_PREFIX", "backups")
DB_PATH = os.getenv("DB_PATH", "backup_registry.db")
SMS_TO = os.getenv("SMS_TO")
SMS_FROM = os.getenv("SMS_FROM")
BACKUP_INTERVAL_HOURS = int(os.getenv("BACKUP_INTERVAL_HOURS", "24"))


def init_db():
    """Initialize the SQLite backup registry."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blob_name TEXT NOT NULL,
            backup_path TEXT NOT NULL,
            checksum TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def get_checksum(file_path: Path) -> str:
    """Compute SHA-256 checksum of a file."""
    import hashlib

    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def send_sms_notification(message: str):
    """Send SMS notification via Telnyx."""
    try:
        telnyx_client.messages.send(
            from_=SMS_FROM,
            to=SMS_TO,
            text=message,
        )
        app.logger.info("SMS notification sent")
    except Exception as e:
        app.logger.exception("Failed to send SMS notification: %s", e)


def perform_backup():
    """Perform the backup of all blobs in the blob store."""
    if not app.config.get("BACKUP_ENABLED", True):
        app.logger.info("Backup disabled, skipping")
        return

    app.logger.info("Starting backup cycle")
    backup_results = []

    # Ensure blob store exists
    if not app_store_path.exists():
        app.logger.warning("Blob store path does not exist: %s", app_store_path)
        return

    # Initialize GCS client
    storage_client = storage.Client()
    bucket = storage_client.bucket(BACKUP_BUCKET)

    # Iterate over all files in the blob store
    for blob_file in app_store_path.rglob("*"):
        if not blob_file.is_file():
            continue

        try:
            # Compute checksum
            checksum = get_checksum(blob_file)

            # Upload to GCS
            blob_name = f"{BACKUP_PREFIX}/{blob_file.name}"
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(str(blob_file))

            # Verify checksum after upload
            uploaded_blob = bucket.blob(blob_name)
            uploaded_blob.reload()
            remote_checksum = uploaded_blob.md5_hash
            if remote_checksum != checksum:
                raise ValueError(f"Checksum mismatch for {blob_file.name}")

            # Record in SQLite registry
            conn = sqlite3.connect(DB_PATH)
            conn.execute(
                """
                INSERT INTO backups (blob_name, backup_path, checksum, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    blob_file.name,
                    blob_name,
                    checksum,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            conn.commit()
            conn.close()

            backup_results.append(
                {"blob": blob_file.name, "status": "success", "checksum": checksum}
            )
            app.logger.info("Backed up %s to %s", blob_file.name, blob_name)

        except Exception as e:
            app.logger.exception("Failed to backup %s: %s", blob_file.name, e)
            backup_results.append(
                {"blob": blob_file.name, "status": "failed", "error": str(e)}
            )

    # Send notification
    if backup_results:
        success_count = sum(1 for r in backup_results if r["status"] == "success")
        fail_count = len(backup_results) - success_count
        message = f"Backup complete: {success_count} succeeded, {fail_count} failed"
        send_sms_notification(message)


# Initialize app store path
app_store_path = Path(app.config.get("BLOB_STORE_PATH", "/blob"))
app_store_path.mkdir(parents=True, exist_ok=True)


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()})


@app.route("/backup", methods=["POST"])
def trigger_backup():
    """Manually trigger a backup."""
    try:
        perform_backup()
        return jsonify({"status": "success", "message": "Backup completed"}), 200
    except Exception as e:
        app.logger.exception("Backup failed: %s", e)
        return jsonify({"status": "error", "message": "Backup failed"}), 500


@app.route("/backups", methods=["GET"])
def list_backups():
    """List all recorded backups."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute("SELECT * FROM backups ORDER BY created_at DESC")
        rows = cursor.fetchall()
        conn.close()

        backups = [
            {
                "id": row[0],
                "blob_name": row[1],
                "backup_path": row[2],
                "checksum": row[3],
                "created_at": row[4],
            }
            for row in rows
        ]
        return jsonify({"backups": backups}), 200
    except Exception as e:
        app.logger.exception("Failed to list backups: %s", e)
        return jsonify({"status": "error", "message": "Failed to list backups"}), 500


def schedule_backup():
    """Schedule periodic backups."""
    import threading
    import time

    def run_scheduled():
        while True:
            try:
                perform_backup()
            except Exception as e:
                app.logger.exception("Scheduled backup failed: %s", e)
            time.sleep(BACKUP_INTERVAL_HOURS * 3600)

    if os.getenv("ENABLE_SCHEDULED_BACKUP", "true").lower() == "true":
        thread = threading.Thread(target=schedule_scheduled, daemon=True)
        thread.start()
        app.logger.info("Scheduled backup started with interval %d hours", BACKUP_INTERVAL_HOURS)


def schedule_scheduled():
    """Wrapper for scheduled backup execution."""
    import time

    while True:
        try:
            perform_backup()
        except Exception as e:
            app.logger.exception("Scheduled backup failed: %s", e)
        time.sleep(BACKUP_INTERVAL_HOURS * 3600)


if __name__ == "__main__":
    init_db()
    schedule_backup()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
