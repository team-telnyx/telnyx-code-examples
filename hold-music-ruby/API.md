# API Reference — Hold Music

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

## `POST /calls/:call_control_id/hold`

Submit data to `/calls/:call_control_id/hold`.

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
curl -X POST http://localhost:5000/calls/:call_control_id/hold \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /calls/:call_control_id/resume`

Submit data to `/calls/:call_control_id/resume`.

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
curl -X POST http://localhost:5000/calls/:call_control_id/resume \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /calls/:call_control_id/hangup`

Submit data to `/calls/:call_control_id/hangup`.

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
curl -X POST http://localhost:5000/calls/:call_control_id/hangup \
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

## `GET /calls`

Retrieve data from `/calls`.

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
curl http://localhost:5000/calls
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
