# API Reference — Global IP Failover Monitor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/endpoints` | List endpoints. |
| `POST` | `/endpoints` | Add endpoint. |
| `POST` | `/check` | Run health check. |
| `GET` | `/failover-log` | Get failover log. |
| `GET` | `/regions` | Regions. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /endpoints`

List all endpoints.

### Response `200`

```json
{"endpoints": "...")}
```

---

## `POST /endpoints`

Add endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | no | Id |
| `ip_address` | `string` | **yes** | Ip address |
| `region` | `string` | **yes** | Region |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /check`

Run health check.

### Response `200`

```json
{"results": results}
```

---

## `GET /failover-log`

Get failover log.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /regions`

Regions.

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

Records use these status values: `added`, `healthy`, `ok`, `unhealthy`

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
