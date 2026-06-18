# API Reference — Cloud Storage Call Archive

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/buckets` | Create a new bucket. |
| `GET` | `/buckets` | List buckets. |
| `POST` | `/archive` | Archive recording. |
| `POST` | `/webhooks/recording` | Receives Telnyx webhook events. |
| `GET` | `/archive` | List archive. |
| `GET` | `/archive/search` | Search archive. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /buckets`

Create a new bucket.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /buckets`

List all buckets.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /archive`

Archive recording.

### Request

```json
{
  "recording_url": "recording-url-value",
  "call_id": "call-id-value",
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recording_url` | `string` | **yes** | Recording url |
| `call_id` | `string` | no | Call id |
| `metadata` | `object` | no | Metadata |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/recording`

Receives Telnyx webhook events.

---

## `GET /archive`

List all archive.

### Response `200`

```json
{"recordings": results[-50:], "total": "..."}
```

---

## `GET /archive/search`

Search archive.

### Response `200`

```json
{"results": results[:20], "query": q}
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

Records use these status values: `archived`, `ok`, `queued`

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
