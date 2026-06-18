---
name: e911-address-validator
title: "E911 Address Validator — validate and provision E911 addresses via API."
description: "Application. Built with Telnyx E911, Migration, Number Porting."
language: python
framework: flask
telnyx_products: [E911, Migration, Number Porting]
---

# E911 Address Validator — validate and provision E911 addresses via API.

Application. Built with Telnyx E911, Migration, Number Porting.

## Telnyx API Endpoints Used

- **List Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

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
     Email notification
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
cd telnyx-code-examples/e911-address-validator-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t e911-address-validator-python .
docker run --env-file .env -p 5000:5000 e911-address-validator-python
```

## API Reference

### `POST /e911/validate`

Triggers validate

```bash
curl -X POST http://localhost:5000/e911/validate \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "verification_id": "ver-abc123",
  "status": "pending",
  "channel": "sms",
  "phone": "+12125551234"
}
```

### `POST /e911/assign`

Triggers assign

```bash
curl -X POST http://localhost:5000/e911/assign \
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

### `GET /e911/addresses`

Returns addresses

```bash
curl http://localhost:5000/e911/addresses
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
