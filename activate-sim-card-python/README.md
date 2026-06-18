---
name: activate-sim-card
title: "Production-ready Flask application for SIM card activation via Telnyx."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Production-ready Flask application for SIM card activation via Telnyx.

Application. Built with Telnyx IoT/SIM, Migration, Number Porting.

## Telnyx API Endpoints Used

- **List SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)
- **Retrieve SIM Card**: `GET /v2/sim_cards/{id}` — [API reference](https://developers.telnyx.com/api/sim-cards/get-sim-card)
- **Activate SIM Card**: `PATCH /v2/sim_cards/{id}` — [API reference](https://developers.telnyx.com/api/sim-cards/update-sim-card)

## Architecture

```
  ┌──────────────┐
  │ API Request  │
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
cd telnyx-code-examples/activate-sim-card-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t activate-sim-card-python .
docker run --env-file .env -p 5000:5000 activate-sim-card-python
```

## API Reference

### `GET /sim-cards`

HTTP endpoint to list all SIM cards.

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

HTTP endpoint to retrieve a single SIM card.

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

### `POST /sim-cards/<sim_card_id>/activate`

HTTP endpoint to activate a SIM card.

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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
