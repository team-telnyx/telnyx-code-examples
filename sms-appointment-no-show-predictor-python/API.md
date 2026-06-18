# API Reference — SMS Appointment No-Show Predictor

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/appointments` | Add appointment. |
| `POST` | `/predict` | Run predictions. |
| `POST` | `/webhooks/messaging` | Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /appointments`

Add appointment.

### Request

```json
{
  "phone": "+12125559999",
  "datetime": "datetime-value"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `datetime` | `string` | no | Datetime |

### Response `200`

```json
{
  "status": "scheduled"
}
```

---

## `POST /predict`

Run predictions.

### Response `200`

```json
{"predictions": predictions}
```

---

## `POST /webhooks/messaging`

Receives Telnyx Messaging webhook events. Called automatically by Telnyx for inbound messages — do not call directly.

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "patients": "..."
}
```

---

## Status Values

Records use these status values: `confirmed`, `handled`, `ignored`, `ok`, `scheduled`, `unknown_patient`

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
