# API Reference — Voicemail

All endpoints accept and return JSON. Base URL in local development: `http://localhost:5000`.

---

## `GET /api/voicemail`

Retrieve data from `/api/voicemail`.

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
curl http://localhost:5000/api/voicemail
```

---

## `POST /initiate`

Submit data to `/initiate`.

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
curl -X POST http://localhost:5000/initiate \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /{callControlId}/start-recording`

Submit data to `/{callControlId}/start-recording`.

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
curl -X POST http://localhost:5000/{callControlId}/start-recording \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /{callControlId}/stop-recording`

Submit data to `/{callControlId}/stop-recording`.

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
curl -X POST http://localhost:5000/{callControlId}/stop-recording \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /{callControlId}/hangup`

Submit data to `/{callControlId}/hangup`.

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
curl -X POST http://localhost:5000/{callControlId}/hangup \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## `POST /webhooks/voice`

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
curl -X POST http://localhost:5000/webhooks/voice \
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
