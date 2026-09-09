# Guide — Edge Cache Invalidation Agent

A content cache invalidation pipeline on Telnyx Edge Compute: when content
changes, a `CacheAgent` StatefulActor invalidates each edge location's KV
cache entry, updates the cache manifest in Cloud Storage, and texts your ops
line over the `TELNYX` binding.

## What you'll build

- `POST /invalidate` fan-out: one durable actor per content id
- Per-location KV dirty flags + a `cache-manifest.json` in Cloud Storage
- SMS alert to ops when the pipeline completes (or fails)
- Status endpoints to watch the pipeline move through
  `pending → invalidating → updating_manifest → notifying → done`

## How it works

```
POST /invalidate {content_id, locations}
  → env.CACHE.idFromName(actorName(content_id))
  → CacheAgent.start()
      queue(invalidate)      — KV dirty flags per location
      queue(updateManifest)  — cache-manifest.json in Cloud Storage
      queue(notify)          — this.env.TELNYX.messages.send(...) to ops
```

Each stage runs as its own actor turn (`this.queue(...)`), so a slow Cloud
Storage write or SMS send never blocks the others. State survives restarts —
the actor's `status` field is durable, and every stage is idempotent.

Dapr-safe actor names: the worker sanitizes content ids to
RFC 1123 job-name-safe strings before `idFromName`.

## Run

```bash
npm install
npm run local:dev     # if the package defines it, else deploy directly
```

Local development needs provisioned KV/Storage bindings — for a quick loop,
deploy to a dev function first (below), then iterate.

## Deploy

```bash
telnyx-edge new-func --actor --name=edge-cache-invalidation-agent
# merge this folder's telnyx.toml bindings into the generated config,
# then fill in the KV namespace id, storage bucket, and func_id
telnyx-edge types
telnyx-edge ship
```

Provision the storage pieces (ids go into `telnyx.toml`):

```bash
telnyx-edge storage kv create --name cache-kv
telnyx-edge storage bucket create --name cache-manifests --region us-central-1
```

## Try it

```bash
curl -X POST https://<your-function>.telnyxcompute.com/invalidate \
  -H "Content-Type: application/json" \
  -d '{"content_id": "assets/app.js", "locations": ["us-central-1", "eu-west-1"]}'

# watch the pipeline
curl https://<your-function>.telnyxcompute.com/cache-status/assets/app.js
```

When the pipeline reaches `done`, the ops phone (`ALERT_PHONE`) has an SMS
summary sent from `SENDER_PHONE` via the `TELNYX` binding.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `400` on `/invalidate` | Missing `content_id` | Include it in the body |
| Stuck in `invalidating` | KV binding misconfigured | Check `[storage.kv.CACHE_KV]` id in `telnyx.toml` |
| No SMS, status `error` | `ALERT_PHONE`/`SENDER_PHONE` not set | Add them to `[env_vars]`, redeploy |
| Actor name rejected | Special chars in `content_id` | Ids are sanitized to RFC 1123-safe names automatically |

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api)
- [Telnyx pricing](https://telnyx.com/pricing)
