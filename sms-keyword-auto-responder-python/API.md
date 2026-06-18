# API Reference — SMS Keyword Auto-Responder — keyword-triggered responses with match analytics.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/keywords` | List keywords. |
| `POST` | `/keywords` | Add keyword. |
| `GET` | `/analytics` | Analytics. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /keywords`

List all keywords.

### Response `200`

```json
{"keywords": {k: {"response": v["response"], "hits": v["count"]}
```

---

## `POST /keywords`

Add keyword.

### Request

```json
{
  "keyword": "keyword-value",
  "response": "response-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyword` | `string` | no | Keyword |
| `response` | `string` | no | Response |

### Response `200`

```json
{"status": "added", "keyword": keyword}
```

---

## `GET /analytics`

Analytics.

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
  "keywords": "...",
  "messages": "..."
}
```

---

## Status Values

Records use these status values: `added`, `handled`, `ignored`, `ok`

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
