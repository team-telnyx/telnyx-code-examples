# API Reference — Call Analytics

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /calls/initiate`

Submit data to `/calls/initiate`.

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
curl -X POST http://localhost:5000/calls/initiate \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /webhooks/call`

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
curl -X POST http://localhost:5000/webhooks/call \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `GET /analytics/calls`

Retrieve data from `/analytics/calls`.

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
curl http://localhost:5000/analytics/calls
```

---

## `GET /analytics/summary`

Retrieve data from `/analytics/summary`.

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
curl http://localhost:5000/analytics/summary
```

---

## `GET /analytics/calls/:call_control_id`

Retrieve data from `/analytics/calls/:call_control_id`.

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
curl http://localhost:5000/analytics/calls/:call_control_id
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
