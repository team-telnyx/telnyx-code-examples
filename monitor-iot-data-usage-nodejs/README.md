---
name: monitor-iot-data-usage
title: "Monitor IoT Data Usage"
description: "Monitor Telnyx IoT SIM card data usage with an Express server that polls usage on an interval and exposes REST endpoints for per-SIM consumption and threshold alerts."
language: nodejs
framework: express
telnyx_products: [IoT SIM]
channel: [iot]
---

# Monitor IoT Data Usage

Monitor Telnyx IoT SIM card data usage with an Express server that polls usage on an interval and exposes REST endpoints for per-SIM consumption and threshold alerts.

## Telnyx API Endpoints Used

- **List SIM Cards**: `GET /v2/sim_cards` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- **SIM Card Network Usage**: `GET /v2/sim_cards/{id}/network_usage` -- [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card-network-usage)

## Architecture

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
  │  /api/sims               │
  │  /api/sims/:id           │
  │  /api/sims/:id/usage-... │
  └─────────────────────────┘
```

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single, private global network for voice, messaging, SIP, AI, and IoT - including programmable IoT SIM cards with real-time data usage reporting through one consistent API.

- **Global IoT connectivity** - one SIM, multi-carrier coverage, and usage data you can query programmatically.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `POLLING_INTERVAL` | `number` | `300000` | no | Poll interval in milliseconds (defaults to `300000` = 5 min) | - |
| `PORT` | `number` | `5000` | no | Port the server listens on (defaults to `3000`) | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-nodejs
cp .env.example .env    # ← fill in your credentials
npm install
node server.js          # starts on http://localhost:5000 (or PORT)
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


On startup the server runs an initial poll, then re-polls every `POLLING_INTERVAL` milliseconds, caching each SIM's data usage in memory.

## API Reference

### `GET /api/sims`

List all SIM cards in your account, each enriched with the most recently cached data usage.

```bash
curl http://localhost:5000/api/sims
```

**Response:**

```json
[
  {
    "id": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
    "iccid": "89310410106543789301",
    "status": "active",
    "simCardGroupId": "e8e4c2cb-7d0e-4b4c-9c8e-2f0b2a9d7c11",
    "dataUsage": {
      "usage_bytes": 524288000,
      "limit_bytes": 1073741824
    },
    "lastUpdated": "2026-06-18T12:00:00.000Z"
  }
]
```

### `GET /api/sims/:simCardId`

Retrieve live SIM details plus network usage for one SIM card (fetched fresh from Telnyx, not the cache).

```bash
curl http://localhost:5000/api/sims/6b14e151-8493-4fa1-8664-1cc33d18b29d
```

**Response:**

```json
{
  "simCardId": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
  "iccid": "89310410106543789301",
  "status": "active",
  "simCardGroupId": "e8e4c2cb-7d0e-4b4c-9c8e-2f0b2a9d7c11",
  "dataUsage": {
    "usage_bytes": 524288000,
    "limit_bytes": 1073741824
  }
}
```

### `GET /api/sims/:simCardId/usage-summary`

Return a human-readable usage summary computed from cached data, including a percentage-used value and an alert when usage exceeds 80%.

```bash
curl http://localhost:5000/api/sims/6b14e151-8493-4fa1-8664-1cc33d18b29d/usage-summary
```

**Response:**

```json
{
  "simCardId": "6b14e151-8493-4fa1-8664-1cc33d18b29d",
  "totalDataLimitMB": "1024.00",
  "usedDataMB": "500.00",
  "remainingDataMB": "524.00",
  "percentageUsed": "48.83",
  "alert": "OK"
}
```

### `GET /health`

Liveness check.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-06-18T12:00:00.000Z"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 {"error":"Invalid API key"}` | `TELNYX_API_KEY` is missing, wrong, or rotated. | Copy a current key from [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys) into `.env` (no quotes/spaces) and restart. |
| `404 {"error":"SIM card data not yet cached. Try again in a moment."}` | The background poller hasn't completed a cycle for `/usage-summary` yet. | Wait one `POLLING_INTERVAL`, or lower `POLLING_INTERVAL` in `.env` to speed up testing, then restart. |
| `404 {"error":"SIM card not found or data unavailable"}` | The `simCardId` doesn't match a SIM in your account, or usage data is unavailable. | Confirm the ID against `GET /api/sims` or the [Telnyx Portal](https://portal.telnyx.com) and that the SIM is active. |
| `429 {"error":"Rate limit exceeded. Please slow down."}` | Too many calls to the Telnyx API (often from a low polling interval). | Raise `POLLING_INTERVAL` and add backoff for production. |
| `503 {"error":"Network error connecting to Telnyx"}` | The server can't reach `api.telnyx.com`. | Check connectivity and that a firewall/proxy isn't blocking `api.telnyx.com`. |
| Connection refused on the port | Server not running. | Run `node server.js`; confirm nothing else uses the port (`PORT`, default `3000`). |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [monitor-iot-data-usage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md) - same example in Python
- [sim-fleet-data-usage-anomaly-detector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sim-fleet-data-usage-anomaly-detector-python/README.md) - detect anomalous SIM data usage across a fleet
- [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) - activate a Telnyx SIM card
- [track-iot-device-location-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-python/README.md) - locate IoT devices by SIM

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
