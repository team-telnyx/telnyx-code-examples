# API Reference — E911 Address Validator — validate and provision E911 addresses via API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/e911/validate` | Validate address. |
| `POST` | `/e911/assign` | Assign e911. |
| `GET` | `/e911/addresses` | List addresses. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /e911/validate`

Validate address.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `street` | `string` | **yes** | Street |
| `street2` | `string` | no | Street2 |
| `city` | `string` | **yes** | City |
| `state` | `string` | **yes** | State |
| `zip` | `string` | **yes** | Zip |
| `country` | `string` | no | Country |
| `business_name` | `string` | no | Business name |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /e911/assign`

Assign e911.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_number` | `string` | **yes** | Phone number |
| `address_id` | `string` | **yes** | Address id |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /e911/addresses`

List all addresses.

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
  "addresses": "..."
}
```

---

## Status Values

Records use these status values: `assigned`, `ok`

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
