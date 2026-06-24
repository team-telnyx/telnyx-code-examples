# API Reference — Scheduled SMS

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /sms/schedule`

Submit data to `/sms/schedule`.

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
curl -X POST http://localhost:5000/sms/schedule \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `GET /sms/scheduled/{id}`

Retrieve data from `/sms/scheduled/{id}`.

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
curl http://localhost:5000/sms/scheduled/{id}
```

---

## `GET /sms/scheduled`

Retrieve data from `/sms/scheduled`.

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
curl http://localhost:5000/sms/scheduled
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
