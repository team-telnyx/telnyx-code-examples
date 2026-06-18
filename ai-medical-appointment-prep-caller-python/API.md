# API Reference — AI Medical Appointment Prep Caller

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/prep-call` | Start prep call. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/intakes` | List intakes. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /prep-call`

Start prep call.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | `string` | **yes** | Phone number in E.164 format (e.g., `+12125551234`) |
| `patient_name` | `string` | no | Patient name |

### Response `200`

```json
{
  "status": "calling"
}
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /intakes`

List all intakes.

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
  "intakes": "...",
  "active": "..."
}
```

---

## Status Values

Records use these status values: `calling`, `ended`, `greeting`, `listening`, `ok`, `reprompting`, `responding`

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
