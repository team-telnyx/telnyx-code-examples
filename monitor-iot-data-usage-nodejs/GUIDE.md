# Monitor IoT Data Usage with Telnyx and Express

Build an Express server that polls Telnyx IoT SIM card data usage on an interval, caches it in memory, and exposes REST endpoints to query per-SIM consumption and threshold alerts.

## How It Works

```
  Background poller (setInterval)
        │
        ▼
  ┌─────────────────────────┐
  │ Telnyx IoT SIM API       │
  │  list + network_usage    │
  └───────────┬─────────────┘
              │
              ▼
      In-memory cache (Map)
              │
   HTTP GET   ▼
  ┌─────────────────────────┐
  │ Express REST endpoints   │
  └─────────────────────────┘
```

## Telnyx Products Used

- **IoT SIM** — programmable SIM cards with queryable, real-time data usage.

## API Endpoints

- **List SIM Cards**: `GET /v2/sim_cards` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- **SIM Card Network Usage**: `GET /v2/sim_cards/{id}/network_usage` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card-network-usage)

## Prerequisites

- Node.js 16+ (Node.js 20 LTS recommended)
- npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with an [API key](https://portal.telnyx.com/api-keys)
- At least one active IoT SIM card in your Telnyx account

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

- `TELNYX_API_KEY` — your API v2 key from the [Telnyx Portal](https://portal.telnyx.com/api-keys).
- `POLLING_INTERVAL` — optional, milliseconds between polls (defaults to `300000` = 5 min). Lower it while testing.
- `PORT` — optional, server port (defaults to `3000`; the bundled `.env.example` sets `5000`).

## Step 2: Understand the Code

Everything lives in `server.js`. Here's what each piece does.

### Client and config

The Telnyx client is initialized with the SDK constructor, and config is read from environment variables:

```javascript
const client = new Telnyx({ apiKey: config.apiKey });
const simDataCache = new Map(); // in production, use a database
```

### Helper functions

- **`listAllSimCards()`** — calls `client.simCards.list()` and maps each SIM to `{ id, iccid, status, simCardGroupId }`.
- **`getSimDataUsage(simCardId)`** — calls `client.simCards.retrieve(simCardId)` for details, then `axios.get(.../network_usage)` (with a Bearer header) for usage. Returns `null` on error.
- **`pollDataUsage()`** — lists all SIMs, fetches usage for each, and stores it in `simDataCache`.

### Background polling

On startup the server schedules recurring polls and runs one immediately:

```javascript
setInterval(pollDataUsage, config.pollingInterval);
pollDataUsage(); // initial poll
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sims` | List SIMs with cached usage |
| `GET` | `/api/sims/:simCardId` | Live details + usage for one SIM |
| `GET` | `/api/sims/:simCardId/usage-summary` | Computed MB summary + 80% alert |
| `GET` | `/health` | Liveness check |

Each `/api` handler maps Telnyx SDK errors to HTTP status codes: `AuthenticationError → 401`, `RateLimitError → 429`, `APIError → error.status`, `APIConnectionError → 503`, and anything else to `500`.

## Step 3: Run It

```bash
node server.js
```

The server logs the listening port and the polling interval. With the bundled `.env.example` it starts on `http://localhost:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**List SIMs:**

```bash
curl http://localhost:5000/api/sims
```

**Inspect one SIM (use an ID from the list above):**

```bash
curl http://localhost:5000/api/sims/<simCardId>
```

**Usage summary** (available once the poller has cached the SIM — wait one `POLLING_INTERVAL` if you get a 404):

```bash
curl http://localhost:5000/api/sims/<simCardId>/usage-summary
```

## Going to Production

This example uses in-memory caching for simplicity. For production:

- **Persistence** — replace the in-memory `Map` with PostgreSQL or Redis so cache survives restarts and scales horizontally.
- **Backoff & rate limits** — add exponential backoff around polling to avoid `429`s; tune `POLLING_INTERVAL`.
- **Authentication** — add API key or token validation on the HTTP endpoints.
- **Monitoring** — add structured logging and alerting on the `usage-summary` 80% threshold.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
