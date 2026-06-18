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

- **SIM Cards: Activate**: `POST /v2/sim_cards/{id}/actions/enable` — [API reference](https://developers.telnyx.com/api/sim-cards/sim-card-actions)
- **Call Control: Whisper**: `POST /v2/calls/{id}/actions/bridge` — [API reference](https://developers.telnyx.com/api/call-control/bridge-call)


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
| `DATA_LIMIT_THRESHOLD_MB` | `integer` | `500` | no | data limit threshold mb | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

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
docker build -t monitor-iot-data-usage .
docker run --env-file .env -p 5000:5000 monitor-iot-data-usage
```

## API Reference

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
  "count": 3,
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

### `GET /sim-cards/<sim_card_id>/usage`

Returns usage details.

**Request:**

```bash
curl http://localhost:5000/sim-cards/example-id/usage
```

**Response:**

```json
{
  "usage": [
    "..."
  ]
}
```

### `GET /sim-cards/<sim_card_id>/health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/sim-cards/example-id/health
```

**Response:**

```json
{
  "status": "ok"
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
  "id": "...",
  "status": "ok",
  "message": "...",
  "status_code": "..."
}
```

## Webhook Endpoints

### `POST /webhooks/sim-events`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
