# API Reference — SIP Load Balancer Health Check

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/check` | Health check. |
| `GET` | `/route` | Get route. |
| `GET` | `/endpoints` | List endpoints. |
| `POST` | `/endpoints` | Add endpoint. |
| `GET` | `/log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /check`

Health check.

### Response `200`

```json
{"results": results}
```

---

## `GET /route`

Get a specific route by ID.

### Response `200`

```json
{
  "error": "No healthy endpoints",
  "fallback": "primary"
}
```

---

## `GET /endpoints`

List all endpoints.

### Response `200`

```json
{"endpoints": {n: {"host": e["host"], "status": e["status"],
        "uptime": "..." * 100, 1)}
```

---

## `POST /endpoints`

Add endpoint.

### Request

```json
{
  "name": "Jane Smith",
  "host": "host-value",
  "port": "port-value",
  "weight": "weight-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | **yes** | Display name or label |
| `host` | `string` | **yes** | Host |
| `port` | `string` | no | Port |
| `weight` | `string` | no | Weight |

### Response `200`

```json
{
  "status": "added"
}
```

---

## `GET /log`

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
{"status": "ok", "healthy": healthy, "total": "..."}
```

---

## Status Values

Records use these status values: `added`, `healthy`, `ok`, `unknown`

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
