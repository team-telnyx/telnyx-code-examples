# BlobStore Backup Agent — Developer Guide

This guide walks you through the `blob-store-backup-agent` sample: a Telnyx Edge agent that backs up BlobStore data to Cloud Storage on a 24-hour schedule, verifies checksums, logs each backup to a SQL registry, and sends an SMS notification when complete.

---

## Prerequisites

- Node.js 18+
- A Telnyx account with an API key ([sign up](https://portal.telnyx.com/sign-up))
- Telnyx Edge CLI installed (`npm i -g @telnyx/edge-cli`)
- A phone number in E.164 format (for live SMS mode)

---

## Environment Setup

1. Clone the repo and navigate to the sample directory:

   ```bash
   cd blob-store-backup-agent
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the example env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   ```env
   TELNYX_API_KEY=your_telnyx_api_key_here
   BACKUP_RECIPIENT_PHONE=+1555XXXXXXXX
   DEMO_MODE=true
   ```

   - `TELNYX_API_KEY` — your Telnyx API key (never commit real keys).
   - `BACKUP_RECIPIENT_PHONE` — the phone number that will receive SMS notifications (demo mode logs instead of sending).
   - `DEMO_MODE` — when `true`, no real SMS is sent; the agent logs what it would do.

---

## Running the Agent

### Demo Mode (default)

```bash
npm start
```

The agent starts, schedules a backup every 24 hours, and on each run:

1. Lists all blobs from `this.blobs`.
2. Reads each blob from BlobStore.
3. Uploads it to Cloud Storage.
4. Logs the backup entry to the SQL registry.
5. Verifies the checksum of the uploaded data.
6. Sends an SMS notification (logged in demo mode, sent for real in live mode).

In demo mode, SMS sends are replaced with `console.log` output like:

```
[DEMO] SMS would be sent to +1555XXXXXXXX: "Backup complete: 3 blobs backed up and verified."
```

### Live Mode

Set `DEMO_MODE=false` in `.env` and restart:

```bash
DEMO_MODE=false npm start
```

In live mode, the agent uses `this.env.TELNYX.messages.send()` to send a real SMS via the Telnyx API. Charges will apply.

---

## How It Works — Step by Step

### 1. The Agent Class

The core of the sample is the `BackupAgent` class, which extends `Agent` from the Telnyx Edge SDK:

```typescript
class BackupAgent extends Agent {
  async schedule() { ... }
}
```

The `schedule()` method is called automatically by the Edge runtime. It registers a recurring task that runs every 24 hours using `this.schedule('24h', ...)`.

### 2. BlobStore → Cloud Storage Pipeline

Inside the scheduled task, the agent:

- Calls `this.blobs.list()` to enumerate all source blobs.
- For each blob, calls `this.blobs.read(blob.name)` to retrieve its contents.
- Uploads the data to Cloud Storage using `this.cloudStorage.put(blob.name, data)`.

This forms the core backup pipeline: **BlobStore → Cloud Storage**.

### 3. SQL Backup Registry

After each upload, the agent records metadata in a SQL database:

```sql
INSERT INTO backups (id, timestamp, size, verified) VALUES (?, ?, ?, ?)
```

The `backups` table schema is:

| Column     | Type    | Description                          |
|------------|---------|--------------------------------------|
| `id`       | string  | Unique backup identifier             |
| `timestamp`| number  | Unix timestamp of the backup         |
| `size`     | number  | Size of the backed-up blob in bytes  |
| `verified` | boolean | Whether the checksum matched         |

The SQL registry is accessed via `this.sql.query(...)`, which is a Telnyx Edge primitive for durable, managed SQL storage.

### 4. Checksum Verification

After uploading, the agent computes a checksum of the original blob data and compares it against the checksum of the data retrieved from Cloud Storage:

```typescript
const originalChecksum = sha256(data);
const storedData = await this.cloudStorage.get(blob.name);
const storedChecksum = sha256(storedData);
const verified = originalChecksum === storedChecksum;
```

The `verified` boolean is written to the SQL registry.

### 5. SMS Notification

Once all blobs are processed, the agent sends an SMS summary:

- **Demo mode**: Logs the message that would be sent.
- **Live mode**: Calls `this.env.TELNYX.messages.send()` with the recipient phone number and message body.

```typescript
if (this.env.DEMO_MODE === 'true') {
  console.log(`[DEMO] SMS would be sent to ${recipient}: "${message}"`);
} else {
  await this.env.TELNYX.messages.send({
    from: this.env.TELNYX_PHONE_NUMBER,
    to: recipient,
    text: message,
  });
}
```

---

## Telnyx Primitives Used

| Primitive         | How It's Used                                      |
|-------------------|----------------------------------------------------|
| **Agent SDK**     | `BackupAgent extends Agent` with `schedule()`      |
| **BlobStore**     | `this.blobs` — source data for backups             |
| **Cloud Storage** | `this.cloudStorage` — durable backup destination   |
| **SQL DB**        | `this.sql` — backup registry (`backups` table)     |
| **SMS**           | `this.env.TELNYX.messages.send()` — notifications  |

---

## Smoke Test

A smoke test is included to verify the agent loads without error:

```bash
npx tsx smoke_test.ts
```

This imports the `BackupAgent` class and instantiates it, confirming all dependencies resolve correctly.

---

## Next Steps

- **Telnyx Edge SDK Reference**: https://docs.telnyx.com/edge-sdk
- **BlobStore Documentation**: https://docs.telnyx.com/edge/blobstore
- **Cloud Storage Documentation**: https://docs.telnyx.com/edge/cloud-storage
- **SQL Primitive Documentation**: https://docs.telnyx.com/edge/sql
- **SMS API Documentation**: https://developers.telnyx.com/docs/sms
- **Agent SDK Guide**: https://docs.telnyx.com/edge/agents
- **Scheduling Tasks**: https://docs.telnyx.com/edge/scheduling
- **Related Examples**: See `../call-control-agent`, `../kv-backup-agent`, `../sms-notifier-agent`
