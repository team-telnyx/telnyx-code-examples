---
name: provision-esim
title: "Production-ready Flask application for eSIM provisioning via Telnyx."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Production-ready Flask application for eSIM provisioning via Telnyx.

Application. Built with Telnyx IoT/SIM, Migration, Number Porting.

## Telnyx API Endpoints Used

- **Create SIM Card (eSIM)**: `POST /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/create-sim-card)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` — [API reference](https://developers.telnyx.com/api/sim-cards/get-sim-card)
- **List SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

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

## Telnyx Webhook Events

This app handles these webhook events:

- `sim_card.status.changed` -- SIM card status changed (active, suspended, deactivated)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t provision-esim-python .
docker run --env-file .env -p 5000:5000 provision-esim-python
```

## API Reference

### `POST /esim/profiles`

Provision a new eSIM profile.

```bash
curl -X POST http://localhost:5000/esim/profiles \
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

### `POST /esim/profiles/<sim_card_id>/activate`

Activate an eSIM profile for network connectivity.

```bash
curl -X POST http://localhost:5000/esim/profiles/example-id/activate \
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

### `GET /esim/profiles/<sim_card_id>`

Retrieve details of an eSIM profile.

```bash
curl http://localhost:5000/esim/profiles/example-id
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

### `GET /esim/profiles`

List eSIM profiles with optional filtering.

```bash
curl http://localhost:5000/esim/profiles
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

Health check endpoint.

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

## Webhook Endpoints

### `POST /esim/webhooks/sim-status`

Receives Telnyx webhook events for `/esim/webhooks/sim-status`.

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
