---
name: porting-order-tracker-dashboard
title: "Porting Order Tracker Dashboard â submit, track, and"
description: "Porting Order Tracker Dashboard â submit, track, and manage porting orders with SLA monitoring, timeline visualization, and bulk operations."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# Porting Order Tracker Dashboard â submit, track, and

Porting Order Tracker Dashboard â submit, track, and manage porting orders with SLA monitoring, timeline visualization, and bulk operations.

## Telnyx API Endpoints Used

- **List Porting Orders**: `GET /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/list-porting-orders)
- **Retrieve Porting Order**: `GET /v2/porting_orders/{id}` — [API reference](https://developers.telnyx.com/api/porting/get-porting-order)

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
| `ALERT_WEBHOOK` | `string` | `your_value` | **yes** | Alert webhook | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/porting-order-tracker-dashboard-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t porting-order-tracker-dashboard-python .
docker run --env-file .env -p 5000:5000 porting-order-tracker-dashboard-python
```

## API Reference

### `POST /porting/orders`

Triggers orders

```bash
curl -X POST http://localhost:5000/porting/orders \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD-12345",
    "phone": "+12125551234"
  }'
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

### `POST /porting/bulk`

Triggers bulk

```bash
curl -X POST http://localhost:5000/porting/bulk \
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

### `GET /porting/orders`

Returns orders

```bash
curl http://localhost:5000/porting/orders
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

### `GET /porting/sla-check`

Returns sla-check

```bash
curl http://localhost:5000/porting/sla-check
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

### `GET /porting/dashboard`

Returns dashboard

```bash
curl http://localhost:5000/porting/dashboard
```

**Response:**

```json
{
  "period": "2026-07-15",
  "total_calls": 1247,
  "avg_duration_seconds": 186,
  "inbound": 823,
  "outbound": 424,
  "peak_hour": "14:00",
  "cost_usd": 42.18
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
