---
name: wireless-fleet-activation-portal
title: "Wireless Fleet Activation Portal — bulk activate SIMs with status tracking."
description: "Application. Built with Telnyx IoT/SIM, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [IoT/SIM, Migration, Number Porting]
---

# Wireless Fleet Activation Portal — bulk activate SIMs with status tracking.

Application. Built with Telnyx IoT/SIM, Migration, Number Porting.

## Telnyx API Endpoints Used

- **SIM Cards**: `GET /v2/sim_cards` — [API reference](https://developers.telnyx.com/api/sim-cards/list-sim-cards)

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
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/wireless-fleet-activation-portal-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t wireless-fleet-activation-portal-python .
docker run --env-file .env -p 5000:5000 wireless-fleet-activation-portal-python
```

## API Reference

### `GET /sims`

Returns sims

```bash
curl http://localhost:5000/sims
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

### `POST /sims/activate`

Triggers activate

```bash
curl -X POST http://localhost:5000/sims/activate \
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

### `POST /sims/deactivate`

Triggers deactivate

```bash
curl -X POST http://localhost:5000/sims/deactivate \
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

### `GET /activation-log`

Returns activation-log

```bash
curl http://localhost:5000/activation-log
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

Returns health

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
