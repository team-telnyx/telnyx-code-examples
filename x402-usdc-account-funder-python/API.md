# API Reference — x402 USDC Account Funder

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quote` | Get quote. |
| `POST` | `/pay` | Submit payment. |
| `GET` | `/balance` | Get balance. |
| `GET` | `/info` | Payment info. |
| `GET` | `/quotes` | List quotes. |
| `GET` | `/payments` | List payments. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /quote`

Get a specific quote by ID.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount_usd` | `string` | no | Amount usd |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /pay`

Submit payment.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | `string` | **yes** | Quote id |
| `payment_signature` | `string` | **yes** | Payment signature |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /balance`

Get a specific balance by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /info`

Payment info.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /quotes`

List all quotes.

### Response `200`

```json
{"quotes": quotes[-20:]}
```

---

## `GET /payments`

List all payments.

### Response `200`

```json
{"payments": payments[-20:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "quotes": "...",
  "payments": "..."
}
```

---

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
