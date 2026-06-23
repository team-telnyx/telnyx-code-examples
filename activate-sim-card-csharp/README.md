---
name: activate-sim-card
title: "Activate SIM Card"
description: "Enable (activate) a SIM card on the Telnyx network using C# and ASP.NET."
language: csharp
framework: aspnet
telnyx_products: [IoT/SIM]
---

# Activate a SIM Card (C# / .NET)

Production-ready minimal ASP.NET (net8.0) app that enables (activates) a Telnyx SIM card using the official `Telnyx.net` SDK.

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform that runs voice, messaging, SIP, AI, and IoT connectivity on one private, global network. The IoT SIM API lets you provision and control cellular connectivity for your fleet programmatically — enable a SIM the moment a device ships, and it joins the network on Telnyx's own backbone for predictable latency and data pricing.

## Telnyx API Endpoints Used

- **Enable (activate) SIM card**: `POST /v2/sim_cards/{id}/actions/enable` — moves a SIM into the `enabled` state. Called via the SDK as `SimCardsService.EnableAsync(simCardId)`. [API reference](https://developers.telnyx.com/api/wireless/enable-sim-card)
- **Inbound webhook (signature-verified)**: your `POST /webhooks/sim` endpoint receives Telnyx event callbacks (e.g. SIM status changes), verified with Ed25519. [Webhook reference](https://developers.telnyx.com/docs/development/api-guide/receiving-webhooks)

## Architecture

```
  ┌────────────────────────┐
  │ Client / Provisioning   │
  │ system                  │
  └───────────┬────────────┘
              │ POST /sim-cards/{id}/enable
              ▼
  ┌────────────────────────┐        POST /sim_cards/{id}/actions/enable
  │ ASP.NET minimal API     │ ─────────────────────────────────────────▶ Telnyx API
  │ (Program.cs)            │ ◀─────────────────────────────────────────
  │  - SimCardsService      │              SimCardRecord (data)
  │  - Webhook.ConstructEvent│
  └───────────┬────────────┘
              ▲ POST /webhooks/sim
              │ telnyx-signature-ed25519 + telnyx-timestamp
        Telnyx event callbacks
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF...` | **yes** | Telnyx API v2 key | [Portal → API Keys](https://portal.telnyx.com/app/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `o5p...base64...=` | only for `/webhooks/sim` | Account public key used to verify Ed25519 webhook signatures | [Portal → Keys & Credentials](https://portal.telnyx.com) |
| `ASPNETCORE_URLS` | `string` | `http://localhost:5000` | no | Override the bind address/port | — |

Never commit a real `.env` file — only `.env.example` with placeholder values.

## Setup

Local commands only (no Docker or make):

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-csharp
cp .env.example .env            # ← fill in your credentials
dotnet restore                  # restores Telnyx.net 3.1.0 + DotNetEnv 3.1.0
dotnet run                      # starts Kestrel (default http://localhost:5000)
```

## API Reference

### `POST /sim-cards/{id}/enable`

Enable (activate) the SIM card with the given Telnyx SIM card id.

```bash
curl -X POST http://localhost:5000/sim-cards/6b14e151-8493-4fa1-8664-1cc4e6d14158/enable
```

**Response `200 OK`:**

```json
{
  "id": "6b14e151-8493-4fa1-8664-1cc4e6d14158",
  "status": "enabling",
  "message": "SIM card enable requested."
}
```

**Errors:** `400` (missing id), `502` (Telnyx API error), `500` (unexpected error). Error responses return a generic message; details are logged server-side only.

### `POST /webhooks/sim`

Receive a Telnyx webhook. The handler reads the raw body, verifies the `telnyx-signature-ed25519` + `telnyx-timestamp` headers against `TELNYX_PUBLIC_KEY`, and only then processes `data.payload`.

```bash
# Telnyx signs the request; an unsigned/invalid request returns 401.
curl -X POST http://localhost:5000/webhooks/sim \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response `200 OK`** (valid signature):

```json
{ "received": true, "event_type": "sim_card.status.changed" }
```

**Response `401 Unauthorized`** — invalid signature or stale timestamp.

### `GET /health`

```bash
curl http://localhost:5000/health
# {"status":"ok"}
```

See [`API.md`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-csharp/API.md) for the full typed endpoint reference.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Process exits with `FATAL: TELNYX_API_KEY is not set` | `.env` missing or empty | Copy `.env.example` to `.env` and set `TELNYX_API_KEY` |
| `502 Bad Gateway` on enable | Telnyx returned an error (bad SIM id, unauthorized, SIM not registered) | Check the server logs; verify the SIM id and that the key has wireless permissions |
| `NU1101: Unable to find package Telnyx` | Wrong package id | The NuGet id is `Telnyx.net`, not `Telnyx` (already correct in the `.csproj`) |
| `401 Unauthorized` from `/webhooks/sim` | Bad signature or `TELNYX_PUBLIC_KEY` not set/mismatched | Use the account public key from the Portal; ensure the raw body is forwarded unmodified |
| Webhook never arrives | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |

## Related Examples

- [Activate a SIM Card (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md)
- [Activate a SIM Card (Node.js)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md)
- [Activate a SIM Card (Go)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-go/README.md)
- [Monitor IoT Data Usage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md)
- [Provision eSIM (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-python/README.md)

## Resources

- [IoT SIM API guide](https://developers.telnyx.com/docs/wireless/get-started) — dev docs
- [Enable SIM Card API reference](https://developers.telnyx.com/api/wireless/enable-sim-card) — api-reference
- [Telnyx .NET SDK](https://developers.telnyx.com/development/sdk/dotnet) — SDK
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card) — product
- [IoT SIM pricing](https://telnyx.com/pricing/wireless) — pricing
