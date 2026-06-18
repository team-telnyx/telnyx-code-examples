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

- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)
- **Porting Orders**: `POST /v2/porting_orders` — [API reference](https://developers.telnyx.com/api/porting/create-porting-order)


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
| `ALERT_WEBHOOK` | `string` | `https://...` | no | alert webhook | — |

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
docker build -t porting-order-tracker-dashboard .
docker run --env-file .env -p 5000:5000 porting-order-tracker-dashboard
```

## API Reference

### `POST /porting/orders`

Handles `POST /porting/orders`.

**Request:**

```bash
curl -X POST http://localhost:5000/porting/orders \
  -H "Content-Type: application/json" \
  -d '{
  "phone_numbers": "[]",
  "authorized_person": "example_value",
  "current_provider": "abc-123",
  "billing_phone_number": "+12125551234",
  "reference": "example_value"
}'
```

**Response:**

```json
{
  "order": "...",
  "api": "..."
}
```

### `POST /porting/bulk`

Handles `POST /porting/bulk`.

**Request:**

```bash
curl -X POST http://localhost:5000/porting/bulk \
  -H "Content-Type: application/json" \
  -d '{
  "batches": "[]"
}'
```

**Response:**

```json
{
  "submitted": "...",
  "results": "..."
}
```

### `GET /porting/orders`

Returns all orders.

**Request:**

```bash
curl http://localhost:5000/porting/orders
```

**Response:**

```json
{
  "local": "..."
}
```

### `GET /porting/sla-check`

Handles `GET /porting/sla-check`.

**Request:**

```bash
curl http://localhost:5000/porting/sla-check
```

**Response:**

```json
{
  "breaches": "...",
  "sla_config": "..."
}
```

### `GET /porting/dashboard`

Returns dashboard data.

**Request:**

```bash
curl http://localhost:5000/porting/dashboard
```

**Response:**

```json
{
  "total_orders": 3,
  "by_status": "...",
  "by_provider": "...",
  "sla_breaches": "...",
  "recent_updates": "..."
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

## Webhook Endpoints

### `POST /webhooks/porting`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
