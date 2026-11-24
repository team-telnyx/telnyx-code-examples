# API Reference — dial-odometer

HTTP contract for the `dial-odometer` edge sample. Every route is served by the default export in `src/index.ts`; each campaign-scoped route resolves a durable `DialOdometer` actor via `env.ODOMETER.idFromName(campaign)` and forwards to its RPC surface.

- **Base URL (local):** `http://localhost:8787`
- **Base URL (deployed):** `https://<your-actor-host>`
- **Content type:** `application/json` for all request and response bodies
- **Authentication:** none on the sample's own routes. The Telnyx API key is read server-side from `env.SECRETS` at call time and is never accepted from or returned to a client.

## Route overview

| Method | Path | Purpose | Success |
|---|---|---|---|
| `POST` | `/odometer` | Arm (create or re-attach) the odometer actor for a campaign | `202` |
| `GET` | `/odometer/{campaign}/status` | Read the one-screen rate history | `200` |
| `POST` | `/odometer/{campaign}/poll` | Force an immediate poll, then return status | `200` |

---

## POST /odometer

Arms the campaign's odometer. Resolves `env.ODOMETER.idFromName(campaign)`, calls `arm(campaign)` on the actor, and starts (or re-upserts) the 60-second poll schedule. Idempotent: calling it again for the same campaign returns the existing actor state rather than creating a second entity.

### Path parameters

None.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `campaign` | `string` | **yes** | Campaign identifier. Must match `^[a-z0-9][a-z0-9-]{1,63}$` — 2–64 characters, lowercase letters, digits and hyphens, starting with a letter or digit. This string is the actor name, so it is also the durable identity of the rate history. |

### Example request

```bash
curl -sS -X POST http://localhost:8787/odometer \
  -H 'content-type: application/json' \
  -d '{"campaign":"spring-reminders"}'
```

### Response — `202 Accepted`

```json
{
  "campaign": "spring-reminders",
  "armed": true,
  "state": {
    "campaign": "spring-reminders",
    "streak": 0,
    "throttling": false,
    "lastDps": 0
  }
}
```

| Field | Type | Description |
|---|---|---|
| `campaign` | `string` | Echo of the validated campaign name. |
| `armed` | `boolean` | Always `true` on a successful arm. |
| `state` | `OdometerState` | Current durable actor state (see [OdometerState](#odometerstate)). |

### Errors

| Status | Condition | Body |
|---|---|---|
| `400` | Body is not JSON, `campaign` is missing/not a string, or fails the pattern | `{"error":"campaign must be 2-64 chars of lowercase letters, digits or hyphens"}` |
| `405` | Method is not `POST` | `{"error":"method not allowed"}` |
| `500` | Actor resolution or `arm()` threw | `{"error":"internal error"}` |

---

## GET /odometer/{campaign}/status

Returns the `@rpc status()` screen for the campaign: current throttle flag, the consecutive-minute streak, the last observed DPS, and the persisted reading history from `dps_readings`. This is the surface a campaign operator reads before deciding whether to keep dialing.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `campaign` | `string` | **yes** | Campaign identifier, same pattern as above. Must already be armed; an unknown campaign resolves to a fresh actor with an empty history. |

### Example request

```bash
curl -sS http://localhost:8787/odometer/spring-reminders/status
```

### Response — `200 OK`

```json
{
  "campaign": "spring-reminders",
  "throttling": true,
  "streak": 2,
  "lastDps": 0.83,
  "warnPct": 80,
  "message": "spring-reminders: slow to ≤0.8 dps until further notice.",
  "readings": [
    {
      "region": "us-east",
      "bucketStart": "2026-07-28T09:02:00Z",
      "dialsTotal": 42,
      "averageDps": 0.83,
      "peakDps": 0.91,
      "dpsLimit": 1.0,
      "recordedAt": "2026-07-28T09:02:19Z"
    },
    {
      "region": "__gap__",
      "bucketStart": "2026-07-28T09:06:00Z",
      "dialsTotal": null,
      "averageDps": null,
      "peakDps": null,
      "dpsLimit": null,
      "recordedAt": "2026-07-28T09:06:24Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `campaign` | `string` | Campaign the screen belongs to. |
| `throttling` | `boolean` | `true` once live DPS has been ≥ `WARN_PCT` of the limit for two consecutive polls; cleared after two consecutive polls below it. |
| `streak` | `number` | Signed consecutive-minute counter. Positive counts minutes above the warn threshold, negative counts minutes below it. |
| `lastDps` | `number` | Live DPS from the most recent successful poll — the hottest region's `average_dps` in the newest bucket. |
| `warnPct` | `number` | The configured `WARN_PCT` (default `80`). |
| `message` | `string` | Human-readable one-liner for the team; carries the throttle instruction when `throttling` is `true`. |
| `readings` | `ReadingView[]` | Persisted rows, newest bucket first. Gap rows appear with `region: "__gap__"` and `null` metrics — a marked minute, never a fabricated reading. |

### ReadingView

Mirrors the `dps_readings` row exactly.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `region` | `string` | no | Telnyx region for the bucket, or `__gap__` for a marked outage minute. |
| `bucketStart` | `string` (RFC 3339) | no | Start of the second-granularity bucket. |
| `dialsTotal` | `number` | yes | `dials.total` for the bucket. `null` on gap rows. |
| `averageDps` | `number` | yes | `average_dps` for the bucket. `null` on gap rows. |
| `peakDps` | `number` | yes | `peak_dps` for the bucket. `null` on gap rows. |
| `dpsLimit` | `number` | yes | Account `dps_limit` in effect for the bucket. `null` on gap rows. |
| `recordedAt` | `string` (RFC 3339) | no | When the actor wrote the row. |

### Errors

| Status | Condition | Body |
|---|---|---|
| `405` | Method is not `GET` | `{"error":"method not allowed"}` |
| `500` | Actor resolution or `status()` threw | `{"error":"internal error"}` |

---

## POST /odometer/{campaign}/poll

Forces an out-of-band poll instead of waiting for the 60-second `schedule()`. Calls `onPoll()` on the actor — which issues the `GET /v2/dial_metrics` query, files one row per region into `dps_readings`, and advances the streak logic — then returns the refreshed status screen. Useful for driving the demo arc minute-by-minute without waiting on wall-clock time.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `campaign` | `string` | **yes** | Campaign identifier, same pattern as above. |

### Request body

None. Any body is ignored.

### Example request

```bash
curl -sS -X POST http://localhost:8787/odometer/spring-reminders/poll
```

### Response — `200 OK`

Identical shape to [`GET /odometer/{campaign}/status`](#get-odometercampaignstatus) — the post-poll `StatusScreen`.

### Errors

| Status | Condition | Body |
|---|---|---|
| `405` | Method is not `POST` | `{"error":"method not allowed"}` |
| `500` | Actor resolution or `onPoll()` threw | `{"error":"internal error"}` |

> A Telnyx API failure during the poll is **not** an HTTP error. The actor retries with bounded backoff (2 s, 4 s, 8 s) and, if all attempts fail, writes a `__gap__` row for that minute. The route still returns `200` with the gap visible in `readings`.

---

## Status codes

| Code | Meaning | When |
|---|---|---|
| `200` | OK | `GET .../status` and `POST .../poll` succeeded. |
| `202` | Accepted | `POST /odometer` armed the actor and the poll schedule is registered. |
| `400` | Bad Request | `POST /odometer` body missing, not JSON, or `campaign` failed `^[a-z0-9][a-z0-9-]{1,63}$`. |
| `404` | Not Found | Path did not match any route. Body: `{"error":"not found"}`. |
| `405` | Method Not Allowed | Route matched but the HTTP verb was wrong. Body: `{"error":"method not allowed"}`. |
| `500` | Internal Server Error | Unhandled failure in actor resolution or an RPC call. The detail is logged server-side only; the client receives `{"error":"internal error"}`. |

---

## Actor RPC surface

The HTTP routes are thin wrappers. The durable contract lives on the `DialOdometer` actor and is reachable directly through a stub (`env.ODOMETER.idFromName(campaign)`):

| Method | Signature | Description |
|---|---|---|
| `arm` | `arm(campaign: string): Promise<OdometerState>` | Initialize state if absent and register the upsert-stable poll timer (`id: "poll:" + campaign`). Returns current state. |
| `onPoll` | `onPoll(): Promise<void>` | Query dial metrics, dedupe-write one row per region, advance streak / throttle / gap logic. |
| `status` | `status(): Promise<StatusScreen>` | Read-only projection of state plus the `dps_readings` history. |

### OdometerState

| Field | Type | Description |
|---|---|---|
| `campaign` | `string` | Durable campaign identity. |
| `streak` | `number` | Signed consecutive-minute counter driving the throttle flip. |
| `throttling` | `boolean` | Whether the campaign is currently flagged to slow down. |
| `lastDps` | `number` | Live DPS from the last successful poll. |

---

## Upstream Telnyx API consumed

The actor is a client of one Telnyx endpoint. Documented here because its parameters and lag semantics are part of this sample's contract.

### `GET /v2/dial_metrics`

```bash
curl -sS -G https://api.telnyx.com/v2/dial_metrics \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  --data-urlencode 'granularity=second' \
  --data-urlencode 'sort=-start_time' \
  --data-urlencode 'start_time=2026-07-28T09:00:00Z' \
  --data-urlencode 'end_time=2026-07-28T09:02:00Z'
```

| Query param | Type | Required | Description |
|---|---|---|---|
| `granularity` | `string` | **yes** | Fixed to `second` — the finest bucket the API publishes. |
| `sort` | `string` | **yes** | `-start_time` so the newest bucket is first; the actor reads the newest record per region. |
| `start_time` | `string` (RFC 3339) | **yes** | Window start — the actor uses `now - 2 minutes` to absorb bucket lag. |
| `end_time` | `string` (RFC 3339) | **yes** | Window end — `now`. |

Response fields read by the actor: `region`, `dials.total`, `average_dps`, `peak_dps`, `dps_limit`.

**Lag contract.** A bucket appears roughly 15–20 seconds after its window closes. The actor therefore polls on a 60-second cadence against a trailing 2-minute window, and treats a region with no record in the window as `0 dps` — a quiet region never raises a false alarm.

**Failure contract.** `429` and `5xx` responses trigger bounded backoff at 2 s, 4 s, 8 s. If every attempt fails, the minute is recorded as a `__gap__` row with `NULL` metrics. No reading is ever invented.

---

## Persistence contract

Readings land in the `ODOMETER_DB` SQL binding, table `dps_readings`:

```sql
CREATE TABLE IF NOT EXISTS dps_readings (
  campaign     TEXT        NOT NULL,
  region       TEXT        NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  dials_total  INT,
  average_dps  REAL,
  peak_dps     REAL,
  dps_limit    REAL,
  recorded_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (campaign, region, bucket_start)
);
```

The composite primary key is the dedupe guarantee: re-polling the same bucket updates the row in place and never creates a second one. Gap rows use `region = '__gap__'` (exported as `GAP_REGION`) with `NULL` metric columns.
