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

## `GET /esim/:sim_card_id/status`

Retrieve data from `/esim/:sim_card_id/status`.

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
curl http://localhost:5000/esim/:sim_card_id/status
```

---

## `POST /esim/:sim_card_id/activate`

Submit data to `/esim/:sim_card_id/activate`.

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
curl -X POST http://localhost:5000/esim/:sim_card_id/activate \
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
