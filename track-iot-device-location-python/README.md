---
name: track-iot-device-location
title: "Track IoT Device Location"
description: "Production-ready Flask application for device location tracking via Telnyx IoT API."
language: python
framework: flask
telnyx_products: [IoT/SIM, Verify]
---

# Production-ready Flask application for device location

Production-ready Flask application for device location tracking via Telnyx IoT API.

## Telnyx API Endpoints Used

- **SIM Cards**: `GET /v2/sim_cards` - [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ Telnyx IoT API    │
  │ • Query SIM       │
  │ • Get cell tower  │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Location Mapping  │
  │ • Lat/long        │
  │ • Geofence check  │
  └────────┬─────────┘
           │
           ▼
  JSON response
  (location + alerts)
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
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


## API Reference

### `GET /devices`

List all SIM cards (devices) in the account.

```bash
curl http://localhost:5000/devices
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /devices/<sim_card_id>`

Retrieve device location and network information for a specific SIM card.

```bash
curl http://localhost:5000/devices/example-id
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /devices/<sim_card_id>/location`

Retrieve only location information for a device (lightweight endpoint).

```bash
curl http://localhost:5000/devices/example-id/location
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /health`

Health check endpoint to verify API connectivity.

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Activate Sim Card (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md)
- [IoT Fleet Alert Escalation (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-fleet-alert-escalation-python/README.md)
- [IoT Panic Button Voice Alert (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-panic-button-voice-alert-python/README.md)
- [IoT Smart Building Voice Control (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-smart-building-voice-control-python/README.md)
- [Monitor IoT Data Usage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
