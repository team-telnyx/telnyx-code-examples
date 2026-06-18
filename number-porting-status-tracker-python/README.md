---
name: number-porting-status-tracker
title: "Number Porting Status Tracker"
description: "Number Porting Status Tracker — track porting orders with status webhooks and SMS alerts."
language: python
framework: flask
telnyx_products: [SMS/MMS]
---

# Number Porting Status Tracker

Number Porting Status Tracker — track porting orders with status webhooks and SMS alerts.

## Telnyx API Endpoints Used

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Porting Orders**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)

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

## Telnyx Webhook Events

This app handles these webhook events:

- `porting_order.status_changed` -- Porting order status updated (FOC date set, completed, rejected)
- `number_order.complete` -- Phone number order completed and ready to use

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `ALERT_NUMBER` | `string` | `your_value` | **yes** | Alert number | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/number-porting-status-tracker-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t number-porting-status-tracker-python .
docker run --env-file .env -p 5000:5000 number-porting-status-tracker-python
```

## API Reference

### `GET /ports/list`

Returns list

```bash
curl http://localhost:5000/ports/list
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

### `POST /ports/create`

Triggers create

```bash
curl -X POST http://localhost:5000/ports/create \
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

### `GET /ports/<order_id>`

Returns order id

```bash
curl http://localhost:5000/ports/example-id
```

**Response:**

```json
{
  "orders": [
    {
      "id": "ORD-12345",
      "status": "shipped",
      "tracking": "1Z999AA10123456784",
      "estimated_delivery": "2026-07-18"
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

## Webhook Endpoints

### `POST /webhooks/porting`

Receives Telnyx webhook events for `/webhooks/porting`.

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
