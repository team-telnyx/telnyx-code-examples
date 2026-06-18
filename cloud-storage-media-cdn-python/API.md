# API Reference — Cloud Storage Media CDN

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/setup` | Setup bucket. |
| `POST` | `/upload` | Upload media. |
| `GET` | `/media` | List media. |
| `GET` | `/media/<category>/<name>` | Get media url. |
| `GET` | `/ivr-config` | Ivr config. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /setup`

Setup bucket.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /upload`

Upload media.

### Request

```json
{
  "category": "category-value",
  "name": "Jane Smith",
  "url": "url-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | `string` | no | Category |
| `name` | `string` | **yes** | Display name or label |
| `url` | `string` | **yes** | URL to process |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /media`

List all media.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /media/<category>/<name>`

Get media url.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /ivr-config`

Ivr config.

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

Records use these status values: `bucket_created`, `ok`, `uploaded`

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
