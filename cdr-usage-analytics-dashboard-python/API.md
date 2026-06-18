# API Reference — CDR Usage Analytics Dashboard

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cdrs` | Get cdrs. |
| `GET` | `/analytics/summary` | Usage summary. |
| `GET` | `/analytics/peak-hours` | Peak hours. |
| `GET` | `/analytics/top-routes` | Top routes. |
| `GET` | `/analytics/ai-insights` | Ai insights. |
| `GET` | `/analytics/daily` | Daily breakdown. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /cdrs`

Get a specific cdrs by ID.

### Response `200`

```json
{"data": "...", "period": {"start": start, "end": end}
```

---

## `GET /analytics/summary`

Usage summary.

### Response `200`

```json
{"period": {"start": start, "end": end}
```

---

## `GET /analytics/peak-hours`

Peak hours.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /analytics/top-routes`

Top routes.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /analytics/ai-insights`

Ai insights.

### Response `200`

```json
{
  "insights": "No data for analysis"
}
```

---

## `GET /analytics/daily`

Daily breakdown.

### Response `200`

```json
{"daily": daily}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok"
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
