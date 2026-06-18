---
name: activate-sim-card
title: "Production-ready Flask application for SIM card activation via Telnyx."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Production-ready Flask application for SIM card activation via Telnyx.

Production-ready Flask application for SIM card activation via Telnyx.


## Telnyx API Endpoints Used

- **SIM Cards: Activate**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api/sim-cards/sim-card-actions)


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
cd telnyx-code-examples/activate-sim-card-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t activate-sim-card .
docker run --env-file .env -p 5000:5000 activate-sim-card
```

## API Reference

### `GET /sim-cards`

Returns all sims.

**Request:**

```bash
curl http://localhost:5000/sim-cards
```

**Response:**

```json
{
  "data": "...",
  "status_code": "..."
}
```

### `GET /sim-cards/<sim_card_id>`

Returns sim details.

**Request:**

```bash
curl http://localhost:5000/sim-cards/example-id
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /sim-cards/<sim_card_id>/activate`

Handles `POST /sim-cards/<sim_card_id>/activate`.

**Request:**

```bash
curl -X POST http://localhost:5000/sim-cards/example-id/activate
```

**Response:**

```json
{
  "message": "...",
  "data": "...",
  "status_code": "..."
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
