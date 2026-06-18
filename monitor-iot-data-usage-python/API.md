# API Reference — Production-ready Flask application for monitoring SIM card

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check and service status. |
| `GET` | `/sim-cards` | List sims. |
| `GET` | `/sim-cards/<sim_card_id>` | Get sim. |
| `GET` | `/sim-cards/<sim_card_id>/usage` | Get usage. |
| `GET` | `/sim-cards/<sim_card_id>/health` | Health check and service status. |
| `POST` | `/sim-cards/<sim_card_id>/activate` | Activate sim. |
| `POST` | `/webhooks/sim-events` | Receives Telnyx webhook events. |

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "service": "data-usage-monitor"
}
```

---

## `GET /sim-cards`

List all sims.

### Response `200`

```json
{"data": sims, "count": "..."}
```

---

## `GET /sim-cards/<sim_card_id>`

Get a specific sim by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sim-cards/<sim_card_id>/usage`

Get a specific usage by ID.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `GET /sim-cards/<sim_card_id>/health`

Health check and service status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /sim-cards/<sim_card_id>/activate`

Activate sim.

### Response `200`

```json
{
            "id": response.data.id,
            "status": response.data.status,
            "message": "SIM card activated successfully",
        }
```

---

## `POST /webhooks/sim-events`

Receives Telnyx webhook events.

---

## Status Values

Records use these status values: `ok`, `received`

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
