# API Reference — Setup SIP Trunk

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sip/setup` | Setup sip endpoint. |

---

## `POST /sip/setup`

Setup sip endpoint.

### Request

```json
{
  "name": "Jane Smith",
  "username": "username-value",
  "password": "password-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `username` | `string` | **yes** | Username |
| `password` | `string` | **yes** | Password |

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
