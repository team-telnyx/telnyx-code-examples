# API Reference — Commercial Voice-Over Generator

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/commercials/generate` | Generate commercial. |
| `GET` | `/commercials/<campaign_id>` | Get campaign. |
| `GET` | `/commercials` | List campaigns. |
| `GET` | `/options` | List options. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /commercials/generate`

Generate commercial.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | `string` | no | Product |
| `audience` | `string` | no | Audience |
| `tone` | `string` | no | Tone |
| `length` | `string` | no | Length |
| `cta` | `string` | no | Cta |
| `client_phone` | `string` | no | Client phone |

### Response `200`

```json
{"error": "Provide "product" name/description"}
```

---

## `GET /commercials/<campaign_id>`

Get a specific campaign by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /commercials`

List all campaigns.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /options`

List all options.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `complete`, `failed`, `ok`, `rendering`, `writing`

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
