# API Reference — eSIM Provisioning

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /esim/provision`

Submit data to `/esim/provision`.

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
curl -X POST http://localhost:5000/esim/provision \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /esim/:simCardId/activate`

Submit data to `/esim/:simCardId/activate`.

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
curl -X POST http://localhost:5000/esim/:simCardId/activate \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `GET /esim/:simCardId`

Retrieve data from `/esim/:simCardId`.

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
curl http://localhost:5000/esim/:simCardId
```

---

## `GET /esim/group/:simCardGroupId`

Retrieve data from `/esim/group/:simCardGroupId`.

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
curl http://localhost:5000/esim/group/:simCardGroupId
```

---

## `POST /esim/:simCardId/suspend`

Submit data to `/esim/:simCardId/suspend`.

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
curl -X POST http://localhost:5000/esim/:simCardId/suspend \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /webhooks/esim`

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
curl -X POST http://localhost:5000/webhooks/esim \
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
