---
name: porting-order-tracker-dashboard
title: "Porting Order Tracker Dashboard"
description: "Submit, track, and manage number porting orders with SLA monitoring, timeline visualization, and bulk operations."
language: python
framework: flask
telnyx_products: [Number Porting]
---

# Porting Order Tracker Dashboard

Submit, track, and manage number porting orders with SLA monitoring, timeline visualization, and bulk operations.

## Telnyx API Endpoints Used

- **List Porting Orders**: `GET /v2/porting_orders` - [API reference](https://developers.telnyx.com/api/porting/list-porting-orders)
- **Retrieve Porting Order**: `GET /v2/porting_orders/{id}` - [API reference](https://developers.telnyx.com/api/porting/get-porting-order)

## Architecture

```
  Porting Webhook
        │
        ▼
  ┌──────────────────┐
  │ Your App          │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ├──► A/B testing
           │
           ▼
     JSON response
```

## Telnyx Webhook Events

This app handles these webhook events:

- `porting_order.status_changed` -- Porting order status updated (FOC date set, completed, rejected)
- `number_order.complete` -- Phone number order completed and ready to use

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `ALERT_WEBHOOK` | `string` | `your_value` | **yes** | Alert webhook | - |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/porting-order-tracker-dashboard-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`
   - **Messaging Profile** → Inbound Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

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

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Branded Caller Id Manager (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md)
- [Build Conference Calling (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md)
- [Build IVR Phone Menu (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md)
- [Bulk Number Validation Cleaner (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md)
- [Call Analytics Dashboard Api (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
