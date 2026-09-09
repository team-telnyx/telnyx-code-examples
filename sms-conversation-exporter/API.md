# API Reference

SMS conversation exporter on Telnyx Edge: chunked export of message history
to Cloud Storage with a shareable URL and completion SMS.

## Base URL

```
https://<your-function>.telnyxcompute.com
```

## HTTP Endpoints

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health/liveness` | GET | Worker is up |
| `/health/readiness` | GET | Worker can serve requests |

### `POST /webhooks/messaging`

Telnyx messaging webhook (inbound SMS). Verifies the Ed25519 signature and
stores messages into actor-local SQL/KV so they can be exported later.

**Response:** `200 OK` (required by Telnyx).

### `GET /messages`

List stored messages. Optional filter by conversation partner.

### `GET /messages/count`

Total stored message count (what an export would contain).

### `POST /export`

Start an export job. Creates an `ExportAgent` actor that walks the pipeline:
`pending → counting → exporting → uploading → notifying → done`.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filter` | `string` | No | Phone number to export only that conversation (omit = all) |

**Response:** `200 OK` with the export id and initial state.

### `GET /export/{export_id}`

Export progress:

```json
{
  "exportId": "…",
  "status": "uploading",
  "totalMessages": 1284,
  "exportedMessages": 900,
  "chunkIndex": 2,
  "totalChunks": 3,
  "exportUrl": ""
}
```

`exportUrl` is populated when the job reaches `done` (Cloud Storage object).

### `POST /seed`

Seed demo messages (local/dev convenience).

### `POST /simulate-bulk`

Insert a bulk of synthetic messages to exercise chunked export.

## Actor & bindings

One `ExportAgent` actor per export id. Chunks are written to the
`EXPORT_STORAGE` bucket; progress is durable actor state; a completion SMS
goes out via the `TELNYX` binding.

| Binding / Variable | Type | Purpose |
|--------------------|------|---------|
| `EXPORT_AGENT` | actor namespace | One actor per export |
| `TELNYX` | Telnyx binding | Inbound SMS ingestion + completion SMS |
| `EXPORT_KV` | KV namespace | Export bookkeeping |
| `EXPORT_STORAGE` | Cloud Storage bucket | Export chunk objects |
| `ALERT_PHONE` / `SENDER_PHONE` / `CHUNK_SIZE` | env vars | Alerting + chunk size (default `500`) |

Set in `telnyx.toml`. See [README.md](./README.md) for deploy steps.
