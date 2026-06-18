# API Reference — Number Lookup Lead Enrichment

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/enrich` | Enrich lead. |
| `POST` | `/enrich/bulk` | Enrich bulk. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /enrich`

Enrich lead.

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

## `POST /enrich/bulk`

Enrich bulk.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_numbers` | `array` | no | Phone numbers |

### Response `200`

```json
{"results": results, "total": "..."}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "enriched": "..."
}
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
