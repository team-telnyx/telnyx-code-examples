# API Reference

Edge worker + `CacheAgent` StatefulActor for content cache invalidation with SMS ops alerting.

## Base URL

```
https://<your-function>.telnyxcompute.com
```

## HTTP Endpoints

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health/liveness` | GET | Returns `ok` when the worker is up |
| `/health/readiness` | GET | Returns `ok` when the worker can serve requests |

### `POST /invalidate`

Start a cache invalidation for a piece of content. Creates/updates the
`CacheAgent` actor for the content id and kicks off the pipeline
(invalidate → manifest update → SMS notification).

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content_id` | `string` | Yes | What changed (URL, asset path, etc.) |
| `content_version` | `string` | No | New version identifier |
| `locations` | `string[]` | No | Edge locations to invalidate |

**Response:** `200 OK` with the actor's initial status, or `400` when
`content_id` is missing.

### `GET /cache-clear/{content_id}`

Runs the invalidation stage for the content's actor (marks each requested
location dirty in KV).

**Response:** `200 OK` — current actor state snapshot.

### `GET /cache-status/{content_id}`

Status of the invalidation pipeline for this content.

**Response:** `200 OK`

```json
{
  "contentId": "assets/app.js",
  "status": "notifying",
  "invalidatedLocations": ["us-central-1", "eu-west-1"],
  "manifestUpdated": true,
  "smsSent": false,
  "error": ""
}
```

`status` moves through `pending → invalidating → updating_manifest → notifying → done` (or `error`).

### `GET /status/{content_id}`

Alias view of the actor state (same shape as `/cache-status`).

### `GET /locations`

Lists the edge locations known to the manifest in Cloud Storage.

**Response:** `200 OK` — location list from `cache-manifest.json`.

## Actor RPC surface

The `CacheAgent` actor (one per `content_id`) exposes public methods that the
worker calls through the `CACHE` actor namespace: `start`, `invalidate`,
`updateManifest`, `notify`, `getStatus`, `checkCacheStatus`, `clearCacheFlag`.

Pipeline stages are queued as separate actor turns (`this.queue(...)`) so slow
steps (Cloud Storage writes, SMS) never block the others.

## Bindings & environment

| Binding / Variable | Type | Purpose |
|--------------------|------|---------|
| `CACHE` | actor namespace | `CacheAgent` actors, one per content id |
| `TELNYX` | Telnyx binding | `messages.send` for the ops SMS alert |
| `CACHE_KV` | KV namespace | Per-location dirty flags + cache manifest |
| `CACHE_STORAGE` | Cloud Storage bucket | `cache-manifest.json` |
| `ALERT_PHONE` / `SENDER_PHONE` | env vars | SMS alert recipient / sender (E.164) |

Set in `telnyx.toml` (`[[actors]]`, `[storage.kv]`, `[storage.cloudstorage]`,
`[env_vars]`, `[[secrets]]`). See [README.md](./README.md) for deploy steps.
