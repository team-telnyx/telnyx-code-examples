# dial-odometer — Watch Your Dial Rate Before the Limit Says No

A standalone tutorial for the `dial-odometer` Telnyx Edge sample: a durable, per-campaign actor that polls Telnyx dial metrics every minute, computes live DPS, and flips a throttle flag after two consecutive minutes above 80% of your account's DPS limit.

---

## What you'll build

One outbound campaign, one durable actor, one screen of history.

```
POST /odometer {"campaign": "spring-reminders"}
   └─> env.ODOMETER.idFromName("spring-reminders")   ← the actor is born here
        └─> this.schedule(60, "poll", { id: "poll:spring-reminders" })
             └─> GET /v2/dial_metrics?granularity=second&sort=-start_time&...
                  └─> one row per region into dps_readings (agent SQL)
                       └─> streak logic → throttling = true | false
                            └─> @rpc status() → the one-screen history
```

The actor is not a chart and not a cache. It is the campaign's rate *memory*: the streak counter, the throttle flag, and every reading since Monday morning survive polls, pod restarts, and days.

---

## Why this sample exists

Telnyx publishes per-region dial metrics with second-level granularity — `dials.total`, `average_dps`, `peak_dps`, and the account's `dps_limit`. The API is honest about two things most demos ignore:

1. **Bucket lag.** A bucket only appears ~15–20 seconds after the window closes.
2. **Missing buckets mean zero.** A region with no record in the window is dialing at 0 dps, not "unknown."

Most campaign demos discover the rate limit the same way: dials start failing. This one watches the odometer instead — it warns at 80% of the limit for two consecutive minutes and hands the team a readable history *before* the platform says no.

---

## Prerequisites

- A Telnyx account with outbound voice enabled and a DPS limit you can look up.
- A Telnyx API key (`KEY...`) with access to call information / dial metrics.
- Node.js 20+ and `npx`.
- The `telnyx-edge` CLI installed and on your `PATH`.

```bash
npm install -g @telnyx/edge-runtime-cli   # provides the `telnyx-edge` binary
telnyx-edge auth api-key set KEY_your_key_here
```

> There is no `telnyx-edge dev` and no `telnyx-edge deploy`. The deploy command is `telnyx-edge ship`.

---

## Project layout

```
dial-odometer/
├── src/
│   ├── index.ts        # HTTP surface: arm, poll, status
│   └── odometer.ts     # DialOdometer actor, state, SQL, streak logic
├── smoke_test.ts       # module-load + actor-surface + HTTP validation checks
├── telnyx.toml         # actor binding, SQL binding, secret binding
├── package.json        # main: src/index.ts, deploy: telnyx-edge ship
├── tsconfig.json
├── .env.example
├── README.md
├── API.md
└── GUIDE.md
```

`src/index.ts` is the entry point. It does three things and nothing else: resolve an actor stub, validate input, and translate HTTP into actor calls. All the intelligence lives in `src/odometer.ts`.

---

## Environment setup

### `telnyx.toml`

```toml
name = "dial-odometer"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "ODOMETER"
type    = "DialOdometer"

[storage.sqldb.ODOMETER_DB]
id = "<sqldb-namespace-uuid>"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[env_vars]
DEMO_MODE  = "true"
POLL_EVERY = "60"
WARN_PCT   = "80"
```

Three bindings, three jobs:

| Binding | Kind | Used for |
| --- | --- | --- |
| `ODOMETER` | `ActorNamespace` | `env.ODOMETER.idFromName(campaign)` — one durable actor per campaign |
| `ODOMETER_DB` | `SqlDatabase` | the `dps_readings` table |
| `SECRETS` | `Secrets` | `await env.SECRETS.get("TELNYX_API_KEY")` at call time |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELNYX_API_KEY` | — | Bearer token for `GET /v2/dial_metrics`. Read from `SECRETS`, never from source. |
| `DEMO_MODE` | `true` | When `true`, the poll synthesizes a deterministic metrics payload instead of calling Telnyx. |
| `POLL_EVERY` | `60` | Seconds between polls. Passed straight to `this.schedule()`. |
| `WARN_PCT` | `80` | Percentage of `dps_limit` that arms the streak counter. |

Set the secret once:

```bash
telnyx-edge secrets add TELNYX_API_KEY "KEY_your_key_here"
```

`.env.example` ships with placeholders only:

```dotenv
TELNYX_API_KEY=your_telnyx_api_key_here
DEMO_MODE=true
POLL_EVERY=60
WARN_PCT=80
```

After editing `telnyx.toml`, regenerate the typed bindings so `env.ODOMETER_DB` and friends typecheck:

```bash
npm run types     # telnyx-edge types
```

---

## Step 1 — The actor is the campaign's memory

Open `src/odometer.ts`. The class declaration is the whole architecture:

```ts
export class DialOdometer extends Agent<Env, OdometerState> {
  protected initialState(): OdometerState { /* ... */ }
  async arm(campaign: string): Promise<OdometerState> { /* ... */ }
  async onPoll(): Promise<void> { /* ... */ }
  async status(): Promise<StatusScreen> { /* ... */ }
}
```

`Agent<E, State>` gives you four things you would otherwise hand-roll:

- **Durable state** — `this.getState()` / `this.setState(patch)` with merge-patch semantics. `setState({ throttling: true })` touches only `throttling`.
- **Scheduling** — `this.schedule(delaySeconds, method, payload, opts)`, dispatched by method name.
- **SQL** — through the `ODOMETER_DB` env binding (`this.env.ODOMETER_DB.prepare(...)`), not a `this.sql` helper.
- **RPC** — every public async method is callable from a stub. `status()` is the team-facing surface.

The state is deliberately tiny:

```ts
export interface OdometerState {
  campaign: string;
  streak: number;      // consecutive polls at or above WARN_PCT
  throttling: boolean; // the flag the campaign app reads
  lastDps: number;     // most recent live DPS, as a fraction of dps_limit
}
```

Four fields. Everything else — the minute-by-minute history — lives in SQL, where it belongs.

---

## Step 2 — Arming the odometer

The actor is born on the app's registration call, not on a bare HTTP route. In `src/index.ts`, the `POST /odometer` branch of the `fetch` handler validates the campaign name and then hands off to `actorStub(env, campaign).arm(campaign)`.

The `actorStub` helper is worth reading closely, because the runtime can hand back an actor handle in more than one shape:

```ts
const handle = namespace.idFromName(campaign);
if (handle && typeof handle.arm === "function") return handle;        // ready-to-call stub
const inner = handle?.stub;                                           // handle carrying .stub
if (inner && typeof inner.arm === "function") return inner;
if (typeof namespace.get === "function") return namespace.get(handle); // id → stub
throw new Error("ODOMETER namespace did not return an actor stub");
```

Whatever the shape, the identity is the same: `idFromName(campaign)`. Two calls with `"spring-reminders"` reach the same durable entity, in the same pod or a different one, today or next Tuesday.

Validation happens before the actor is touched. `CAMPAIGN_PATTERN` (`/^[a-z0-9][a-z0-9-]{1,63}$/`) keeps campaign names URL-safe and stable, since the name *is* the actor id:

```bash
curl -X POST https://your-app.example/odometer \
  -H 'content-type: application/json' \
  -d '{"campaign":"spring-reminders"}'
# 202 {"campaign":"spring-reminders","armed":true,"state":{...}}
```

`arm()` is idempotent: it seeds `initialState()` if the actor is new, and if it is already running it just re-asserts the poll schedule and returns the current state. Calling it twice does not create a second timer.

---

## Step 3 — The 60-second poll loop

Inside `arm()`, the actor schedules itself:

```ts
this.schedule(this.env.POLL_EVERY ?? 60, "poll", undefined, {
  id: "poll:" + campaign,
});
```

The `id` is the important part. A stable schedule id means the timer is **upserted**, not duplicated — re-arming the campaign replaces the pending poll instead of stacking a second one. And because the schedule lives in the actor's durable storage, a pending poll still fires after a pod restart.

`onPoll()` is a plain async method. The Agent SDK dispatches to it by name; there is no `setInterval`, no background thread, no in-memory timer to lose.

---

## Step 4 — Reading the dial metrics API

`onPoll()` builds a two-minute window and issues one GET:

```
GET https://api.telnyx.com/v2/dial_metrics
      ?granularity=second
      &sort=-start_time
      &start_time=2026-07-28T09:00:00Z
      &end_time=2026-07-28T09:02:00Z
Authorization: Bearer <TELNYX_API_KEY>
```

Four query parameters, each doing real work:

- `granularity=second` — the finest bucket the API offers.
- `sort=-start_time` — newest bucket first, so the actor reads the freshest record per region without sorting client-side.
- `start_time` / `end_time` — a two-minute lookback, wide enough to absorb the documented lag.

A record looks like this (illustrative):

```json
{
  "region": "us-east",
  "start_time": "2026-07-28T09:01:00Z",
  "dials": { "total": 42 },
  "average_dps": 0.70,
  "peak_dps": 0.84,
  "dps_limit": 1.0
}
```

### Handling the ~15–20 second bucket lag

The newest bucket is always slightly stale. The actor accounts for this in two ways:

1. **The window is two minutes wide**, not one. A poll at 9:02 asks for 9:00–9:02, so the 9:01 bucket has had time to land.
2. **The actor never assumes a bucket exists.** It reads whatever the API returned and files it. It does not synthesize the missing minute.

### Missing bucket = 0 dps

The API's documented rule is that a region absent from the response is dialing at zero. The actor honors that literally: a region with no record in the window is filed as `average_dps = 0`, `dials_total = 0`. A quiet region therefore never contributes to the streak and never triggers a false alarm — which is exactly the behavior you want at 3 a.m.

---

## Step 5 — Computing live DPS

"Live DPS" in this sample is deliberately narrow and easy to reason about:

> the hottest region's `average_dps` in the newest bucket, expressed as a percentage of that region's `dps_limit`.

```ts
const liveDps = newest.average_dps / newest.dps_limit;   // 0.82 → 82% of limit
```

Taking the *hottest* region rather than an average is the conservative choice: the limit that will reject your dials is the one on the region that is busiest, not the fleet-wide mean. `peak_dps` is stored alongside for the history screen, but the streak rule runs on `average_dps` — a single spiky second should not throttle a campaign.

---

## Step 6 — The streak rule

Two consecutive minutes at or above `WARN_PCT` flips the flag. One minute does not.

```ts
// onStreak(n) — called with the live DPS percentage
if (n >= warnPct) {
  const streak = state.streak + 1;
  if (streak >= 2 && !state.throttling) {
    await this.setState({ streak, throttling: true, lastDps: n });
    // flag the campaign; the status screen now reads:
    // "spring-reminders: slow to ≤0.8 dps until further notice."
  } else {
    await this.setState({ streak, lastDps: n });
  }
} else {
  await this.setState({ streak: 0, lastDps: n });
}
```

The two-minute requirement is the whole point. A single 83% minute is noise — a retry burst, a batch that landed late. Two in a row is a trend, and a trend is worth telling the campaign app about.

The flag is *advisory*, not enforcement. The actor does not stop your dials; it publishes a state your campaign app reads before it queues the next batch. That keeps the actor out of the call path and keeps the decision where it belongs.

---

## Step 7 — Clearing the flag

Clearing is the mirror image, and it is intentionally symmetric: two consecutive minutes below the threshold.

```ts
// onClear() — the clear-side counter
if (n < warnPct) {
  const clearStreak = state.clearStreak + 1;
  if (clearStreak >= 2 && state.throttling) {
    await this.setState({ throttling: false, streak: 0, clearStreak: 0 });
  }
}
```

Symmetric hysteresis on both edges means the flag does not chatter. A campaign that dips to 79% for one minute and pops back to 81% stays throttled — which is correct, because nothing has actually changed.

---

## Step 8 — Gaps, not guesses

If the API returns 429 or a 5xx, the actor retries with bounded backoff: **2 s, 4 s, 8 s**, then stops.

```ts
// onGap() — after the third failed retry
await this.env.ODOMETER_DB.prepare(
  `INSERT INTO dps_readings
     (campaign, region, bucket_start, dials_total, average_dps, peak_dps, dps_limit, recorded_at)
   VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)
   ON CONFLICT (campaign, region, bucket_start) DO NOTHING`
).bind(campaign, GAP_REGION, bucketStart, now).run();
```

`GAP_REGION` is the exported sentinel `"__gap__"`. A gap row has NULL metrics and a real `bucket_start`, so the history screen shows an honest hole instead of a fabricated zero.

This distinction matters more than it looks. A missing *region* means zero dials. A missing *API response* means unknown. Collapsing the two would either hide an outage or invent a throttle. The actor keeps them separate.

---

## Step 9 — `dps_readings` schema and dedupe

The table is created on first use:

```sql
CREATE TABLE IF NOT EXISTS dps_readings (
  campaign      TEXT        NOT NULL,
  region        TEXT        NOT NULL,
  bucket_start  TIMESTAMPTZ NOT NULL,
  dials_total   INT,
  average_dps   REAL,
  peak_dps      REAL,
  dps_limit     REAL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (campaign, region, bucket_start)
);
```

The primary key is the dedupe rule. Every insert is:

```sql
INSERT INTO dps_readings (...) VALUES (...)
ON CONFLICT (campaign, region, bucket_start) DO UPDATE SET
  dials_total = excluded.dials_total,
  average_dps = excluded.average_dps,
  peak_dps    = excluded.peak_dps,
  dps_limit   = excluded.dps_limit,
  recorded_at = excluded.recorded_at;
```

Because the poll window is two minutes wide and the poll runs every minute, **every bucket is seen twice**. The upsert makes that harmless: re-polling the same bucket refreshes the row (the API's numbers can settle as the bucket fills) and never creates a second one. That is also why the lag handling works — the second sighting of a bucket is the one with complete data.

---

## Step 10 — The status screen

`status()` is a public async method on the actor, so the Agent SDK exposes it over RPC. From the HTTP layer it is one call:

```ts
return json(await stub.status());
```

The screen is built from two sources: the actor's state (campaign, flag, streak, last DPS) and a SQL query over `dps_readings` for the recent history, gap rows included.

```bash
curl https://your-app.example/odometer/spring-reminders/status
```

```json
{
  "campaign": "spring-reminders",
  "throttling": true,
  "lastDps": 0.83,
  "warnPct": 80,
  "streak": 2,
  "message": "spring-reminders: slow to ≤0.8 dps until further notice.",
  "readings": [
    { "region": "us-east", "bucketStart": "2026-07-28T09:03:00Z", "averageDps": 0.83, "dpsLimit": 1.0 },
    { "region": "us-east", "bucketStart": "2026-07-28T09:02:00Z", "averageDps": 0.82, "dpsLimit": 1.0 },
    { "region": "us-east", "bucketStart": "2026-07-28T09:01:00Z", "averageDps": 0.70, "dpsLimit": 1.0 }
  ]
}
```

One screen. That is the deliverable — a human can read it in five seconds and know whether to slow down.

---

## Step 11 — The HTTP surface

Everything in `src/index.ts` is routing and validation. Three routes:

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/odometer` | Validates `{campaign}`, resolves the actor, calls `arm()`. Returns `202` with the actor state. |
| `GET` | `/odometer/:campaign/status` | Calls `status()`. Returns the screen. |
| `POST` | `/odometer/:campaign/poll` | Forces an immediate `onPoll()` (useful in demo mode), then returns `status()`. |

The path regex `/^\/odometer\/([a-z0-9][a-z0-9-]{1,63})\/(status|poll)$/` mirrors `CAMPAIGN_PATTERN`, so a malformed campaign name 404s at the router rather than reaching an actor.

Error handling is deliberately boring:

- `400` — campaign name failed validation.
- `405` — wrong method for the route.
- `404` — no matching path.
- `500` — anything thrown. The handler logs `error.message` via `console.error` and returns `{"error":"internal error"}`. No stack traces, no credentials, no PII in the response.

---

## Demo mode vs live mode

`DEMO_MODE` defaults to `true`, so the sample runs end to end with no Telnyx credentials and no real dials.

**Demo mode (`DEMO_MODE=true`)** — `onPoll()` synthesizes a deterministic metrics payload that walks the full arc: 70% → 82% → 83% (throttle) → 41% → 41% (clear). The SQL writes, the streak logic, the state transitions, and the status screen are all real. Only the HTTP call to Telnyx is replaced. This is the mode the smoke test exercises.

**Live mode (`DEMO_MODE=false`)** — `onPoll()` reads `await this.env.SECRETS.get("TELNYX_API_KEY")` at call time and issues the real `GET /v2/dial_metrics` request described in Step 4. Nothing else changes: same table, same streak rule, same screen.

To switch:

```bash
# telnyx.toml → [env_vars] DEMO_MODE = "false"
telnyx-edge secrets add TELNYX_API_KEY "KEY_your_key_here"
telnyx-edge ship
```

Live mode reads your account's real `dps_limit`. If you have never dialed, every region will report 0 dps and the flag will never arm — that is correct behavior, not a bug.

---

## Running it

```bash
# 1. install
npm install

# 2. regenerate typed bindings from telnyx.toml
npm run types

# 3. smoke test (module load, actor surface, HTTP validation)
npx tsx smoke_test.ts

# 4. deploy
npm run deploy        # → telnyx-edge ship

# 5. arm a campaign
curl -X POST https://your-app.example/odometer \
  -H 'content-type: application/json' \
  -d '{"campaign":"spring-reminders"}'

# 6. force a poll (demo mode) and read the screen
curl -X POST https://your-app.example/odometer/spring-reminders/poll
curl https://your-app.example/odometer/spring-reminders/status
```

---

## The demo arc, minute by minute

| Time | What happens |
| --- | --- |
| 9:00 | `POST /odometer {"campaign":"spring-reminders"}` → `idFromName` → actor armed, poll scheduled. |
| 9:01 | Poll fires. Window 8:59–9:01. Newest bucket: `dials.total=42`, `average_dps=0.70`, `peak_dps=0.84`, `dps_limit=1.0`. Row filed. |
| 9:02 | Live DPS 0.82 (82%). Above `WARN_PCT`. `streak=1`. Reading filed, flag stays down. |
| 9:03 | Live DPS 0.83. `streak=2` → `throttling=true`. Status reads *"spring-reminders: slow to ≤0.8 dps until further notice."* |
| 9:07 | The campaign app respects the flag and paces dials. |
| 9:08 | Two consecutive minutes at 0.41 → flag cleared. |

Two variants worth running:

- **Quiet region.** Add a region with no record in the window. It files as 0 dps and does not touch the streak.
- **API outage.** Point `TELNYX_API_KEY` at an invalid value in live mode. The actor retries at 2 s, 4 s, 8 s, then writes a `__gap__` row with NULL metrics. The status screen shows a hole, not a zero.

---

## Resume proof: kill the pod at 9:06

This is the criterion the whole design exists to satisfy.

1. Arm the campaign and let it poll from 9:00 to 9:05.
2. Kill the pod (redeploy, or let the runtime evict it).
3. The next poll re-wakes the actor.

What survives:

- **The readings.** 9:00–9:05 are rows in `dps_readings`, keyed on `(campaign, region, bucket_start)`. They were never in memory.
- **The streak.** `streak` and `throttling` are actor state, restored from durable storage before `onPoll()` runs. The streak continues from the last recorded bucket instead of restarting at zero.
- **The schedule.** The pending poll was written with a stable id (`poll:spring-reminders`), so it still fires after the restart — no re-arm required.

Verify it with the status screen: after the restart, `readings` still starts at 9:00 and `streak` is whatever it was at 9:05.

---

## Troubleshooting

**`ODOMETER namespace did not return an actor stub`**
The `[[actors]]` binding in `telnyx.toml` is missing or the `type` does not match the exported class name. Run `npm run types` and redeploy.

**`status()` returns an empty `readings` array**
No poll has completed yet. `POST /odometer/:campaign/poll` forces one immediately in demo mode.

**The flag never arms in live mode**
Check `dps_limit` in the raw API response. A brand-new account with no dial traffic reports 0 dps everywhere, so 80% of the limit is never reached.

**`dps_readings` has duplicate-looking rows**
It should not — the primary key is `(campaign, region, bucket_start)`. If you see two rows for the same bucket, the insert is missing its `ON CONFLICT` clause.

**Gap rows appearing every minute**
The API is unreachable or the key is wrong. Gaps are the honest record of that; fix the credential and the next poll resumes normally.

**`telnyx-edge deploy` is not a command**
It is `telnyx-edge ship`.

---

## Next steps

- [Dial metrics guide](https://developers.telnyx.com/docs/voice/programmable-voice/dial-metrics) — the DPS limit guidance this sample operationalizes.
- [List dial metrics API reference](https://developers.telnyx.com/api-reference/call-information/list-dial-metrics) — every parameter and response field.
- [Agent SDK docs](https://developers.telnyx.com/docs/agent-sdk) — `Agent`, `this.schedule()`, `@rpc`, and durable state.
- Extend it: add a `POST /odometer/:campaign/threshold` route that lets the campaign app adjust `WARN_PCT` per campaign, or fan `status()` out to a Slack webhook when `throttling` flips.
- Compare with the **Attribution Wheel** sample (`cs24:sonam:attribution-wheel`): same actor pattern, different currency — that one attributes AI Gateway spend per team; this one watches dial throughput per campaign.

Fingerprint: `cs26:sonam:dial-odometer`
