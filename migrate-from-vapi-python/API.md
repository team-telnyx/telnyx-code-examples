# API Reference — Migrate from Vapi

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit/vapi` | Audit vapi. |
| `POST` | `/migrate/agent` | Migrate agent. |
| `GET` | `/mapping/voices` | Voice mapping. |
| `GET` | `/mapping/models` | Model mapping. |
| `GET` | `/migration-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /audit/vapi`

Audit vapi.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /migrate/agent`

Migrate agent.

### Request

```json
{
  "vapi_agent": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vapi_agent` | `object` | no | Vapi agent |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /mapping/voices`

Voice mapping.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /mapping/models`

Model mapping.

### Response `200`

```json
{"recommendations": {
        "gpt-4o": "meta-llama/Llama-3.3-70B-Instruct (or moonshotai/Kimi-K2.6)",
        "gpt-3.5-turbo": "meta-llama/Llama-3.1-8B-Instruct",
        "claude-3": "anthropic/claude-sonnet-4-20250514"}
```

---

## `GET /migration-log`

Get a specific log by ID.

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
  "migrations": "..."
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
