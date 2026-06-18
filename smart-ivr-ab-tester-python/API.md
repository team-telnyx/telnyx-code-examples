# API Reference — Smart IVR A/B Tester

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/experiments` | Create a new experiment. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/experiments/<eid>/results` | Get results. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /experiments`

Create a new experiment.

### Request

```json
{
  "variant_a": {},
  "variant_b": {},
  "split": "split-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `variant_a` | `object` | no | Variant a |
| `variant_b` | `object` | no | Variant b |
| `split` | `string` | no | Split |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /experiments/<eid>/results`

Get a specific results by ID.

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
  "experiments": "..."
}
```

---

## Status Values

Records use these status values: `answering`, `ended`, `greeting`, `listening`, `ok`, `routed`

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
