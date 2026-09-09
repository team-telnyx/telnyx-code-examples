# API Reference

Geo-distributed call logging on Telnyx Edge: region detection from E.164,
per-region actor counters, and a global call registry.

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

### `POST /webhooks/voice`

Telnyx Call Control webhook entry point. Verifies the event, detects the
caller's region from the E.164 number (country-code prefix map), and records
the call into the region's `GeoLoggerAgent` actor and the global
`CallRegistry` actor.

**Response:** `200 OK` (Telnyx requires a 2xx; failures are logged to the actor state).

### `POST /simulate`

Simulate a call event without a real call — handy for demos and load tests.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | `string` | Yes | E.164 caller number (region is derived from it) |
| `to` | `string` | No | E.164 destination |
| `call_control_id` | `string` | No | Synthetic call control id |

### `GET /calls`

Recent calls across all regions (from the registry actor).

### `GET /regions`

List of tracked regions (e.g. `us-east-1`, `eu-west-1`, `ap-northeast-1`).

### `GET /regions/stats`

Per-region call counters — the geo distribution view.

### `GET /status/{call_control_id}`

Status of a single logged call's actor.

## Region detection

Country-code prefixes map to named regions (longest match wins, unknown →
`unknown`): `1 → us-east-1`, `44/33/31 → eu-west-1`, `49 → eu-central-1`,
`39/34 → eu-south-1`, `81/82 → ap-northeast-1`, `86 → ap-east-1`,
`91 → ap-south-1`, `61 → ap-southeast-1`, `55/52 → sa-east-1/us-east-1`.
Swap the table in `src/geoLogger.ts` for carrier lookup in production.

## Bindings & environment

| Binding / Variable | Type | Purpose |
|--------------------|------|---------|
| `GEO_LOGGER` | actor namespace | Per-region logger actors |
| `REGISTRY` | actor namespace | Global call registry |
| `TELNYX` | Telnyx binding | Call events / messaging |
| `REGION_KV` | KV namespace | Per-region counters |
| `ALERT_PHONE` / `SENDER_PHONE` | env vars | Ops SMS alerting |
| `REGION_THRESHOLD` / `WINDOW_SECONDS` | env vars | Alerting thresholds |

Set in `telnyx.toml`. See [README.md](./README.md) for deploy steps.
