# API Reference — Autonomous Outbound Sales Agent

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/leads` | Add leads. |
| `POST` | `/campaign/start` | Start campaign. |
| `POST` | `/webhooks/voice` | Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly. |
| `GET` | `/results` | Get results. |
| `GET` | `/health` | Health check and service status. |

---

## `POST /leads`

Add leads.

### Request

```json
{
  "leads": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `leads` | `array` | no | Leads |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /campaign/start`

Start campaign.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_control_id` | `string` | **yes** | Call control id |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

## `GET /results`

Get a specific results by ID.

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

Records use these status values: `active`, `call_ended`, `calling`, `dialing`, `event_received`, `greeting`, `listening`, `ok`, `reprompting`, `responding`

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
