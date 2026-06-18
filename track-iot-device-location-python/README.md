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

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

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
docker build -t track-iot-device-location .
docker run --env-file .env -p 5000:5000 track-iot-device-location
```

## API Reference

### `GET /devices`

Returns all devices.

**Request:**

```bash
curl http://localhost:5000/devices
```

**Response:**

```json
{
  "devices": "..."
}
```

### `GET /devices/<sim_card_id>`

Returns device location details.

**Request:**

```bash
curl http://localhost:5000/devices/example-id
```

**Response:**

```json
{
  "device_location": [
    "..."
  ]
}
```

### `GET /devices/<sim_card_id>/location`

Returns location only details.

**Request:**

```bash
curl http://localhost:5000/devices/example-id/location
```

**Response:**

```json
{
  "location_only": [
    "..."
  ]
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
