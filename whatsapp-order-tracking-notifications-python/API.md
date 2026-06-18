# API Reference — WhatsApp Order Tracking Notifications

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/orders` | Create a new order. |
| `PUT` | `/orders/<order_id>/status` | Update status. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /orders`

Create a new order.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `string` | no | Order identifier |
| `customer_phone` | `string` | **yes** | Customer phone |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `PUT /orders/<order_id>/status`

Update status.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | **yes** | Current status value |
| `tracking_number` | `string` | **yes** | Tracking number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "orders": "..."
}
```

---

## Status Values

Records use these status values: `confirmed`, `created`, `ignored`, `ok`, `responded`

## Error Handling

All endpoints return JSON. On error:

```json
{ "status": "ok", "data": { } }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
