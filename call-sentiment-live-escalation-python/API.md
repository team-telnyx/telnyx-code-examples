# API Reference — Call Sentiment Live Escalation

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/monitor` | Start monitoring. |
| `POST` | `/transcript` | Receive transcript. |
| `GET` | `/calls/<call_id>/sentiment` | Call sentiment. |
| `GET` | `/escalations` | List escalations. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /monitor`

Start monitoring.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_id` | `string` | **yes** | Call id |
| `agent` | `string` | **yes** | Agent |
| `customer` | `string` | **yes** | Customer |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /transcript`

Receive transcript.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_id` | `string` | **yes** | Call id |
| `text` | `string` | no | Text content |
| `speaker` | `string` | no | Speaker |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /calls/<call_id>/sentiment`

Call sentiment.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /escalations`

List all escalations.

### Response `200`

```json
{"escalations": escalations[-50:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "monitoring": "...",
  "escalations": "..."
}
```

---

## Status Values

Records use these status values: `escalated`, `monitoring`, `ok`

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
