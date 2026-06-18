---
name: track-iot-device-location
title: "Production-ready Flask application for device location"
description: "Production-ready Flask application for device location tracking via Telnyx IoT API."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting, Verify]
---

# Production-ready Flask application for device location

Production-ready Flask application for device location tracking via Telnyx IoT API.

## Telnyx API Endpoints Used

- **SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

## Architecture

```
  ┌──────────────┐
  │ IoT Device Event │
  │ (SIM/sensor)  │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ Process      │ ── threshold check
  └──────┬───────┘
         │
         ▼
    JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t track-iot-device-location-python .
docker run --env-file .env -p 5000:5000 track-iot-device-location-python
```

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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
