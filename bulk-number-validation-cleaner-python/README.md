---
name: bulk-number-validation-cleaner
title: "Bulk Number Validation & Cleaner"
description: "Bulk Number Validation & Cleaner — validate and clean phone number lists via Telnyx Number Lookup API."
language: python
framework: flask
telnyx_products: [Number Lookup]
---

# Bulk Number Validation & Cleaner

Bulk Number Validation & Cleaner — validate and clean phone number lists via Telnyx Number Lookup API.

## Telnyx API Endpoints Used

- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup-number)
- **List Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Lookup
           ├──► Telnyx Number Porting
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
cd telnyx-code-examples/bulk-number-validation-cleaner-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t bulk-number-validation-cleaner-python .
docker run --env-file .env -p 5000:5000 bulk-number-validation-cleaner-python
```

## API Reference

### `POST /validate`

Triggers validate

```bash
curl -X POST http://localhost:5000/validate \
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

### `GET /validate/single/<number>`

Returns number

```bash
curl http://localhost:5000/validate/single/example-id
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

### `GET /jobs`

Returns jobs

```bash
curl http://localhost:5000/jobs
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
