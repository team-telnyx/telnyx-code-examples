# Guide: Blob Store Backup Agent

This guide walks through the `blob-store-backup-agent` example, a Flask-based service that automatically backs up files from a local blob store to Google Cloud Storage (GCS), verifies data integrity with checksums, records each backup in a SQLite registry, and sends SMS notifications via the Telnyx Messaging API when a backup cycle completes.

By the end of this guide, you'll understand:

- How the backup pipeline works end-to-end
- How checksum verification ensures data integrity
- How the SQLite registry tracks backup history
- How Telnyx SMS notifications keep you informed
- How to run the agent locally and extend it

---

## Prerequisites

Before you begin, make sure you have:

- **Python 3.9+** installed
- A **Telnyx account** with a Messaging API key and a phone number capable of sending SMS
- A **Google Cloud project** with a storage bucket and credentials configured (via `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`)
- A local directory to act as your blob store (or create one at `./blob_store`)

---

## Environment Setup

1. **Clone the repository and navigate to the sample:**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/blob-store-backup-agent
   ```

2. **Create a virtual environment and install dependencies:**

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Configure your environment variables:**

   Copy `.env.example` to `.env` and fill in your values:

   ```bash
   cp .env.example .env
   ```

   At minimum, you'll need:

   | Variable | Description |
   |----------|-------------|
   | `TELNYX_API_KEY` | Your Telnyx API key |
   | `SMS_FROM` | Your Telnyx phone number (E.164 format) |
   | `SMS_TO` | The phone number to receive notifications |
   | `BACKUP_BUCKET` | Your Google Cloud Storage bucket name |

4. **Run the application:**

   ```bash
   python app.py
   ```

   The server starts on `http://localhost:5000` and the scheduled backup thread begins running at the interval you configured (default: every 24 hours).

---

## How the Backup Agent Works

The application is structured around three core responsibilities:

1. **Backup execution** — copy files from the blob store to GCS
2. **Integrity verification** — compute and compare checksums
3. **Notification** — send SMS via Telnyx when a cycle finishes

Let's walk through each piece.

---

### 1. Initialization and Configuration

The application starts by loading environment variables with `dotenv` and initializing the Telnyx client:

```python
load_dotenv()
telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx_client = telnyx.TelnyxClient(api_key=os.getenv("TELNYX_API_KEY"))
```

All configuration values are read from environment variables with sensible defaults:

- `BLOB_STORE_PATH` — where local files live (default: `./blob_store`)
- `BACKUP_BUCKET` — the GCS bucket to upload to
- `BACKUP_PREFIX` — a folder prefix inside the bucket (default: `backups`)
- `BACKUP_INTERVAL_HOURS` — how often the scheduled backup runs (default: `24`)
- `SMS_TO` / `SMS_FROM` — Telnyx messaging numbers

The SQLite registry is initialized at startup via `init_db()`, which creates the `backups` table if it doesn't exist.

---

### 2. The Backup Pipeline

The core logic lives in the `perform_backup()` function. Here's the flow:

#### Step 1: Validate the blob store

The function first checks that the blob store directory exists. If it doesn't, it logs a warning and returns early.

#### Step 2: Initialize the GCS client

```python
storage_client = storage.Client()
bucket = storage_client.bucket(BACKUP_BUCKET)
```

This uses the default Google Cloud credentials from your environment.

#### Step 3: Iterate over files

The function walks the blob store recursively with `rglob("*")` and processes each file:

```python
for blob_file in app_store_path.rglob("*"):
    if not blob_file.is_file():
        continue
```

#### Step 4: Compute and verify checksums

For each file, the agent:

1. Computes a **SHA-256 checksum** locally using `get_checksum()`
2. Uploads the file to GCS
3. Reloads the uploaded blob and reads its `md5_hash`
4. Compares the remote MD5 against the local SHA-256

> **Note:** GCS stores MD5 hashes by default, while the agent computes SHA-256 locally. In a production system you'd want to align these — for example, by computing MD5 locally as well, or by using GCS's CRC32C. The comparison here demonstrates the verification pattern; adjust the hash algorithm to match your integrity requirements.

If the checksums don't match, the agent raises an error and marks that file as failed.

#### Step 5: Record in the SQLite registry

On success, the agent inserts a row into the `backups` table:

```sql
INSERT INTO backups (blob_name, backup_path, checksum, created_at)
VALUES (?, ?, ?, ?)
```

This gives you a full audit trail of every backup, including the checksum and timestamp.

#### Step 6: Send an SMS summary

After processing all files, the agent counts successes and failures and sends an SMS via Telnyx:

```python
message = f"Backup complete: {success_count} succeeded, {fail_count} failed"
send_sms_notification(message)
```

---

### 3. Telnyx SMS Notifications

The `send_sms_notification()` function uses the Telnyx SDK to send a message:

```python
telnyx_client.messages.send(
    from_=SMS_FROM,
    to=SMS_TO,
    text=message,
)
```

This is the core Telnyx primitive in this example. The Telnyx Messaging API handles the SMS delivery, and the SDK abstracts away the HTTP calls.

If the send fails, the error is logged but the backup cycle continues — the notification is best-effort and shouldn't block the backup pipeline.

---

### 4. Scheduled Backups

The agent supports two ways to trigger backups:

#### Scheduled (automatic)

At startup, `schedule_backup()` spawns a daemon thread that runs `perform_backup()` in a loop, sleeping `BACKUP_INTERVAL_HOURS * 3600` seconds between cycles. This is controlled by the `ENABLE_SCHEDULED_BACKUP` env var (default: `true`).

#### Manual (via HTTP)

The `/backup` endpoint triggers a backup on demand:

```bash
curl -X POST http://localhost:5000/backup
```

This is useful for testing or for running a backup outside the scheduled window.

---

### 5. HTTP Endpoints

The app exposes three endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/backup` | Trigger a backup manually |
| `GET` | `/backups` | List all recorded backups from SQLite |

The `/backups` endpoint reads from the SQLite registry and returns JSON:

```json
{
  "backups": [
    {
      "id": 1,
      "blob_name": "file1.txt",
      "backup_path": "backups/file1.txt",
      "checksum": "abc123...",
      "created_at": "2025-01-01T00:00:00+00:00"
    }
  ]
}
```

---

## Telnyx Primitives Used

This example demonstrates one Telnyx primitive:

- **SMS Messaging** — `telnyx_client.messages.send()` sends an SMS notification. The Telnyx SDK handles authentication, request formatting, and error handling.

The Telnyx Messaging API is part of Telnyx's broader **AI Communications Infrastructure**, which provides the building blocks for adding real-time communications to any application.

---

## Error Handling

The agent follows production-safe patterns:

- **Logging** — All errors are logged with `app.logger.exception()` so you get full stack traces in your logs
- **Generic HTTP responses** — API endpoints return generic error messages like `{"status": "error"}` without leaking internal exception details
- **Per-file isolation** — A failure on one file doesn't stop the backup of other files; each file is wrapped in its own try/except
- **Best-effort notifications** — SMS failures are logged but don't crash the backup cycle

---

## Next Steps

Now that you understand how the blob store backup agent works, here are some ideas to extend it:

- **Add Telnyx Call Control** — Instead of just an SMS, you could make a voice call to an on-call engineer when a backup fails. See the [Call Control API docs](https://developers.telnyx.com/docs/api/v2/call-control).
- **Add a webhook** — Use a Telnyx webhook to trigger a backup when an SMS is received, creating a command-and-control channel.
- **Add more verification** — Compare both MD5 and SHA-256, or use GCS's CRC32C for stronger integrity checks.
- **Add retention policies** — Delete old backups from GCS after a configurable number of days.
- **Add a dashboard** — Build a simple UI on top of the `/backups` endpoint to visualize backup history.

### Useful Resources

- [Telnyx Messaging API Docs](https://developers.telnyx.com/docs/api/v2/messaging)
- [Telnyx Python SDK Reference](https://developers.telnyx.com/docs/api/v2/overview)
- [Google Cloud Storage Python Client](https://cloud.google.com/storage/docs/reference/libraries)
- [Flask Documentation](https://flask.palletsprojects.com/)

---

## Summary

The `blob-store-backup-agent` demonstrates a complete backup pipeline:

1. **Local blob store** → **GCS** via the Google Cloud SDK
2. **Integrity** → SHA-256 checksums verified against GCS metadata
3. **History** → SQLite registry tracks every backup
4. **Notifications** → Telnyx SMS keeps you informed

The scheduled backup runs automatically, and you can trigger it manually or query the registry at any time. This pattern is useful for any application that needs reliable, verifiable backups with operational visibility.
