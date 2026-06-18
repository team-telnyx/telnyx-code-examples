---
name: number-search-and-purchase-api
title: "Number Search and Purchase API"
description: "Number Search and Purchase API — search, filter, and buy phone numbers programmatically."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Numbers]
---

# Number Search and Purchase API

Number Search and Purchase API — search, filter, and buy phone numbers programmatically.


## Telnyx API Endpoints Used

- **Phone Numbers**: `GET /v2/available_phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)


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

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-search-and-purchase-api-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t number-search-and-purchase-api .
docker run --env-file .env -p 5000:5000 number-search-and-purchase-api
```

## API Reference

### `GET /numbers/search`

Handles `GET /numbers/search`.

**Request:**

```bash
curl http://localhost:5000/numbers/search
```

**Response:**

```json
{
  "numbers": "...",
  "number": "...",
  "features": "...",
  "cost": "..."
}
```

### `POST /numbers/purchase`

Handles `POST /numbers/purchase`.

**Request:**

```bash
curl -X POST http://localhost:5000/numbers/purchase \
  -H "Content-Type: application/json" \
  -d '{
  "phone_numbers": "[]"
}'
```

**Response:**

```json
{
  "results": "..."
}
```

### `GET /numbers/inventory`

Returns all inventory.

**Request:**

```bash
curl http://localhost:5000/numbers/inventory
```

**Response:**

```json
{
  "inventory": [
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
