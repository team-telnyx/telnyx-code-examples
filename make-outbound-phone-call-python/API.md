# API Reference — Make Outbound Phone Call

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/dial` | Dial call endpoint. |

---

## `POST /calls/dial`

Dial call endpoint.

### Request

```json
{
  "to": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

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
