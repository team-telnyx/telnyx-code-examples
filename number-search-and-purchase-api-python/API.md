# API Reference — Number Search and Purchase API

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/numbers/search` | Search numbers. |
| `POST` | `/numbers/purchase` | Purchase number. |
| `GET` | `/numbers/inventory` | List inventory. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /numbers/search`

Search numbers.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /numbers/purchase`

Purchase number.

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

## `GET /numbers/inventory`

List all inventory.

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
  "purchases": "..."
}
```

---

## Status Values

Records use these status values: `error`, `failed`, `ok`, `ordered`

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
