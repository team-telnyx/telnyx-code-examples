# API Reference — Production-ready Flask application for call transfer via Telnyx Voice API.

Base URL: `http://localhost:5000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/initiate` | Initiate call endpoint. |
| `POST` | `/calls/transfer` | Transfer call endpoint. |
| `POST` | `/calls/hangup` | Hangup call endpoint. |
| `POST` | `/webhooks/call-events` | Receives Telnyx webhook events. |
| `GET` | `/calls/status/<call_control_id>` | Get call status. |

---

## `POST /calls/initiate`

Initiate call endpoint.

### Request

```json
{
  "to": "+12125559999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Destination phone number (E.164) |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /calls/transfer`

Transfer call endpoint.

### Request

```json
{ "status": "ok", "data": { } }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_control_id` | `string` | **yes** | Call control id |
| `transfer_to` | `string` | **yes** | Transfer to |

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## `POST /calls/hangup`

Hangup call endpoint.

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

## `POST /webhooks/call-events`

Receives Telnyx webhook events.

---

## `GET /calls/status/<call_control_id>`

Get call status.

### Response `200`

```json
{ "status": "ok", "data": { } }
```

---

## Status Values

Records use these status values: `answered`, `completed`, `hangup`, `initiated`, `received`, `transferred`

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
