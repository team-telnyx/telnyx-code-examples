---
name: activate-sim-card
title: "Activate SIM Card"
description: "Retrieve and activate a Telnyx IoT SIM card by ID using the Telnyx Node.js SDK over an Express API."
language: nodejs
framework: express
telnyx_products: [IoT]
channel: [sim]
---

# Activate SIM Card

Retrieve and activate a Telnyx IoT SIM card by ID using the Telnyx Node.js SDK over an Express API.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform — voice, messaging, SIP, AI, and IoT SIM management on one private, global network. The IoT SIM API lets you provision, activate, and manage cellular connectivity programmatically with the same key and SDK you use for everything else.

- **Programmable IoT SIMs** — activate, deactivate, and inspect SIM cards over a simple REST API.
- **One platform** — IoT connectivity sits next to voice, messaging, and AI under a single API key.

## Telnyx API Endpoints Used

- **Get SIM Card**: `GET /v2/sim_cards/{id}` — via `client.simCards.retrieve()` — [API reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- **Activate SIM Card**: `POST /v2/sim_cards/{id}/actions/enable` — via `client.simCards.actions.enable()` — [API reference](https://developers.telnyx.com/api-reference/sim-cards/enable-sim-card)

## Architecture

```
  HTTP Request
        │
        ▼
  ┌──────────────────┐
  │  Express server   │
  │  (server.js)      │
  └────────┬─────────┘
           │  Telnyx Node SDK
           ▼
  ┌──────────────────┐
  │  Telnyx IoT SIM   │
  │  API              │
  └────────┬─────────┘
           │
           └──► SIM retrieved / activated
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `number` | `5000` | no | Port the Express server listens on (defaults to `3000` if unset) | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-nodejs
cp .env.example .env    # ← fill in your TELNYX_API_KEY
npm install
node server.js          # starts on http://localhost:5000 (PORT from .env)
```

The server logs the routes it exposes on startup.

## API Reference

### `GET /sim/:id`

Retrieve details for a specific SIM card.

```bash
curl http://localhost:5000/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158
```

**Response:**

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "iccid": "89310410106543789301",
  "status": "disabled",
  "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10",
  "phoneNumber": "+13125550123"
}
```

### `POST /sim/:id/activate`

Activate a SIM card by ID.

```bash
curl -X POST http://localhost:5000/sim/6b14e151-8493-4fa1-8664-1cc4e6d14158/activate
```

**Response:**

```json
{
  "message": "SIM card activated successfully",
  "sim": {
    "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
    "iccid": "89310410106543789301",
    "status": "enabled",
    "simCardGroupId": "47a9c0fa-1d3b-4f2a-9e22-2c4e9a1b7d10",
    "activatedAt": "2026-06-18T12:00:00.000Z"
  }
}
```

### `GET /health`

Liveness probe.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{ "status": "ok" }
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `{"error": "Invalid API key"}` (401) | `TELNYX_API_KEY` is missing or wrong. | Set a valid key in `.env` and restart the server. The SDK reads the key at startup. |
| `{"error": "..."}` with a 404 status | The SIM card ID does not exist in your account. | Confirm the ID under IoT → SIM Cards in the [Telnyx Portal](https://portal.telnyx.com). |
| `{"error": "SIM card ID must be a non-empty string"}` (400) | The `:id` path segment was empty or non-string. | Include a valid SIM card ID in the URL path. |
| `{"error": "Rate limit exceeded. Please slow down."}` (429) | Too many requests to the Telnyx API. | Add exponential backoff between calls; batch activations where possible. |
| `{"error": "Network error connecting to Telnyx"}` (503) | The server cannot reach `api.telnyx.com`. | Check connectivity, firewall, and the [Telnyx Status Page](https://status.telnyx.com). |
| Connection refused on port 5000 | Server not running, or another process owns the port. | Run `node server.js`; confirm `PORT` and that the port is free. |

## Related Examples

- [activate-sim-card-python](../activate-sim-card-python/) - Same example in Python
- [activate-sim-card-go](../activate-sim-card-go/) - Same example in Go
- [monitor-iot-data-usage-nodejs](../monitor-iot-data-usage-nodejs/) - Track SIM data usage in Node.js
- [provision-esim-python](../provision-esim-python/) - Provision an eSIM

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-sim-card)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)
