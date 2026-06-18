# API Reference — Verify Phone Number OTP Flow

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/verify/start` | Start verification. |
| `POST` | `/verify/voice-fallback` | Voice fallback. |
| `POST` | `/verify/check` | Check verification. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /verify/start`

Start verification.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /verify/voice-fallback`

Voice fallback.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /verify/check`

Check verification.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |
| `code` | `string` | **yes** | Code |

### Response `200`

```json
{
  "status": "verified"
}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "verifications": "..."
}
```

---

## Status Values

Records use these status values: `invalid_code`, `ok`, `pending`, `sent`, `verified`, `voice_sent`

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
