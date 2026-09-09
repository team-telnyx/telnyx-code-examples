# API Reference

KV-backed distributed rate limiter on Telnyx Edge: fixed-window counters in
KV, durable per-key rate-limit actors, and SMS alerts when rejections spike.

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

### `POST /check`

Check a key against its rate limit. This is the main decision endpoint — call
it from any service that needs gating.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Rate-limit key (user id, API token, IP…) |
| `limit` | `number` | No | Override the default limit for this check |

**Response:** `200 OK`

```json
{
  "key": "user_123",
  "allowed": true,
  "currentCount": 7,
  "limit": 10,
  "windowSeconds": 60,
  "remaining": 3
}
```

### `POST /simulate`

Simulate a burst of requests for a key (demo/load testing).

### `GET /keys`

List tracked rate-limit keys with their current counts.

### `GET /count/{key}`

Current window count for one key.

### `POST /reset/{key}`

Reset a key's window and counters.

### `GET /status/{key}`

Full actor state for a key: status
(`checking → allowed | rejected → alerting → done`), counts, rejection count,
alert state.

### `GET /config`

Effective limits: `RATE_LIMIT`, `WINDOW_SECONDS`, `ALERT_THRESHOLD`.

## Actor RPC surface

Two actors: `RateLimitAgent` (one per key — durable counters, fixed-window
decision, SMS alert after `ALERT_THRESHOLD` rejections) and
`RateLimitRegistry` (cross-key bookkeeping). The window counter lives in KV
(`RATE_KV`) so it survives actor eviction.

## Bindings & environment

| Binding / Variable | Type | Purpose |
|--------------------|------|---------|
| `RATE_AGENT` / `REGISTRY` | actor namespaces | Per-key actors + registry |
| `TELNYX` | Telnyx binding | SMS alert on rejection spikes |
| `RATE_KV` | KV namespace | Window counters |
| `RATE_LIMIT` / `WINDOW_SECONDS` | env vars | Defaults: `10` requests / `60` seconds |
| `ALERT_PHONE` / `SENDER_PHONE` / `ALERT_THRESHOLD` | env vars | Ops SMS alerting |

Set in `telnyx.toml`. See [README.md](./README.md) for deploy steps.
