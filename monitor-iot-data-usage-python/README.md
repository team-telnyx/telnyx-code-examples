---
name: monitor-iot-data-usage
title: "Production-ready Flask application for monitoring SIM card"
description: "Production-ready Flask application for monitoring SIM card data usage via Telnyx IoT API."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Production-ready Flask application for monitoring SIM card

Production-ready Flask application for monitoring SIM card data usage via Telnyx IoT API.

## Telnyx API Endpoints Used

- **SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

## Telnyx Webhook Events

This app handles these webhook events:

- `sim_card.data_limit.reached` — SIM card data usage limit reached
- `sim_card.status.changed` — SIM card status changed (active, suspended, etc.)

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

  State: Database
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `DATA_LIMIT_THRESHOLD_MB` | `string` | `500` | no | Data limit threshold mb | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t monitor-iot-data-usage-python .
docker run --env-file .env -p 5000:5000 monitor-iot-data-usage-python
```

## API Reference

### `GET /health`

Health check endpoint for monitoring infrastructure.

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

### `GET /sim-cards`

List all SIM cards in the account.

```bash
curl http://localhost:5000/sim-cards
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

### `GET /sim-cards/<sim_card_id>`

Retrieve details for a specific SIM card.

```bash
curl http://localhost:5000/sim-cards/example-id
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

### `GET /sim-cards/<sim_card_id>/usage`

Get data usage metrics for a specific SIM card.

```bash
curl http://localhost:5000/sim-cards/example-id/usage
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

### `GET /sim-cards/<sim_card_id>/health`

Get comprehensive health status for a SIM card.

```bash
curl http://localhost:5000/sim-cards/example-id/health
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

### `POST /sim-cards/<sim_card_id>/activate`

Activate a SIM card.

```bash
curl -X POST http://localhost:5000/sim-cards/example-id/activate \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

## Webhook Endpoints

### `POST /webhooks/sim-events`

Receives Telnyx webhook events for `/webhooks/sim-events`.

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
