# API Reference — Wireless Fleet Activation Portal — bulk activate SIMs with status tracking.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sims` | List sims. |
| `POST` | `/sims/activate` | Activate sims. |
| `POST` | `/sims/deactivate` | Deactivate sims. |
| `GET` | `/activation-log` | Get log. |
| `GET` | `/health` | Health check and service status. |

---

## `GET /sims`

List all sims.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /sims/activate`

Activate sims.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sim_ids` | `string` | no | Sim ids |

### Response `200`

```json
{"results": results, "activated": "..."}
```

---

## `POST /sims/deactivate`

Deactivate sims.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sim_ids` | `string` | no | Sim ids |

### Response `200`

```json
{"results": results}
```

---

## `GET /activation-log`

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
  "activations": "..."
}
```

---

## Status Values

Records use these status values: `active`, `deactivated`, `error`, `inactive`, `ok`

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
