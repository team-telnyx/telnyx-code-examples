# API Reference — Warm Transfer

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /warm-transfer/initiate`

Submit data to `/warm-transfer/initiate`.

### Request

```json
{
  "example": "see source code for full schema"
}
```

### Response `200`

```json
{
  "status": "ok"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/warm-transfer/initiate \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /warm-transfer/complete`

Submit data to `/warm-transfer/complete`.

### Request

```json
{
  "example": "see source code for full schema"
}
```

### Response `200`

```json
{
  "status": "ok"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/warm-transfer/complete \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /warm-transfer/cancel`

Submit data to `/warm-transfer/cancel`.

### Request

```json
{
  "example": "see source code for full schema"
}
```

### Response `200`

```json
{
  "status": "ok"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/warm-transfer/cancel \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /webhooks/call-events`

Inbound webhook endpoint called by Telnyx when an event occurs.

### Request

```json
{
  "example": "see source code for full schema"
}
```

### Response `200`

```json
{
  "status": "ok"
}
```

### Try it

```bash
curl -X POST http://localhost:5000/webhooks/call-events \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Error Handling

All endpoints return JSON. On error:

```json
{"error": "Description of what went wrong"}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `401` | Invalid API key or webhook signature |
| `429` | Rate limit exceeded |
| `500` | Server error |
| `503` | Upstream network error talking to Telnyx |
