# API Reference — Failover Routing

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

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

## `GET /sip/connections/:id`

Retrieve data from `/sip/connections/:id`.

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
curl http://localhost:5000/sip/connections/:id
```

---

## `POST /sip/failover`

Submit data to `/sip/failover`.

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
curl -X POST http://localhost:5000/sip/failover \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /sip/failback`

Submit data to `/sip/failback`.

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
curl -X POST http://localhost:5000/sip/failback \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `GET /sip/status`

Retrieve data from `/sip/status`.

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
curl http://localhost:5000/sip/status
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
