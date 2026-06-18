# API Reference — Porting Order Tracker Dashboard

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/porting/orders` | Submit order. |
| `POST` | `/porting/bulk` | Bulk submit. |
| `GET` | `/porting/orders` | List orders. |
| `POST` | `/webhooks/porting` | Receives Telnyx porting status webhook events. |
| `GET` | `/porting/sla-check` | Sla check. |
| `GET` | `/porting/dashboard` | Dashboard. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /porting/orders`

Submit order.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_numbers` | `array` | no | Phone numbers |
| `authorized_person` | `string` | **yes** | Authorized person |
| `current_provider` | `string` | **yes** | Current provider |
| `billing_phone_number` | `string` | **yes** | Billing phone number |
| `reference` | `string` | no | Reference |
| `phone_numbers` | `string` | **yes** | Phone numbers |
| `phone_numbers` | `array` | no | Phone numbers |
| `current_provider` | `string` | **yes** | Current provider |

### Response `200`

```json
{"order": order, "api": result}
```

---

## `POST /porting/bulk`

Bulk submit.

### Request

```json
{
  "batches": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `batches` | `array` | no | Batches |

### Response `200`

```json
{"submitted": "...", "results": results}
```

---

## `GET /porting/orders`

List all orders.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/porting`

Receives Telnyx porting status webhook events.

---

## `GET /porting/sla-check`

Sla check.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /porting/dashboard`

Dashboard.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

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

Records use these status values: `error`, `ok`, `received`, `submitted`

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
