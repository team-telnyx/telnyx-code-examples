# API Reference — Production-ready OTP 2FA system with Flask and Telnyx SMS.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/request-otp` | Request otp. |
| `POST` | `/auth/verify-otp` | Verify otp endpoint. |
| `GET` | `/auth/otp-status` | Otp status. |

---

## `POST /auth/request-otp`

Request otp.

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

## `POST /auth/verify-otp`

Verify otp endpoint.

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
{ "status": "ok", "data": { } }
```

---

## `GET /auth/otp-status`

Otp status.

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
