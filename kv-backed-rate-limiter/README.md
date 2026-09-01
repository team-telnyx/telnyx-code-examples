# KV-Backed Rate Limiter

Sliding-window rate limiting on Telnyx Edge Compute using the Agent SDK. Each key (phone number, IP, tenant ID) gets its own agent instance that tracks request counts in Edge KV with TTL-based window expiry. Requests over the limit are rejected with HTTP 429. When rejections exceed a threshold, an SMS alert fires automatically via the zero-credential `[telnyx]` binding — no API key in code.

## Why Telnyx

Telnyx is AI Communications Infrastructure that combines edge compute, key-value storage, and programmable messaging in one platform. For rate limiting, this means your sliding-window counters live in Edge KV right next to the compute that enforces them — no external Redis or rate-limit service required. When abuse thresholds are breached, the agent sends an SMS alert through the zero-credential `[telnyx]` binding without any additional provider setup.

## Architecture

```
                    Client Request
                           │
                           ▼
              POST /check
                           │
                           ▼
              ┌────────────────────┐
              │   index.ts         │
              │   (HTTP router)     │
              └────┬───────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  RateLimitAgent      │  (one actor per key)
         │                      │
         │  1. checkLimit()     │──► KV: GET current window count
         │     if under limit   │
         │  2a. allow()          │──► KV: PUT incremented count (TTL)
         │     if over limit     │
         │  2b. reject()         │──► 429 + track rejection count
         │     if rejections     │
         │     >= threshold      │
         │  3. sendAlert()       │──► SMS via [telnyx] binding
         └──────────────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │  RateLimitRegistry   │  (singleton actor)
         │  cross-key aggregate │──► GET /keys
         └──────────────────────┘
```

### What this sample demonstrates

| Feature | How |
|---|---|
| **Edge KV sliding window** | TTL-based counters: `rate:<key>:<windowStart>` — auto-expire, no cleanup |
| **Agent SDK pipeline** | 4-stage queue: `checkLimit → allow/reject → sendAlert → finalize` (non-blocking) |
| **Per-key isolation** | One actor per rate-limited key — no contention between keys |
| **HTTP 429 rejection** | Over-limit requests return 429 with current count and limit metadata |
| **SMS alerting** | Zero-credential `[telnyx]` messaging binding — no API key in code |
| **Registry actor** | Singleton actor aggregates stats for `GET /keys` listing |
| **Simulate endpoint** | `/simulate` fires a burst of requests for testing without real traffic |

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Telnyx CLI](https://developers.telnyx.com/docs/develop/edge-compute/getting-started) (`npm i -g @telnyx/cli`)
- A Telnyx account with:
  - An API key
  - A messaging-enabled phone number (for SMS alerts)
  - An ops phone to receive alerts

### 1. Install dependencies

```bash
cd kv-backed-rate-limiter
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
| `RATE_LIMIT` | Max requests per window per key | `10` |
| `WINDOW_SECONDS` | Sliding window duration | `60` (1 minute) |
| `ALERT_THRESHOLD` | Rejections before SMS fires | `5` |

### 3. Update `telnyx.toml`

Replace `<kv-namespace-uuid>` with your KV namespace ID:

```toml
[storage.kv.RATE_KV]
id = "your-kv-namespace-uuid"
```

Create the KV namespace via the Telnyx CLI or portal.

### 4. Run locally

```bash
npm start
```

This compiles TypeScript and starts the Edge Compute dev server.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/check` | Check a request against the rate limit |
| `GET` | `/status/:key` | Get agent state for a specific key |
| `GET` | `/count/:key` | Get current window count for a key |
| `GET` | `/keys` | List all tracked keys with aggregate stats |
| `POST` | `/reset/:key` | Reset a key's counter (clear the window) |
| `POST` | `/simulate` | Simulate a burst of requests for testing |
| `GET` | `/config` | Get current rate limit configuration |
| `GET` | `/health/liveness` | Liveness probe |
| `GET` | `/health/readiness` | Readiness probe |

## Usage examples

### Check a request

```bash
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"key":"+18005551234"}'
```

Response (allowed):
```json
{
  "key": "+18005551234",
  "action": "allowed",
  "currentCount": 1,
  "limit": 10,
  "windowSeconds": 60,
  "totalRequests": 1,
  "allowedRequests": 1,
  "rejectedRequests": 0,
  "alertTriggered": false
}
```

Response (rejected, HTTP 429):
```json
{
  "key": "+18005551234",
  "action": "rejected",
  "currentCount": 10,
  "limit": 10,
  "windowSeconds": 60,
  "totalRequests": 11,
  "allowedRequests": 10,
  "rejectedRequests": 1,
  "alertTriggered": false
}
```

### Simulate a burst

```bash
# Simulate 15 requests from one key (limit is 10 → 10 allowed, 5 rejected)
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"key":"+18005551234","count":15}'
```

Response:
```json
{
  "key": "+18005551234",
  "simulated": 15,
  "allowed": 10,
  "rejected": 5,
  "alertTriggered": true,
  "results": [
    { "request": 1, "action": "allowed", "currentCount": 1 },
    { "request": 2, "action": "allowed", "currentCount": 2 },
    ...
    { "request": 11, "action": "rejected", "currentCount": 10 },
    { "request": 12, "action": "rejected", "currentCount": 10 },
    ...
  ]
}
```

### Get status for a key

```bash
curl http://localhost:3000/status/+18005551234
```

### List all tracked keys

```bash
curl http://localhost:3000/keys
```

### Reset a key's counter

```bash
curl -X POST http://localhost:3000/reset/+18005551234
```

### Get current window count

```bash
curl http://localhost:3000/count/+18005551234
```

Response:
```json
{
  "key": "+18005551234",
  "count": 7,
  "windowStart": 1718928000,
  "limit": 10
}
```

## How it works

### Sliding window counters

KV keys are namespaced by key and window start time:
```
rate:+18005551234:1718928000   ← count for 14:00–14:01 window
rate:+18005551234:1718928060   ← count for 14:01–14:02 window
rate:+18005559876:1718928000   ← different key, same window
```

Each key has a TTL of `WINDOW_SECONDS`, so old windows auto-expire without cleanup code. This is a fixed-window approximation of a sliding window — simpler than a true sliding window log but uses far fewer KV operations.

### Agent SDK pipeline

Each rate-limited key gets its own `RateLimitAgent` actor instance. When `/check` is called, the agent queues a pipeline:

1. **`checkLimit()`** — Gets the current window count from KV. If under the limit, queues `allow`. If over, queues `reject`.

2a. **`allow()`** — Increments the KV counter and updates the agent's stats (allowed count, total count).

2b. **`reject()`** — Increments the rejection counter. If rejections reach `ALERT_THRESHOLD` and no alert has been sent yet, queues `sendAlert`.

3. **`sendAlert()`** — Sends an SMS via the zero-credential `[telnyx]` binding. The SMS includes the key, limit, window, and rejection count.

4. **`finalize()`** — Marks the request as done.

### Why actors?

Each key is isolated in its own actor with its own state:
- No contention between concurrent keys
- Per-key state (allowed/rejected counts, alert status) survives across requests
- The `RateLimitRegistry` singleton actor aggregates across keys for the `/keys` endpoint

### SMS alerting via `[telnyx]` binding

The `[telnyx]` binding gives the agent a zero-credential messaging client. No API key is needed in the agent code — the binding handles auth at the platform level:

```typescript
await this.env.TELNYX.messages.send({
  from: this.env.SENDER_PHONE,
  to: this.env.ALERT_PHONE,
  text: smsText,
});
```

## File structure

```
kv-backed-rate-limiter/
├── src/
│   ├── rateLimitAgent.ts   # RateLimitAgent + RateLimitRegistry actors
│   └── index.ts           # HTTP router + webhook handler
├── telnyx.toml            # Edge Compute config (KV, actors, env vars)
├── package.json
├── tsconfig.json
├── telnyx-env.d.ts        # Ambient type declarations (KvNamespace)
├── .env.example
└── .gitignore
```

## Use cases

- **API rate limiting** — Limit requests per API key, IP, or tenant
- **Call Control protection** — Limit inbound call rate per phone number before they hit your IVR
- **SMS flood prevention** — Rate limit outbound SMS per user before sending
- **Webhook throttling** — Limit incoming webhook rate per source to protect downstream services
- **Tenant quotas** — Per-tenant request caps on multi-tenant platforms

## Agent Discovery

This folder is self-contained for coding agents. Start with `README.md` for an overview, then the code file and `GUIDE.md` for implementation details.

- **Sign up**: [telnyx.com/sign-up](https://telnyx.com/sign-up)
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **LLM-friendly docs**: [developers.telnyx.com/llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [llms.txt](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI** (human + agent): [developers.telnyx.com/docs/development/cli](https://developers.telnyx.com/docs/development/cli)

## License

MIT

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Everything allowed | KV binding missing — counters do not persist | Check `[storage.kv.RATE_KV]` id in `telnyx.toml` |
| No alert SMS | `ALERT_PHONE`/`SENDER_PHONE` unset or threshold not hit | Set `[env_vars]`, redeploy |
| Limits do not match config | Stale deploy | `telnyx-edge ship` after changing `[env_vars]` |

## Related Examples

- [Persistent State Agent](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/persistent-state-agent/README.md) — Durable StatefulActor on Edge with the same zero-credential inference binding
- [Collaborative Doc with AI Copilot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/collaborative-doc-ai-copilot/README.md) — Multiplayer StatefulActor with an AI copilot on Edge
- [Geo-Distributed Call Logger](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/geo-distributed-call-logger/README.md) — Per-region durable actors with KV counters
