---
name: smart-number-geo-assignment
title: "Smart Number Geo-Assignment"
description: "Smart Number Geo-Assignment — automatically purchase and assign local numbers based on caller geography to maximize answer rates."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Numbers]
---

# Smart Number Geo-Assignment

Smart Number Geo-Assignment — automatically purchase and assign local numbers based on caller geography to maximize answer rates.

## Telnyx API Endpoints Used

- **Search Available Numbers**: `GET /v2/available_phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **Create Number Order**: `POST /v2/number_orders` — [API reference](https://developers.telnyx.com/api/numbers/create-number-order)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ▼
     JSON API response

  State: Redis cache
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
cd telnyx-code-examples/smart-number-geo-assignment-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t smart-number-geo-assignment-python .
docker run --env-file .env -p 5000:5000 smart-number-geo-assignment-python
```

## API Reference

### `POST /assign`

Triggers assign

```bash
curl -X POST http://localhost:5000/assign \
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

### `POST /lookup-and-assign`

Triggers lookup-and-assign

```bash
curl -X POST http://localhost:5000/lookup-and-assign \
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

### `GET /inventory`

Returns inventory

```bash
curl http://localhost:5000/inventory
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

### `GET /assignments`

Returns assignments

```bash
curl http://localhost:5000/assignments
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
