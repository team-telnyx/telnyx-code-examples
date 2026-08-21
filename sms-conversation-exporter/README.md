# SMS Conversation Exporter

Export SMS conversation history from Edge SQL to Cloud Storage as chunked JSON files, with completion SMS notification via zero-credential messaging — all on Telnyx Edge Compute with the Agent SDK.

## Architecture

```
                    POST /export
                         │
                         ▼
              ┌────────────────────┐
              │   index.ts         │
              │   (HTTP router)    │
              └────┬───────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  ExportAgent         │  (one actor per export job)
         │                      │
         │  1. countMessages()  │──► SQL DB: SELECT COUNT(*)
         │  2. exportChunk()    │──► SQL DB: SELECT chunk
         │                      │──► Cloud Storage: PUT JSON chunk
         │     (re-queues       │    (repeats until all chunks done)
         │      until done)     │
         │  3. writeManifest()  │──► Cloud Storage: PUT manifest.json
         │  4. notifyComplete() │──► SMS via [telnyx] binding
         └──────────────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  Cloud Storage       │
         │  exports/{id}/       │
         │  ├── chunk-0000.json │
         │  ├── chunk-0001.json │
         │  └── manifest.json   │
         └──────────────────────┘
```

### What this sample demonstrates

| Feature | How |
|---|---|
| **Agent SDK pipeline** | 4-stage queue: `countMessages → exportChunk → writeManifest → notifyComplete` (non-blocking, self-requeuing) |
| **Chunked export** | Large datasets split into configurable chunks (`CHUNK_SIZE` messages per chunk) |
| **SQL DB** | Per-actor SQL stores SMS messages via `ctx.storage.sql` |
| **Cloud Storage** | JSON chunks + manifest uploaded to S3-compatible Telnyx Storage |
| **SMS webhook ingestion** | `POST /webhooks/messaging` ingests inbound/outbound SMS into SQL |
| **SMS notification** | Zero-credential `[telnyx]` messaging binding — no API key in code |
| **Large dataset support** | Handles 10k+ messages via chunked, non-blocking export |

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Telnyx CLI](https://developers.telnyx.com/docs/develop/edge-compute/getting-started) (`npm i -g @telnyx/cli`)
- A Telnyx account with:
  - An API key
  - A messaging-enabled number (for SMS notifications)
  - A Cloud Storage bucket (for JSON exports)

### 1. Install dependencies

```bash
cd sms-conversation-exporter
npm install
```

### 2. Configure environment

Edit `telnyx.toml` and replace the placeholder values:

```toml
[storage.kv.EXPORT_KV]
id = "<your-kv-namespace-uuid>"

[storage.cloudstorage.EXPORT_STORAGE]
bucket_name = "<your-storage-bucket-name>"
region = "us-central-1"

[env_vars]
ALERT_PHONE = "+18005559876"   # your phone (receives completion SMS)
SENDER_PHONE = "+18005551234"  # your Telnyx number (sends SMS)
CHUNK_SIZE = "500"             # messages per chunk
```

### 3. Set your API key

```bash
telnyx-edge secret set TELNYX_API_KEY KEY0123456789ABCDEF
```

### 4. Deploy

```bash
telnyx-edge ship
```

### 5. Test the export pipeline

```bash
# Check health
curl https://your-deployment.telnyxcompute.com/health/liveness

# Start an export (all conversations)
curl -X POST https://your-deployment.telnyxcompute.com/export

# Start an export (filtered by phone number)
curl -X POST https://your-deployment.telnyxcompute.com/export \
  -H "Content-Type: application/json" \
  -d '{"conversationFilter": "+18005559876"}'

# Check export progress
curl https://your-deployment.telnyxcompute.com/export/{exportId}

# List all messages in the SQL DB
curl https://your-deployment.telnyxcompute.com/messages

# Get message count
curl https://your-deployment.telnyxcompute.com/messages/count
```

### 6. Simulate a large dataset (10k+ messages)

```bash
# Bulk insert 10,000 test messages
curl -X POST https://your-deployment.telnyxcompute.com/simulate-bulk \
  -H "Content-Type: application/json" \
  -d '{"count": 10000}'

# Then start the export — watch it chunk through
curl -X POST https://your-deployment.telnyxcompute.com/export

# Poll the status
curl https://your-deployment.telnyxcompute.com/export/{exportId}
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/messaging` | Messaging webhook receiver (ingests SMS into SQL DB) |
| `POST` | `/export` | Start a chunked export job (optional `conversationFilter` in body) |
| `GET` | `/export/:exportId` | Get export status and progress |
| `GET` | `/messages` | List messages in the SQL DB (latest first) |
| `GET` | `/messages/count` | Get total message count |
| `POST` | `/seed` | Add a single test message (`from`, `to`, `body`, `direction`) |
| `POST` | `/simulate-bulk` | Bulk insert test messages (`count` in body, default 10,000) |
| `GET` | `/health/liveness` | Liveness probe |
| `GET` | `/health/readiness` | Readiness probe |

## How it works

### Agent SDK pipeline

Each export job gets its own `ExportAgent` actor instance. When `POST /export` is called, the agent queues a 4-stage pipeline:

1. **`countMessages()`** — Counts total messages matching the filter (or all messages if no filter). Calculates the number of chunks.

2. **`exportChunk()`** — Selects a chunk of messages from SQL, wraps them in a JSON object with metadata (`exportId`, `chunkIndex`, `totalChunks`), and uploads to Cloud Storage. **Re-queues itself** until all chunks are done.

3. **`writeManifest()`** — Writes a `manifest.json` to Cloud Storage listing all chunk files and the total message count.

4. **`notifyComplete()`** — Sends an SMS via the zero-credential `[telnyx]` binding with the export summary (message count, chunk count, manifest path).

### Why actors?

Each export job is isolated in its own actor with its own SQL DB instance. This means:
- Multiple concurrent exports don't contend with each other
- Export state survives HTTP request timeouts (the pipeline is non-blocking)
- The shared actor (`idFromName("shared")`) holds the SQL DB for message ingestion

### Chunked export

Messages are exported in chunks of `CHUNK_SIZE` (default: 500). Each chunk is a separate JSON file in Cloud Storage:

```
exports/export-1234567890-abc123/
├── chunk-0000.json    (messages 0–499)
├── chunk-0001.json    (messages 500–999)
├── chunk-0002.json    (messages 1000–1499)
├── ...
└── manifest.json      (metadata: total count, chunk list, timestamps)
```

Each chunk JSON file contains:

```json
{
  "exportId": "export-1234567890-abc123",
  "chunkIndex": 0,
  "totalChunks": 20,
  "totalMessages": 10000,
  "chunkSize": 500,
  "messages": [
    { "id": 1, "from_number": "+18005551234", "to_number": "+18005559876", "body": "...", "direction": "outbound", "timestamp": 1718928000000, "status": "delivered" },
    ...
  ],
  "exportedAt": 1718928001000
}
```

### Zero-credential messaging

The completion SMS is sent via `this.env.TELNYX.messages.send()` — the `[telnyx]` binding. No API key is needed in code. The binding is declared in `telnyx.toml` and authenticated by the Edge Compute platform.

## File structure

```
sms-conversation-exporter/
├── src/
│   ├── exportAgent.ts   # ExportAgent actor (count → chunk → manifest → notify)
│   └── index.ts         # HTTP routes + webhook handler
├── telnyx.toml          # Edge Compute config (KV, Cloud Storage, actors, env vars)
├── package.json
├── tsconfig.json
├── telnyx-env.d.ts      # Ambient type declarations (KvNamespace)
└── .gitignore
```

## Use cases

- **Compliance archival** — Export SMS conversation history for regulatory compliance
- **Data migration** — Move SMS data from Edge SQL to a data warehouse via Cloud Storage
- **Backup** — Periodic JSON exports of all conversations to Cloud Storage
- **Analytics** — Export conversation data for offline analysis in Spark, BigQuery, or similar

## License

MIT
