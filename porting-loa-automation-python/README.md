---
name: porting-loa-automation
title: "Porting LOA Automation"
description: "Porting LOA Automation — automate Letter of Authorization generation and porting order submission."
language: python
framework: flask
telnyx_products: [Migration, Missions, Number Porting]
---

# Porting LOA Automation

Porting LOA Automation — automate Letter of Authorization generation and porting order submission.

## Telnyx API Endpoints Used

- **Create Porting Order**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)
- **List Porting Orders**: `GET /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/list-porting-orders)
- **Upload LOA**: `POST /v2/porting_orders/{id}/loa` — [API reference](https://developers.telnyx.com/api/porting/upload-loa)

## Architecture

```
  Source Platform
        │
        ▼
  ┌─────────────┐
  │ Audit       │ ── inventory numbers, configs, profiles
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │ Map & Plan  │ ── match source features to Telnyx equivalents
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     ┌─────────────────┐
  │ Provision   │────►│ Telnyx Platform  │
  │ on Telnyx   │     │ (numbers, SIP,   │
  └──────┬──────┘     │  messaging)      │
         │            └─────────────────┘
         ▼
  Migration Report
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
cd telnyx-code-examples/porting-loa-automation-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t porting-loa-automation-python .
docker run --env-file .env -p 5000:5000 porting-loa-automation-python
```

## API Reference

### `POST /loa/generate`

Triggers generate

```bash
curl -X POST http://localhost:5000/loa/generate \
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

### `POST /loa/submit-and-port`

Triggers submit-and-port

```bash
curl -X POST http://localhost:5000/loa/submit-and-port \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "porting_orders": [
    {
      "id": "port-abc123",
      "numbers": ["+12125551234"],
      "status": "submitted",
      "target_date": "2026-07-22"
    }
  ]
}
```

### `POST /loa/check-portability`

Triggers check-portability

```bash
curl -X POST http://localhost:5000/loa/check-portability \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125551234",
    "channel": "sms"
  }'
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

### `GET /loa`

Returns loa

```bash
curl http://localhost:5000/loa
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

### `GET /pipeline`

Returns pipeline

```bash
curl http://localhost:5000/pipeline
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
