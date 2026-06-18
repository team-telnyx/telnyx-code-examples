# API Reference — Abandoned Cart Recovery

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/shopify/cart-abandoned` | Receives Telnyx webhook events. |
| `POST` | `/recovery/run-sms` | Run sms recovery. |
| `POST` | `/recovery/run-calls` | Run call recovery. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/carts` | List carts. |
| `POST` | `/webhooks/shopify/order-created` | Receives Telnyx webhook events. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/shopify/cart-abandoned`

Receives Telnyx webhook events.

---

## `POST /recovery/run-sms`

Run sms recovery.

### Response `200`

```json
{"results": results}
```

---

## `POST /recovery/run-calls`

Run call recovery.

### Response `200`

```json
{"results": results}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

### Events Handled

| Event | Action |
|-------|--------|
| `call.answered` | Begins interaction (TTS greeting or gather) |
| `call.speak.ended` | TTS finished — transitions to gather or next step |
| `call.gather.ended` | Input received — processes customer response |

---

## `GET /carts`

List all carts.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/shopify/order-created`

Receives Telnyx webhook events.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `call_initiated`, `ok`, `queued`, `sms_sent`

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
