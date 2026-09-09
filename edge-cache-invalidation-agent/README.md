# Edge Cache Invalidation Agent

Webhook-triggered cache invalidation across edge locations — mark caches dirty via KV, update a shared manifest in Cloud Storage, and notify ops via SMS. All orchestrated by the Agent SDK on Telnyx Edge Compute with zero-credential messaging.

## Why Telnyx

Telnyx is AI Communications Infrastructure that unifies edge compute, key-value storage, cloud storage, and messaging under one platform. For cache invalidation workflows, this means your agent can mark caches dirty in KV, update a manifest in Cloud Storage, and fire an SMS alert to ops — all without juggling separate providers or API keys. The zero-credential `[telnyx]` binding removes messaging auth overhead entirely, so the agent code stays focused on orchestration logic.

## Telnyx API Endpoints Used

- **KV (Key-Value Store)** — `this.env.CACHE_KV.put()` / `get()` / `delete()` — per-location cache invalidation flags
- **Cloud Storage** — `this.env.CACHE_STORAGE.put()` / `get()` — shared cache manifest (JSON)
- **Messaging** — `this.env.TELNYX.messages.send()` — SMS notification to ops (zero-credential binding)

## Architecture

```
Content update webhook → POST /invalidate
        │
        ▼
  ┌──────────────────────────────────────────┐
  │ CacheAgent.start()                        │
  │   → queue("invalidate")                   │
  │   → queue("updateManifest")               │
  │   → queue("notify")                        │
  └────────┬─────────────────────────────────┘
           │
           ▼
  Stage 1: invalidate()
    → KV.put("cache:{location}:{contentId}", { dirty: true, version })
    → for each edge location
           │
           ▼
  Stage 2: updateManifest()
    → CloudStorage.get("cache-manifest.json")
    → append invalidation entry
    → CloudStorage.put("cache-manifest.json", updated)
           │
           ▼
  Stage 3: notify()
    → this.env.TELNYX.messages.send({ from, to, text })
    → SMS: "Cache invalidated: {contentId} v{version} — N locations updated"
```

## Quickstart

### Prerequisites

- Node.js 18+
- Telnyx account with:
  - API key ([Portal → API Keys](https://portal.telnyx.com/#/app/api-keys))
  - A phone number with SMS enabled ([Portal → Number](https://portal.telnyx.com/#/app/numbers))
  - KV namespace ([Portal → Storage → KV](https://portal.telnyx.com/#/app/storage/kv))
  - Cloud Storage bucket ([Portal → Storage → Buckets](https://portal.telnyx.com/#/app/storage/buckets))
- `telnyx-edge` CLI installed

### Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-cache-invalidation-agent
npm install
```

### Configure secrets

```bash
telnyx-edge secret set TELNYX_API_KEY KEY0123456789ABCDEF
telnyx-edge secret set ALERT_PHONE +18005551234
telnyx-edge secret set SENDER_PHONE +18005551234
```

### Update `telnyx.toml`

Replace the placeholder values:

```toml
[storage.kv.CACHE_KV]
id = "your-kv-namespace-uuid"

[storage.cloudstorage.CACHE_STORAGE]
bucket_name = "your-bucket-name"
region = "us-central-1"
```

### Deploy

```bash
telnyx-edge ship
```

## API Reference

### `POST /invalidate`

Trigger a cache invalidation across edge locations.

**Request body:**

```json
{
  "content_id": "/blog/how-to-build-x",
  "content_version": "2026-08-19-v2",
  "locations": ["us-east-1", "us-west-1", "eu-central-1", "ap-southeast-1"]
}
```

**Response (200):**

```json
{
  "action": "queued",
  "agentId": "bloghowtobuildx-20260819v2-1724080800000",
  "contentId": "/blog/how-to-build-x",
  "contentVersion": "2026-08-19-v2",
  "locations": ["us-east-1", "us-west-1", "eu-central-1", "ap-southeast-1"],
  "statusUrl": "/status/bloghowtobuildx-20260819v2-1724080800000"
}
```

### `GET /status/:agentId`

Check the status of an invalidation pipeline.

**Response:**

```json
{
  "contentId": "/blog/how-to-build-x",
  "contentVersion": "2026-08-19-v2",
  "status": "done",
  "invalidatedLocations": ["us-east-1", "us-west-1", "eu-central-1", "ap-southeast-1"],
  "manifestUpdated": true,
  "smsSent": true,
  "createdAt": 1724080800000,
  "completedAt": 1724080805000
}
```

### `GET /cache-status/:location/:contentId`

Check if a specific location's cache is dirty for a content ID.

**Response:**

```json
{
  "location": "us-east-1",
  "contentId": "/blog/how-to-build-x",
  "dirty": true,
  "contentVersion": "2026-08-19-v2"
}
```

### `POST /cache-clear/:location/:contentId`

Clear the dirty flag for a location (simulates cache refresh).

**Response:**

```json
{
  "action": "cleared",
  "location": "us-east-1",
  "contentId": "/blog/how-to-build-x"
}
```

### `GET /locations`

List demo edge locations.

### `GET /health/liveness` / `GET /health/readiness`

Health check endpoints.

## How It Works

### The `[telnyx]` Binding — Zero-Credential Messaging

The `[telnyx]` binding in `telnyx.toml` injects a pre-authenticated Telnyx client into `this.env.TELNYX`. The SMS call in the `notify()` stage needs no API key, no Authorization header, no environment variable — the binding carries the auth:

```typescript
await this.env.TELNYX.messages.send({
  from: state.senderPhone,
  to: state.alertPhone,
  text: smsText,
});
```

Only `TELNYX_API_KEY` is needed as a secret (for KV and Cloud Storage, which use the API key directly). Messaging is zero-credential via the binding.

### Durable State Across Pipeline Stages

Each stage calls `this.setState()` to persist progress. If a stage fails and retries, it reads state from the previous stage instead of re-running:

```typescript
// Stage 1: invalidate
await this.setState({
  invalidatedLocations: invalidated,
  status: "updating_manifest",
});
await this.queue("updateManifest");

// Stage 2: updateManifest
await this.setState({
  manifestUpdated: true,
  status: "notifying",
});
await this.queue("notify");
```

If the `notify()` stage fails (e.g., SMS gateway temporarily down), the agent retries and reads the summary from state — it doesn't re-invalidate caches or re-update the manifest.

### KV-Based Cache Invalidation

Each edge location gets a KV key: `cache:{location}:{contentId}`. The value is a JSON object with `dirty: true`, the new `contentVersion`, and a timestamp. KV keys expire after 1 hour (TTL) — if a location hasn't refreshed its cache by then, the flag disappears and the location serves stale content until the next invalidation.

### Cloud Storage Manifest

The shared manifest (`cache-manifest.json`) in Cloud Storage is an append-only log of invalidation events. Each entry records what changed, the new version, which locations were invalidated, and when. This gives ops a durable audit trail across all invalidations.

## Use Cases

- **CDN cache busting** — content management system publishes a new page version, trigger invalidation across all edge locations
- **Multi-region app deployment** — new code deploy, invalidate static asset caches across regions
- **Emergency content removal** — take down outdated or incorrect content, force all edges to refresh immediately
- **A/B test rollout** — switch a percentage of traffic to a new variant, invalidate the old variant's cache

## Agent Discovery

This folder is self-contained for coding agents. Start with `README.md` for an overview, then the code file and `GUIDE.md` for implementation details.

- **Sign up**: [telnyx.com/sign-up](https://telnyx.com/sign-up)
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **LLM-friendly docs**: [developers.telnyx.com/llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [llms.txt](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI** (human + agent): [developers.telnyx.com/docs/development/cli](https://developers.telnyx.com/docs/development/cli)

## Production Notes

- This sample uses in-memory actor state. Production should add persistent storage for crash recovery.
- The manifest is append-only. Production should rotate or partition it by date to avoid unbounded growth.
- KV TTL is 1 hour. Adjust based on your cache refresh window.
- Add authentication to the `/invalidate` endpoint before exposing it publicly.
- Consider batching invalidations if you have many content IDs changing at once.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Stuck in `invalidating` | KV binding misconfigured | Check `[storage.kv.CACHE_KV]` id in `telnyx.toml` |
| No SMS, status `error` | ALERT_PHONE/SENDER_PHONE not set | Add them to `[env_vars]`, redeploy |
| Deploy rejects telnyx.toml | `func_id` placeholder | Run `telnyx-edge new-func`, copy bindings into the generated config |

## Related Examples

- [Persistent State Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — Durable StatefulActor on Edge with the same zero-credential inference binding
- [Collaborative Doc with AI Copilot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/collaborative-doc-ai-copilot/README.md) — Multiplayer StatefulActor with an AI copilot on Edge
- [Multi-Model Inference Switcher](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-model-inference-switcher/README.md) — Route inference across models on Edge
