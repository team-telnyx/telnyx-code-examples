# API Reference — Porting LOA Automation

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/loa/generate` | Generate loa. |
| `POST` | `/loa/submit-and-port` | Submit and port. |
| `POST` | `/loa/check-portability` | Check portability. |
| `GET` | `/loa` | List loas. |
| `GET` | `/pipeline` | Pipeline status. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /loa/generate`

Generate loa.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `authorized_person` | `string` | no | Authorized person |
| `current_provider` | `string` | no | Current provider |
| `phone_numbers` | `array` | no | Phone numbers |
| `billing_number` | `string` | no | Billing number |
| `account_number` | `string` | no | Account number |
| `service_address` | `string` | no | Service address |
| `title` | `string` | no | Title |
| `company` | `string` | no | Company |
| `authorized_person` | `string` | **yes** | Authorized person |
| `phone_numbers` | `array` | no | Phone numbers |
| `current_provider` | `string` | **yes** | Current provider |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /loa/submit-and-port`

Submit and port.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_numbers` | `array` | no | Phone numbers |
| `authorized_person` | `string` | **yes** | Authorized person |
| `current_provider` | `string` | **yes** | Current provider |
| `billing_number` | `string` | **yes** | Billing number |
| `phone_numbers` | `string` | **yes** | Phone numbers |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /loa/check-portability`

Check portability.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_numbers` | `array` | no | Phone numbers |

### Response `200`

```json
{"results": results}
```

---

## `GET /loa`

List all loas.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /pipeline`

Pipeline status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "loas": "...",
  "porting": "..."
}
```

---

## Status Values

Records use these status values: `generated`, `ok`, `submitted`

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
