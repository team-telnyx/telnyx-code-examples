---
name: dial-odometer
title: "Dial Odometer — Watch Your Dial Rate Before the Limit Says No"
description: "A durable per-campaign actor that polls Telnyx dial metrics every minute, tracks live DPS against the account limit, and flips a throttle flag before the platform does."
language: typescript
framework: edge
telnyx_products: [Voice, Dial Metrics, Agent SDK]
---

# Dial Odometer — Watch Your Dial Rate Before the Limit Says No

A stateful Telnyx Edge actor that remembers how fast one outbound campaign has been dialing, minute by minute, and warns the team at 80% of the DPS limit — two minutes before the platform says no.

## The Story

A regional community-health clinic network runs an automated outbound campaign every Monday morning: appointment reminders, insurance pre-authorizations, and no-show follow-ups for eleven locations. The dials are cheap; the failure is not. When the campaign's dial rate creeps past the account's DPS limit, Telnyx starts rejecting calls, the reminder queue backs up into the afternoon, and patients who never got a reminder simply don't show — lost revenue, wasted clinician hours, and a compliance trail that says the outreach was attempted but never completed. The team's only warning today is the sound of dials failing.

The actor IS the campaign's rate odometer. It is born the moment the campaign app registers `spring-reminders`, and from that second it owns the streak counter, the throttle flag, and every reading the campaign has ever taken. It wakes on its own 60-second schedule, files one row per region into SQL, and stays quiet until two consecutive minutes cross 80% of the limit — then it flips to throttling and publishes a one-line instruction the app can obey. When the pod running it is killed at 9:06, the next poll re-wakes the same actor with the 9:00–9:05 history intact and the streak logic picks up exactly where it stopped; when the API itself goes dark, it retries with bounded backoff and marks the minute as a gap rather than inventing a number. It completes only when the campaign does.

The rest of this README is the API surface of that story.

## Why Telnyx

Rate limits are the one part of an outbound campaign that no amount of application logic can negotiate with — the platform enforces them, and the only lever you get is knowing before it happens. Telnyx exposes per-region dial metrics with second-level granularity (`dials.total`, `average_dps`, `peak_dps`, and the account's `dps_limit`) and is honest about the ~15–20 second bucket lag, which is exactly the surface a durable actor needs to build a real odometer instead of a guess. Pairing that with the Telnyx Agent SDK — durable state, agent SQL, and a scheduled poll loop that survives restarts — turns a numbers-laden metrics endpoint into **AI Communications Infrastructure**: a campaign that paces itself, remembers its own history, and never learns the same lesson twice.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/v2/dial_metrics` | Fetch per-region dial metrics for the last two minutes (`granularity=second`, `sort=-start_time`, `start_time`, `end_time`) |
| — | Agent SDK `DialOdometer` actor | Durable per-campaign state, 60-second `schedule()` poll loop, `@rpc status()` surface |
| — | Agent SQL `ODOMETER_DB` | `dps_readings` table, deduped on `(campaign, region, bucket_start)` |

## Architecture

```
 campaign app
      │  POST /odometer  {"campaign":"spring-reminders"}
      ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ fetch handler (src/index.ts)                                 │
 │   env.ODOMETER.idFromName("spring-reminders")  ──▶ stub      │
 └───────────────────────────┬──────────────────────────────────┘
                             │  arm(campaign)
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ DialOdometer extends Agent<Env, OdometerState>               │
 │                                                              │
 │  state: { campaign, streak, throttling, lastDps }            │
 │                                                              │
 │  this.schedule(60, "onPoll", {id:"poll:<campaign>"})         │
 │      │                                                       │
 │      ├── onPoll()   GET /v2/dial_metrics ──▶ file rows       │
 │      ├── onStreak() 2× ≥ WARN_PCT(80) ──▶ throttling = true  │
 │      ├── onClear()  2× <  WARN_PCT     ──▶ throttling = false│
 │      ├── onGap()    429/5xx ──▶ backoff 2s/4s/8s ──▶ gap row │
 │      └── @rpc status() ──▶ one-screen history                │
 └───────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ ODOMETER_DB (agent SQL) — dps_readings                       │
 │ (campaign, region, bucket_start, dials_total, average_dps,   │
 │  peak_dps, dps_limit, recorded_at)                           │
 │ UNIQUE (campaign, region, bucket_start)  ← re-poll = no dup  │
 └──────────────────────────────────────────────────────────────┘
```

**Streak rule.** Live DPS is the hottest region's `average_dps` in the newest bucket, expressed as a percentage of that region's `dps_limit`. Two consecutive minutes at or above `WARN_PCT` (default 80) set `throttling = true`; two consecutive minutes below clear it. A region with no bucket in the window reads as `0 dps` — the API's documented missing-bucket rule — so a quiet region never triggers a false alarm.

**Failure contract.** `429`/`5xx` responses are retried with bounded backoff (2 s, 4 s, 8 s). If all three attempts fail, the minute is written as a gap row (`region = "__gap__"`, NULL metrics). No reading is ever fabricated.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

The sample runs in **demo mode by default** (`DEMO_MODE=true`), which serves deterministic dial-metric buckets so you can watch the full throttle arc without a Telnyx account or a live campaign. Set `DEMO_MODE=false` to hit the real `GET /v2/dial_metrics` endpoint with the key above.

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/dial-odometer

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# edit .env and set TELNYX_API_KEY (leave DEMO_MODE=true to start safely)

# 4. Generate binding types from telnyx.toml
npx telnyx-edge types

# 5. Run the smoke test
npx tsx smoke_test.ts

# 6. Deploy
npx telnyx-edge auth api-key set "$TELNYX_API_KEY"
npx telnyx-edge ship
```

Once deployed, arm a campaign and read the odometer:

```bash
# Arm the actor (born here, not on a status read)
curl -X POST https://<your-edge-host>/odometer \
  -H 'content-type: application/json' \
  -d '{"campaign":"spring-reminders"}'

# Read the one-screen history
curl https://<your-edge-host>/odometer/spring-reminders/status

# Force a poll (the 60s schedule does this on its own)
curl -X POST https://<your-edge-host>/odometer/spring-reminders/poll
```

## API Reference

### `POST /odometer`

Arms the durable actor for a campaign. The actor is created via `env.ODOMETER.idFromName(campaign)` on this call — not on a status read.

```json
{ "campaign": "spring-reminders" }
```

`202 Accepted`

```json
{
  "campaign": "spring-reminders",
  "armed": true,
  "state": { "campaign": "spring-reminders", "streak": 0, "throttling": false, "lastDps": 0 }
}
```

`400` when `campaign` is not 2–64 characters of lowercase letters, digits, or hyphens.

### `GET /odometer/:campaign/status`

Returns the `@rpc status()` screen: current state, the throttle instruction, and the recent reading history.

```json
{
  "campaign": "spring-reminders",
  "throttling": true,
  "streak": 2,
  "lastDps": 0.83,
  "dpsLimit": 1.0,
  "message": "spring-reminders: slow to ≤0.8 dps until further notice.",
  "readings": [
    { "region": "us-east", "bucketStart": "2026-07-28T09:02:00Z", "dialsTotal": 49, "averageDps": 0.82, "peakDps": 0.91, "dpsLimit": 1.0 },
    { "region": "us-east", "bucketStart": "2026-07-28T09:03:00Z", "dialsTotal": 50, "averageDps": 0.83, "peakDps": 0.95, "dpsLimit": 1.0 }
  ]
}
```

### `POST /odometer/:campaign/poll`

Runs one poll cycle immediately (the 60-second `schedule()` does this automatically). Returns the same shape as `status`.

### Actor RPC surface

| Method | Description |
|--------|-------------|
| `arm(campaign)` | Initialize state and register the 60-second poll schedule |
| `onPoll()` | Fetch dial metrics, file one row per region, evaluate the streak |
| `status()` | One-screen history + current throttle instruction |

### `dps_readings` schema

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
  UNIQUE (campaign, region, bucket_start)
);
```

Re-polling the same bucket updates in place — it never creates a second row.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `400 campaign must be 2-64 chars…` | Campaign name has uppercase, spaces, or underscores | Use lowercase letters, digits, and hyphens only |
| Status always shows `throttling: false` | `DEMO_MODE=true` with the calm fixture, or the campaign is genuinely under 80% | Set `DEMO_MODE=false` for live metrics, or check `lastDps` in the status screen |
| Readings stop for a minute, then resume | API returned `429`/`5xx` and the actor wrote a gap row | Expected — inspect rows where `region = '__gap__'`; no reading was invented |
| `ODOMETER namespace did not return an actor stub` | `[[actors]]` binding missing or misnamed in `telnyx.toml` | Confirm `binding = "ODOMETER"` and re-run `npx telnyx-edge types` |
| `401` from `/v2/dial_metrics` | Missing or invalid `TELNYX_API_KEY` | `npx telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| First poll after arming returns no buckets | Documented ~15–20 s bucket lag | Wait one cycle; the actor treats the missing bucket as `0 dps` |
| Duplicate rows in `dps_readings` | Table created without the unique constraint | Drop and recreate using the schema above |

## Agent Discovery

- Agent signup and onboarding: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- Telnyx AI agent examples and tooling: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- Machine-readable docs index: [developers.telnyx.com/llms.txt](https://developers.telnyx.com/llms.txt)

## Related Examples

- **Attribution Wheel** (`cs24:sonam:attribution-wheel`) — attributes AI Gateway spend per team. Same durable-actor shape, different currency: cost instead of dial throughput.
- **Edge Compute Stateful Actor** (`edge-compute-statefulactor`) — the baseline Agent SDK pattern this sample builds on.
- **Call Control campaign samples** — outbound dialing flows that this odometer is designed to pace.

## Resources

- [Dial metrics guide](https://developers.telnyx.com/docs/voice/programmable-voice/dial-metrics)
- [List dial metrics — API reference](https://developers.telnyx.com/api-reference/call-information/list-dial-metrics)
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk)
- [Programmable Voice product page](https://telnyx.com/products/voice-api)
- [Telnyx pricing](https://telnyx.com/pricing)
