# API Reference — Production-ready Flask application for eSIM provisioning via Telnyx.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/esim/profiles` | Provision esim. |
| `POST` | `/esim/profiles/<sim_card_id>/activate` | Activate esim. |
| `GET` | `/esim/profiles/<sim_card_id>` | Get esim. |
| `GET` | `/esim/profiles` | List esims. |
| `POST` | `/esim/webhooks/sim-status` | Receives Telnyx webhook events. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /esim/profiles`

Provision esim.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_name` | `string` | **yes** | Device name |
| `sim_card_group_id` | `string` | **yes** | Sim card group id |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /esim/profiles/<sim_card_id>/activate`

Activate esim.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /esim/profiles/<sim_card_id>`

Get a specific esim by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /esim/profiles`

List all esims.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /esim/webhooks/sim-status`

Receives Telnyx webhook events.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "healthy"
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
