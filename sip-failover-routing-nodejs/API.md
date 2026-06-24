# API Reference — Failover Routing

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `POST /sip/connections/setup`

Submit data to `/sip/connections/setup`.

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
curl -X POST http://localhost:5000/sip/connections/setup \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `GET /sip/connections`

Retrieve data from `/sip/connections`.

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
curl http://localhost:5000/sip/connections
```

---

## `GET /sip/failover/status`

Retrieve data from `/sip/failover/status`.

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
curl http://localhost:5000/sip/failover/status
```

---

## `POST /sip/failover/health-check`

Health check endpoint.

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
curl -X POST http://localhost:5000/sip/failover/health-check \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /webhooks/sip`

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
curl -X POST http://localhost:5000/webhooks/sip \
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
