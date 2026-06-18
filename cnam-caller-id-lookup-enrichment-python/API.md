# API Reference — CNAM Caller ID Lookup Enrichment

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/lookup/<number>` | Lookup number. |
| `POST` | `/lookup/batch` | Batch lookup. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/enrichments` | List enrichments. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /lookup/<number>`

Lookup number.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /lookup/batch`

Batch lookup.

### Request

```json
{
  "numbers": [
    "+12125559999"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `numbers` | `array` | no | List of phone numbers |

### Response `200`

```json
{"results": results, "total": "..."}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /enrichments`

List all enrichments.

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
  "cached": "...",
  "enrichments": "..."
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
