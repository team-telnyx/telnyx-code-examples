# Guide — SMS Conversation Exporter

Export your stored SMS conversations to Cloud Storage in chunks, with live
progress and a completion text. Built on a durable `ExportAgent` actor so an
export survives restarts and continues where it left off.

## What you'll build

- Message ingestion via the Telnyx messaging webhook (signature-verified)
- Chunked export pipeline: `counting → exporting → uploading → notifying`
- Progress tracking per export (`exportedMessages`, `chunkIndex`, `totalChunks`)
- A shareable `exportUrl` when the job finishes + completion SMS

## How it works

```
POST /export {filter?}
  → env.EXPORT_AGENT.idFromName(exportId).start()
      queue(counting)   — total messages (optionally filtered by number)
      queue(exporting)  — slice into CHUNK_SIZE chunks
      queue(uploading)  — write chunks to EXPORT_STORAGE
      queue(notifying)  — SMS the download location via TELNYX
```

Each stage is a queued actor turn; state is durable, so a failed chunk can be
retried without restarting the export.

## Run

```bash
npm install
npm run local:dev
```

## Deploy

```bash
telnyx-edge new-func --actor --name=sms-conversation-exporter
# merge telnyx.toml bindings (EXPORT_AGENT actor, EXPORT_KV, EXPORT_STORAGE, func_id)
telnyx-edge types
telnyx-edge ship
```

Point a messaging profile webhook at `https://<your-function>.telnyxcompute.com/webhooks/messaging`.

## Try it

```bash
# seed some traffic, then export everything
curl -X POST https://<your-function>.telnyxcompute.com/seed
curl -X POST https://<your-function>.telnyxcompute.com/export \
  -H "Content-Type: application/json" -d '{}'

# watch progress
curl https://<your-function>.telnyxcompute.com/export/<export_id>

# or export one conversation only
curl -X POST https://<your-function>.telnyxcompute.com/export \
  -H "Content-Type: application/json" \
  -d '{"filter": "+14155550100"}'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `messages/count` is 0 | Webhook not receiving | Check messaging profile webhook URL + `TELNYX_PUBLIC_KEY` secret |
| Export stuck in `uploading` | Storage binding misconfigured | Check `[storage.cloudstorage.EXPORT_STORAGE]` bucket in `telnyx.toml` |
| Huge exports time out | Chunk size too large | Lower `CHUNK_SIZE` in `[env_vars]` |

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api)
- [Telnyx pricing](https://telnyx.com/pricing)
