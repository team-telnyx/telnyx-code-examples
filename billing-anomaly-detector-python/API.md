# API Reference — Billing Anomaly Detector

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/config` | Set baselines. |
| `GET` | `/config` | Get baselines. |
| `POST` | `/check` | Run anomaly check. |
| `GET` | `/balance` | Check balance. |
| `GET` | `/alerts` | List alerts. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /config`

Set baselines.

### Response `200`

```json
{"baselines": baselines}
```

---

## `GET /config`

Get a specific baselines by ID.

### Response `200`

```json
{"baselines": baselines}
```

---

## `POST /check`

Run anomaly check.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /balance`

Check balance.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /alerts`

List all alerts.

### Response `200`

```json
{"alerts": alerts[-50:]}
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{"status": "ok", "alerts": "...", "baselines": baselines}
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
