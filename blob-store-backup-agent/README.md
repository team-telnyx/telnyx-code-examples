---
name: blob-store-backup-agent
title: "Blob Store Backup Agent with Telnyx SMS Notifications"
description: "Automated blob store backup pipeline to Google Cloud Storage with checksum verification, SQLite registry, and Telnyx SMS notifications."
language: python
framework: flask
telnyx_products: [Messaging, SMS]
---

# Blob Store Backup Agent

Automated backup pipeline that syncs local blob files to Google Cloud Storage, verifies integrity via checksums, maintains a SQLite backup registry, and sends SMS notifications through Telnyx when backups complete.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure needed to reliably notify operators when backup jobs complete or fail. Instead of building and maintaining your own SMS gateway, Telnyx's Messaging API delivers low-latency, high-throughput notifications with global reach, so your team stays informed about backup health without polling dashboards or digging through logs.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/messages` | `POST` | Send SMS notification with backup summary (success/failure counts) via `telnyx_client.messages.send()` |

## Architecture

The Blob Store Backup Agent runs as a Flask application that periodically scans a local blob store directory, uploads each file to Google Cloud Storage, verifies the upload via checksum comparison, records the operation in a SQLite database, and sends an SMS summary via Telnyx.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Blob Store Backup Agent                     │
│                                                                     │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────┐  │
│  │   Blob Store │────▶│  Backup Engine   │────▶│  GCS Bucket    │  │
│  │  (Local Dir) │     │  (Flask App)     │     │  (Cloud)       │  │
│  └──────────────┘     └──────────────────┘     └────────────────┘  │
│                              │                                      │
│                              │                                      │
│                              ▼                                      │
│                    ┌──────────────────┐                            │
│                    │  SQLite Registry │                            │
│                    │  (backup log)    │                            │
│                    └──────────────────┘                            │
│                              │                                      │
│                              ▼                                      │
│                    ┌──────────────────┐                            │
│                    │  Telnyx SMS API  │                            │
│                    │  (notification)  │                            │
│                    └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Flow:**
1. **Scheduled Trigger** — A background thread runs `perform_backup()` every `BACKUP_INTERVAL_HOURS` hours (or on-demand via `POST /backup`).
2. **Scan & Upload** — The agent iterates over all files in `BLOB_STORE_PATH`, computes SHA-256 checksums, and uploads each file to the configured GCS bucket under `BACKUP_PREFIX`.
3. **Verification** — After upload, the agent reloads the remote blob and compares its MD5 hash against the local SHA-256 checksum to ensure integrity.
4. **Registry** — Successful backups are recorded in a SQLite database with blob name, backup path, checksum, and timestamp.
5. **Notification** — A summary SMS (success/failure counts) is sent via Telnyx to the configured phone number.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `BACKUP_BUCKET` | `string` | `your_backup_bucket_here` | **yes** | BACKUP_BUCKET | — |
| `BACKUP_INTERVAL_HOURS` | `string` | `your_backup_interval_hours_here` | **yes** | BACKUP_INTERVAL_HOURS | — |
| `BACKUP_PREFIX` | `string` | `your_backup_prefix_here` | **yes** | BACKUP_PREFIX | — |
| `BLOB_STORE_PATH` | `string` | `your_blob_store_path_here` | **yes** | BLOB_STORE_PATH | — |
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `ENABLE_SCHEDULED_BACKUP` | `string` | `your_enable_scheduled_backup_here` | **yes** | ENABLE_SCHEDULED_BACKUP | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `SMS_FROM` | `string` | `your_sms_from_here` | **yes** | SMS_FROM | — |
| `SMS_TO` | `string` | `your_sms_to_here` | **yes** | SMS_TO | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/blob-store-backup-agent
```

### 2. Create and configure your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```bash
TELNYX_API_KEY=your_telnyx_api_key_here
BACKUP_BUCKET=your_gcs_bucket_name
BACKUP_PREFIX=backups
BLOB_STORE_PATH=./blob_store
DB_PATH=backup_registry.db
BACKUP_INTERVAL_HOURS=24
ENABLE_SCHEDULED_BACKUP=true
SMS_FROM=+15551234567
SMS_TO=+15559876543
PORT=5000
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the application

```bash
python app.py
```

The server will start on `http://0.0.0.0:5000`. The scheduled backup thread will begin automatically (if `ENABLE_SCHEDULED_BACKUP=true`).

## API Reference

### `GET /health`

Health check endpoint.

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### `POST /backup`

Manually trigger a backup cycle.

**Response (200):**
```json
{
  "status": "success",
  "message": "Backup completed"
}
```

**Response (500):**
```json
{
  "status": "error",
  "message": "Backup failed"
}
```

### `GET /backups`

List all recorded backups from the SQLite registry.

**Response (200):**
```json
{
  "backups": [
    {
      "id": 1,
      "blob_name": "file1.txt",
      "backup_path": "backups/file1.txt",
      "checksum": "a3f5c2d8e1b9...",
      "created_at": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Response (500):**
```json
{
  "status": "error",
  "message": "Failed to list backups"
}
```

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| `Failed to send SMS notification` | Invalid `TELNYX_API_KEY`, `SMS_FROM`, or `SMS_TO` | Verify your Telnyx API key and phone numbers are correct and properly formatted (E.164 format for phone numbers) |
| `Checksum mismatch for {file}` | File changed during upload or GCS MD5 differs from local SHA-256 | Re-run the backup; ensure files are not being modified during the backup window |
| `Blob store path does not exist` | `BLOB_STORE_PATH` points to a non-existent directory | Create the directory or update `BLOB_STORE_PATH` to a valid location |
| `Backup disabled, skipping` | `ENABLE_SCHEDULED_BACKUP` is set to `false` | Set `ENABLE_SCHEDULED_BACKUP=true` to enable automatic backups |
| `Failed to list backups` | SQLite database is corrupted or inaccessible | Delete `DB_PATH` file and restart the app to recreate the registry |
| `ModuleNotFoundError: google.cloud` | Missing GCS client library | Run `pip install google-cloud-storage` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **SMS Notification Agent** — Send transactional SMS alerts for any system event
- **Webhook Receiver** — Handle inbound Telnyx webhooks with Ed25519 signature verification
- **Call Control Agent** — Build voice applications with Telnyx Call Control APIs

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com/)
- [Telnyx Messaging API Reference](https://developers.telnyx.com/api/messaging/send-message)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Messaging Product Page](https://telnyx.com/products/sms-messaging)
- [Telnyx Pricing](https://telnyx.com/pricing/messaging)
