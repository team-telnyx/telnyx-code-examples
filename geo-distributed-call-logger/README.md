# Geo-Distributed Call Logger

Log Telnyx Call Control events to a shared SQL database, track per-region call volume in Edge KV counters, and trigger SMS alerts when a region exceeds a configurable threshold — all on Telnyx Edge Compute with the Agent SDK.

## Architecture

```
                    Telnyx Call Control
                           │
                           ▼
              POST /webhooks/voice
                           │
                           ▼
              ┌────────────────────┐
              │   index.ts         │
              │   (webhook router)  │
              └────┬───────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  GeoLoggerAgent      │  (one actor per call)
         │                      │
         │  1. logCall()         │──► SQL DB: INSERT call record
         │                      │──► KV:     INCR region counter
         │  2. checkThreshold()  │──► compare count vs threshold
         │  3. alert()           │──► SMS via [telnyx] binding
         └──────────────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  CallRegistry        │  (singleton actor)
         │  cross-call listing  │──► GET /calls
         └──────────────────────┘
```

### What this sample demonstrates

| Feature | How |
|---|---|
| **Call Control webhooks** | Receives `call.initiated`, `call.answered`, `call.hangup` events |
| **Agent SDK pipeline** | 3-stage queue: `logCall → checkThreshold → alert` (non-blocking) |
| **SQL DB** | Per-call actor persists call records via `ctx.storage.sql` |
| **Edge KV** | Rolling-window per-region counters with TTL expiry |
| **Geo detection** | Country-code prefix → named region (US-East, EU-West, AP-NE, etc.) |
| **SMS alerting** | Zero-credential `[telnyx]` messaging binding — no API key in code |
| **Registry actor** | Singleton actor aggregates calls for `GET /calls` listing |

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Telnyx CLI](https://developers.telnyx.com/docs/develop/edge-compute/getting-started) (`npm i -g @telnyx/cli`)
- A Telnyx account with:
  - A phone number configured for Call Control
  - An API key
  - A messaging-enabled number (for SMS alerts)

### 1. Install dependencies

```bash
cd geo-distributed-call-logger
npm install
```

### 2. Configure environment

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|---|---|---|
| `TELNYX_API_KEY` | Telnyx API key | `KEY019...` |
| `SENDER_PHONE` | Telnyx number sending alerts | `+18005551234` |
| `ALERT_PHONE` | Ops phone receiving alerts | `+18005559876` |
| `REGION_THRESHOLD` | Call count that triggers an alert | `100` |
| `WINDOW_SECONDS` | Rolling window for KV counters | `3600` (1 hour) |

### 3. Update `telnyx.toml`

Replace `<kv-namespace-uuid>` with your KV namespace ID:

```toml
[storage.kv.REGION_KV]
id = "your-kv-namespace-uuid"
```

Create the KV namespace via the Telnyx CLI or portal.

### 4. Run locally

```bash
npm start
```

This compiles TypeScript and starts the Edge Compute dev server.

### 5. Expose the webhook

Use the Telnyx CLI (or ngrok) to expose `POST /webhooks/voice` to the internet, then configure your Call Control application's webhook URL in the Telnyx Portal:

- **Webhook URL**: `https://your-domain/webhooks/voice`
- **Events**: `call.initiated`, `call.answered`, `call.hangup`

## Testing without real calls

### Simulate a call

```bash
# Simulate an inbound call from a Dutch number
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"from":"+31612345678","to":"+18005551234","direction":"inbound","duration":42}'
```

### Check call status

```bash
curl http://localhost:3000/status/sim-1234567890-abc123
```

### List recent calls

```bash
curl http://localhost:3000/calls
```

### View region statistics

```bash
curl http://localhost:3000/regions/stats
```

Response:

```json
{
  "threshold": 100,
  "windowSeconds": 3600,
  "regions": [
    { "region": "us-east-1", "count": 47, "windowStart": 1718928000 },
    { "region": "eu-west-1", "count": 103, "windowStart": 1718928000 },
    ...
  ]
}
```

### Trigger an alert

Set a low threshold in `.env`:

```bash
REGION_THRESHOLD=2
```

Simulate 3 calls from the same region — the third will trigger an SMS to `ALERT_PHONE`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/voice` | Call Control webhook receiver |
| `GET` | `/status/:callId` | Get agent state for a specific call |
| `GET` | `/calls` | List recent calls (from registry actor) |
| `GET` | `/regions/stats` | Per-region call counts in the current window |
| `GET` | `/regions` | List supported regions and country codes |
| `POST` | `/simulate` | Simulate a call webhook (for testing) |
| `GET` | `/health/liveness` | Liveness probe |
| `GET` | `/health/readiness` | Readiness probe |

## Region mapping

The sample maps E.164 country code prefixes to named regions:

| Region | Country codes |
|---|---|
| `us-east-1` | +1 (US/Canada), +52 (Mexico) |
| `eu-west-1` | +44 (UK), +33 (France), +31 (Netherlands) |
| `eu-central-1` | +49 (Germany) |
| `eu-south-1` | +39 (Italy), +34 (Spain) |
| `ap-northeast-1` | +81 (Japan), +82 (South Korea) |
| `ap-southeast-1` | +61 (Australia) |
| `ap-south-1` | +91 (India) |
| `ap-east-1` | +86 (China) |
| `sa-east-1` | +55 (Brazil) |

In production, replace `detectRegion()` with a carrier lookup or Number Insight API for precise geo-routing.

## How it works

### Agent SDK pipeline

Each call gets its own `GeoLoggerAgent` actor instance. When `call.hangup` fires, the agent queues a 3-stage pipeline:

1. **`logCall()`** — Inserts the call record into the actor's SQL DB and increments the region counter in KV. The KV key includes a window timestamp (`region:eu-west-1:1718928000`) so counters auto-expire after the rolling window.

2. **`checkThreshold()`** — Compares the post-increment region count against `REGION_THRESHOLD`. If exceeded, queues the alert stage.

3. **`alert()`** — Sends an SMS via the zero-credential `[telnyx]` binding — no API key needed in code. The SMS includes the region, count, threshold, and last call details.

### Why actors?

Each call is isolated in its own actor with its own SQL DB instance. This means:
- No contention between concurrent calls
- Per-call state survives webhook retries
- The `CallRegistry` singleton actor aggregates across calls for the `/calls` endpoint

### Rolling window counters

KV keys are namespaced by window start time:
```
region:eu-west-1:1718928000   ← count for 14:00–15:00 window
region:eu-west-1:1718931600   ← count for 15:00–16:00 window
```

Each key has a TTL of `WINDOW_SECONDS`, so old windows auto-expire without cleanup code.

## File structure

```
geo-distributed-call-logger/
├── src/
│   ├── geoLogger.ts    # GeoLoggerAgent + CallRegistry actors + region detection
│   └── index.ts        # Webhook handler + HTTP routes
├── telnyx.toml         # Edge Compute config (KV, actors, env vars)
├── package.json
├── tsconfig.json
├── telnyx-env.d.ts     # Ambient type declarations (KvNamespace)
├── .env.example
└── .gitignore
```

## License

MIT
